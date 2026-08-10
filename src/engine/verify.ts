import type { Statement } from './prompt'
/**
 * 응답 검증기 — llm-persona-game 스킬 §3 "화이트리스트 3중 방어".
 *
 * 프롬프트는 요청이고 검증은 보장이다. 요청은 확률적으로 무시된다.
 * 추리 게임에서 잘못된 단서 1개는 플레이어의 한 판을 통째로 날린다.
 *
 * 검사 2를 생략하면 안 된다: revealedFactIds 는 비어 있는데 본문에서
 * "10시 40분쯤" 같은 없는 시각을 흘리는 응답이 1번만으로는 통과한다.
 */

import { PLACE_LABEL, SLOT_LABEL, type CaseFile, type SuspectId } from '../types'
import { allowedFactIds, type PersonaReply } from './prompt'

/** 사건이 아는 시각·장소 라벨 — world 가 있으면 그것, 없으면 호텔 상수 (GC001 계약 §1) */
const caseSlots = (c: CaseFile): readonly string[] => c.world?.slotLabels ?? SLOT_LABEL
const casePlaces = (c: CaseFile): readonly string[] => c.world?.placeLabels ?? PLACE_LABEL

export type RejectReason =
  | 'shape'          // JSON 모양이 틀림
  | 'unknown-fact'   // 지식 시트 밖 factId
  | 'phantom-time'   // 사건에 없는 시각
  | 'phantom-place'  // 사건에 없는 장소
  | 'time-range'     // 구간 표현 — 목록에 없는 주장이 된다
  | 'too-long'       // 길이 초과

export interface VerifyOk {
  ok: true
  reply: PersonaReply
  /** 범위를 벗어나 잘라낸 값이 있었는가 */
  clamped: boolean
}
export interface VerifyFail {
  ok: false
  reason: RejectReason
  detail: string
}
export type VerifyResult = VerifyOk | VerifyFail

const PRESSURE_MIN = -20
const PRESSURE_MAX = 40
const MAX_CHARS = 160 // 목표 120자 + 여유. 이걸 넘으면 3~5분 세션이 깨진다
const TELLS = ['none', 'gaze', 'pause', 'stammer', 'anger'] as const

/** 본문에 등장하는 시각 표기를 뽑는다 (10:40 / 22:20 / 10시 40분 모두) */
export function extractTimes(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(\d{1,2})\s*[:시]\s*(\d{1,2})\s*분?/g)) {
    out.push(`${m[1]!.padStart(2, '0')}:${m[2]!.padStart(2, '0')}`)
  }
  return out
}

/** 12시간 표기를 24시간으로 — "10시 20분" 은 밤 10시를 뜻할 수 있다 */
function timeMatchesCase(c: CaseFile, t: string): boolean {
  const slots = caseSlots(c)
  if (slots.includes(t)) return true
  const [h, m] = t.split(':') as [string, string]
  const alt = `${String((Number(h) + 12) % 24).padStart(2, '0')}:${m}`
  return slots.includes(alt)
}

export function verifyReply(raw: unknown, c: CaseFile, s: SuspectId): VerifyResult {
  // ── 모양 검사 ──
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'shape', detail: '객체가 아니다' }
  }
  const r = raw as Record<string, unknown>
  if (typeof r.speech !== 'string' || !r.speech.trim()) {
    return { ok: false, reason: 'shape', detail: 'speech 누락' }
  }
  if (!Array.isArray(r.revealedFactIds) || r.revealedFactIds.some((x) => typeof x !== 'string')) {
    return { ok: false, reason: 'shape', detail: 'revealedFactIds 형식 오류' }
  }
  if (typeof r.pressureDelta !== 'number' || !Number.isFinite(r.pressureDelta)) {
    return { ok: false, reason: 'shape', detail: 'pressureDelta 형식 오류' }
  }
  if (typeof r.tell !== 'string' || !(TELLS as readonly string[]).includes(r.tell)) {
    return { ok: false, reason: 'shape', detail: `tell 값 오류: ${String(r.tell)}` }
  }

  /**
   * 조서(statement)는 **없어도 통과**시킨다.
   * 모델이 필드를 빠뜨렸다고 대사까지 버리면 플레이어가 조사 횟수를 잃는다 —
   * 조서는 편의 기능이고 대사가 본체다. 없으면 빈 조서로 채운다.
   */
  const st = (r.statement ?? {}) as Record<string, unknown>
  const certainty = ['확언', '추정', '기억없음'].includes(String(st.certainty))
    ? (st.certainty as Statement['certainty']) : '추정'
  const statement: Statement = {
    time: typeof st.time === 'string' ? st.time.slice(0, 20) : '',
    place: typeof st.place === 'string' ? st.place.slice(0, 20) : '',
    action: typeof st.action === 'string' ? st.action.slice(0, 40) : '',
    certainty,
    newInfo: st.newInfo === true,
  }

  const speech = r.speech.trim()
  if (speech.length > MAX_CHARS) {
    return { ok: false, reason: 'too-long', detail: `${speech.length}자 (상한 ${MAX_CHARS})` }
  }

  // ── 검사 1: 화이트리스트 ──
  const allowed = new Set(allowedFactIds(c, s))
  const stray = (r.revealedFactIds as string[]).filter((id) => !allowed.has(id))
  if (stray.length) {
    return { ok: false, reason: 'unknown-fact', detail: `시트 밖 id: ${stray.join(', ')}` }
  }

  // ── 검사 2: 본문의 시각이 사건에 실재하는가 ──
  const badTime = extractTimes(speech).find((t) => !timeMatchesCase(c, t))
  if (badTime) {
    return { ok: false, reason: 'phantom-time', detail: `사건에 없는 시각: ${badTime}` }
  }

  // ── 검사 2a: 구간 표현 금지 ──
  // "22:00부터 22:30까지 로비" 는 슬롯별로 장소가 다른 사건 모델에서 **없는 주장**이다.
  // 검사 2 는 시각의 존재만 보므로 이걸 못 잡는다 — 플레이어가 가짜 단서로 한 판을 날린다.
  if (/\d{1,2}\s*[:시]\s*\d{1,2}\s*분?\s*(부터|에서)[\s\S]{0,12}?\d{1,2}\s*[:시]\s*\d{1,2}\s*분?\s*(까지|사이)/.test(speech)) {
    return { ok: false, reason: 'time-range', detail: '시각 구간 표현' }
  }

  // ── 검사 2b: 본문의 장소가 사건에 실재하는가 ──
  // "1204호" 같은 방 번호 패턴만 검사한다 (일반 명사까지 막으면 오탐이 폭증한다)
  const badRoom = [...speech.matchAll(/(\d{3,4})호/g)]
    .map((m) => `${m[1]}호`)
    .find((room) => !casePlaces(c).includes(room))
  if (badRoom) {
    return { ok: false, reason: 'phantom-place', detail: `사건에 없는 장소: ${badRoom}` }
  }

  // ── 검사 3: 범위 클램프 (폐기가 아니라 교정) ──
  const clampedDelta = Math.max(PRESSURE_MIN, Math.min(PRESSURE_MAX, Math.round(r.pressureDelta)))

  return {
    ok: true,
    clamped: clampedDelta !== r.pressureDelta,
    reply: {
      speech,
      revealedFactIds: r.revealedFactIds as string[],
      pressureDelta: clampedDelta,
      tell: r.tell as PersonaReply['tell'],
    statement,
    },
  }
}

/**
 * 폴백 2층 — 재요청도 실패했을 때 쓰는 사전 작성 회피 대사.
 * **조사 횟수를 소모시키지 않는다.** AI 가 실패했는데 플레이어가 대가를 치르면
 * 그건 버그가 아니라 배신이다 (스킬 §3).
 */
export const FALLBACK_LINES: Record<string, string> = {
  authoritative: '그 질문에는 답할 이유를 못 느끼겠군요.',
  timid: '저… 잘 기억이 안 나요. 죄송합니다.',
  calculating: '기록에 없는 이야기는 하지 않겠습니다.',
  emotional: '지금은… 그 얘기 못 하겠어요.',
  loyal: '제가 아는 한, 더 드릴 말씀이 없습니다.',
  egocentric: '제가 본 건 아까 다 말씀드렸는데요.',
  guilty: '……. (시선을 피한다)',
  cynical: '좋은 질문이네요. 답은 없지만.',
}

export function fallbackReply(personaId: string): PersonaReply {
  return {
    speech: FALLBACK_LINES[personaId] ?? '더 드릴 말씀이 없습니다.',
    revealedFactIds: [],
    pressureDelta: 0,
    tell: 'pause',
    statement: { time: '', place: '', action: '', certainty: '기억없음', newInfo: false },
  }
}
