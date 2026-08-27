/**
 * 게임 상태 리듀서 — 전부 순수 함수, 전부 불변.
 *
 * 불변인 이유: 사건 보드가 "이 카드를 저 카드에 연결하면?" 을 미리 계산해 보여줘야 하고,
 * 리플레이·되감기 검증이 같은 상태에서 여러 분기를 시뮬레이션하기 때문이다.
 * mutation 이 하나라도 있으면 그 순간 오염된다.
 *
 * 이 파일에는 LLM 이 없다. 자원·판정·점수는 전부 코드가 소유한다
 * (llm-persona-game 스킬 §1 소유권 분리 — AI 는 승패에 손대지 않는다).
 */

import {
  CRIME_SLOT,
  placeLabel,
  SUSPECTS,
  type CaseFile,
  type Evidence,
  type Slot,
  type SuspectId,
} from '../types'
import { FIELD_BUDGET, TALK_CAP } from '../data/config'
import { josa } from '../josa'
import { candidatesFrom } from './solver'

/** 진술 카드 id — 인물의 특정 시각 주장 1건 */
export const claimCardId = (s: SuspectId, slot: Slot): string => `C:${s}:${slot}`

export function parseClaimCard(id: string): { suspect: SuspectId; slot: Slot } | null {
  const m = /^C:(S[1-5]):([0-4])$/.exec(id)
  return m ? { suspect: m[1] as SuspectId, slot: Number(m[2]) as Slot } : null
}

export type Phase = 'investigate' | 'submit' | 'result'

export interface GameState {
  case: CaseFile
  /** 남은 **현장 조사(기록 조회)** 예산. 심문은 이 지갑을 쓰지 않는다 (ADR 022) */
  investigationsLeft: number
  /** 인물별 소모한 대화 수 — 심문·증거 제시가 여기 쌓인다. 상한은 TALK_CAP */
  talks: Record<SuspectId, number>
  /** 보유 카드 — 물증 id · 증언 id · 진술 카드 id 가 섞여 있다 */
  cards: string[]
  connections: [string, string][]
  /** 발견한 모순 키 `evId|suspect|slot` */
  foundContradictions: string[]
  /** 들이밀었지만 아무 반응이 없던 (증거|인물) 조합 — 소거된 경우의 수 */
  ruledOut: string[]
  /** 인물별 동요 수치 0~100 */
  pressure: Record<SuspectId, number>
  phase: Phase
}

/** @param budget 밸런스 스윕용 오버라이드. 게임은 항상 기본값(현장 예산)을 쓴다. */
export function createGame(c: CaseFile, budget = FIELD_BUDGET): GameState {
  // 기본 진술: 모든 인물의 **범행 시각** 주장만 무료 공개한다.
  // 나머지 시각은 심문해야 열린다 — 이게 심문에 값을 부여한다.
  const cards = SUSPECTS.map((s) => claimCardId(s, CRIME_SLOT))
  const pressure = Object.fromEntries(SUSPECTS.map((s) => [s, 0])) as Record<SuspectId, number>
  const talks = Object.fromEntries(SUSPECTS.map((s) => [s, 0])) as Record<SuspectId, number>
  return {
    case: c,
    investigationsLeft: budget,
    talks,
    cards,
    connections: [],
    foundContradictions: [],
    ruledOut: [],
    pressure,
    phase: 'investigate',
  }
}

/**
 * 챕터 파생 헬퍼 (ADR 022). phase 는 'investigate' 하나로 유지한다 —
 * 챕터는 예산 상태에서 **파생**되는 것이지 별도 상태가 아니다. 상태를 둘로 들면
 * "예산은 0인데 phase 는 아직 1장" 같은 어긋남이 생길 자리부터 생긴다.
 *
 * **예산 0 만으로 판정하면 게이트가 영영 안 열리는 시드가 있다.** 즉시 조회 가능한
 * 기록이 4건뿐인 사건(gate 사슬 + 알리바이 1 + 잡음 1)에서는 예산 5회를 다 못 쓴다.
 * 그래서 "볼 수 있는 기록이 바닥났다" 도 챕터의 끝이다.
 *
 * ⚠️ 이 값은 **되돌아갈 수 있다**: 심문 챕터에서 잠긴 기록이 해금되면 availableEvidence 가
 * 다시 차오른다. UI 는 첫 true 를 걸쇠(latch)로 잡아야 한다 — 게이트가 도로 잠기면 안 된다.
 */
export const fieldDone = (g: GameState): boolean =>
  g.investigationsLeft <= 0 || availableEvidence(g).length === 0
/** 이 인물과 남은 대화 수 — UI 의 n/10 칩과 봇이 같은 값을 본다 */
export const talksLeft = (g: GameState, s: SuspectId): number => Math.max(0, TALK_CAP - g.talks[s])

/** 현장 예산 1회 지출 (기록 조회 전용) */
function spendField(g: GameState, cards: string[]): GameState {
  return {
    ...g,
    investigationsLeft: g.investigationsLeft - 1,
    cards: [...new Set([...g.cards, ...cards])],
  }
}

/** 대화 1회 지출 (심문·증거 제시 전용) */
function spendTalk(g: GameState, s: SuspectId, cards: string[], pressureDelta: number): GameState {
  return {
    ...g,
    talks: { ...g.talks, [s]: g.talks[s] + 1 },
    cards: [...new Set([...g.cards, ...cards])],
    pressure: { ...g.pressure, [s]: Math.max(0, Math.min(100, g.pressure[s] + pressureDelta)) },
  }
}

function assertPlaying(g: GameState): void {
  if (g.phase === 'result') throw new Error('이미 제출했다 — 수사는 끝났다')
}

function assertCanTalk(g: GameState, s: SuspectId): void {
  assertPlaying(g)
  if (g.talks[s] >= TALK_CAP) {
    throw new Error(`이 사람과의 대화는 끝났다 — 대화 상한 ${TALK_CAP}회를 모두 썼다`)
  }
}

/** 지금 조회 가능한 물증 (선행 조건 충족 + 미보유) */
const evidenceGateActive = (g: GameState): boolean => g.case.evidenceAccess !== 'open'

export function availableEvidence(g: GameState): Evidence[] {
  return g.case.evidence.filter(
    (e) => !g.cards.includes(e.id)
      && (!evidenceGateActive(g) || e.requires.every((r) => g.cards.includes(r))),
  )
}

export interface LockedRecord {
  evidence: Evidence
  /** 충족한 선행 조건 수 */
  met: number
  total: number
  /** 아직 필요한 것의 종류 (누구인지는 밝히지 않는다) */
  missing: string[]
}

/**
 * 잠긴 기록과 **그 자물쇠의 모양**을 돌려준다.
 *
 * 초기 구현은 잠긴 기록을 목록에서 통째로 감췄다. 그랬더니 플레이어는
 * "왜 갑자기 새 기록이 열렸는지", "아직 뭐가 부족한지" 를 알 수 없었다
 * (자동 리뷰가 3판 연속 지적). 자물쇠는 보여주고 열쇠의 주인만 감춘다.
 */
export function lockedRecords(g: GameState): LockedRecord[] {
  if (!evidenceGateActive(g)) return []
  return g.case.evidence
    .filter((e) => !g.cards.includes(e.id) && !e.requires.every((r) => g.cards.includes(r)))
    .map((e) => {
      const missing = e.requires
        .filter((r) => !g.cards.includes(r))
        // 자물쇠 종류: 증언 계열과 **다른 기록**(gc001 — 두 기록을 다 쥐어야 대조가 열린다).
        // 열쇠의 주인은 끝까지 감춘다 (ADR 010).
        .map((r) =>
          r === 'T-SLIP' ? '범인의 자백성 진술'
          : g.case.evidence.some((x) => x.id === r) ? '다른 기록의 확보'
          : '관련자의 증언')
      return { evidence: e, met: e.requires.length - missing.length, total: e.requires.length, missing }
    })
}

export function lookupEvidence(g: GameState, evId: string): GameState {
  assertPlaying(g)
  const e = g.case.evidence.find((x) => x.id === evId)
  if (!e) throw new Error(`없는 물증: ${evId}`)
  if (g.cards.includes(evId)) throw new Error(`이미 보유한 물증: ${evId}`)
  if (evidenceGateActive(g) && !e.requires.every((r) => g.cards.includes(r))) {
    throw new Error(`선행 조건 미충족: ${evId} (필요: ${e.requires.join(', ')})`)
  }
  if (g.investigationsLeft > 0) return spendField(g, [evId])
  /**
   * 현장 예산 소진 후에는 **해금 사슬로 열린 기록만, 무료로** 조회할 수 있다.
   *
   * 이 예외가 없으면 통찰 보너스가 구조적으로 불가능해진다: 잠긴 카드키 기록의
   * 선행 조건(자백성 진술·목격자 증언)은 전부 심문 챕터에서 모이는데, 심문 챕터는
   * 정의상 현장 예산 0 에서 시작한다 (ADR 022 — 챕터 게이트). 값은 이미 치렀다 —
   * 자물쇠를 여는 데 든 대화가 비용이고, 조회는 그 보상을 집는 동작일 뿐이다.
   * 선행 조건 없는 기록은 그대로 막는다 — 그건 현장 예산이 사야 하는 물건이다.
   */
  if (!evidenceGateActive(g) || e.requires.length === 0) {
    throw new Error('현장 조사 예산을 모두 소모했다 — 이제 심문으로 열리는 기록만 조회할 수 있다')
  }
  return { ...g, cards: [...new Set([...g.cards, evId])] }
}

/** 심문 — 그 인물의 진술 궤적 5칸 + 보유 증언을 연다. 대화 1회를 소모한다 */
export function interview(g: GameState, s: SuspectId): GameState {
  assertCanTalk(g, s)
  const claims = ([0, 1, 2, 3, 4] as Slot[]).map((t) => claimCardId(s, t))
  return spendTalk(g, s, [...claims, ...g.case.suspects[s].testimonies], 10)
}

/**
 * 증거 제시 — **누구에게든 제시할 수 있고, 언제나 대화 1회를 소모한다.**
 *
 * 초기 구현은 "해금 관계가 없으면 거부" 였는데, 그게 **정답 유출 경로**였다:
 * 해금 쌍은 범인에게만 존재하므로, 카드를 하나 들고 다섯 명을 훑으면
 * 버튼이 켜지는 사람이 곧 범인이었다 — 조사 0회로 답이 새어나간다.
 *
 * 그래서 "낭비 방지" 를 포기하고 **낭비할 자유** 를 준다.
 * 헛된 제시는 인물의 회피 반응만 얻고 그 사람과의 대화 1회를 잃는다 —
 * 지갑이 조사 예산에서 대화 상한으로 바뀌었을 뿐(ADR 022), 긴장의 구조는 같다.
 */
export function presentEvidence(g: GameState, evId: string, s: SuspectId): GameState {
  assertCanTalk(g, s)
  if (!g.cards.includes(evId)) throw new Error(`보유하지 않은 증거: ${evId}`)
  const unlock = g.case.presentUnlocks.find((u) => u.evidenceId === evId && u.suspectId === s)
  const next = spendTalk(g, s, unlock ? [unlock.yieldsTestimonyId] : [], unlock ? 35 : 12)
  // 무반응도 정보다 — "이 조합은 아니다" 를 기록해 같은 실수를 반복하지 않게 한다.
  // 대화 1회를 잃고 아무것도 안 남으면 그건 벌이지 소거가 아니다 (ADR 010).
  return unlock ? next : { ...next, ruledOut: [...next.ruledOut, `${evId}|${s}`] }
}

/** 이 제시가 실제로 무언가를 열었는가 — UI 가 사후에 알려주기 위한 것 (사전 노출 금지) */
export function presentYields(g: GameState, evId: string, s: SuspectId): boolean {
  return g.case.presentUnlocks.some((u) => u.evidenceId === evId && u.suspectId === s)
}

/** 제시 결과를 화면에 무엇으로 알릴지 */
export type PresentReveal = 'opened' | 'nothing' | 'void'

/**
 * **폴백이면 아무 일도 없었던 것이다 — 판별 결과조차 남기면 안 된다.**
 *
 * 위 `presentEvidence` 주석이 닫았다고 적어 둔 그 유출이 **폴백 경로로 되살아나 있었다.**
 * 해금 쌍은 범인에게만 존재하므로(`caseGen`) "열렸다" 는 곧 "이 사람이 범인" 이다.
 * 그런데 AI 응답이 실패하면 조사를 환불하면서도 해금 여부는 이미 소리와 로그로 나갔다 —
 * **조사 0회로 답이 새어나간다.** 로컬 `npm run dev` 는 Function 이 없어 항상 이 경로를 탄다.
 *
 * 그래서 판별을 UI 에서 계산하지 않고 여기서 소유한다. 화면은 이 값을 읽어 그리기만 한다.
 */
export function presentReveal(before: GameState, after: GameState, fallback: boolean): PresentReveal {
  if (fallback) return 'void'
  return after.cards.length > before.cards.length ? 'opened' : 'nothing'
}

export interface ConnectResult {
  state: GameState
  contradiction: boolean
  /** 모순일 때 사람이 읽을 설명 */
  message: string
}

/**
 * 카드 2장 연결 — **조사 횟수를 소모하지 않는다.**
 * 추론 자체는 무료여야 3~5분 세션이 성립한다 (기획서 §2).
 */
export function connect(g: GameState, a: string, b: string): ConnectResult {
  for (const id of [a, b]) {
    if (!g.cards.includes(id)) throw new Error(`보유하지 않은 카드: ${id}`)
  }

  const connections: [string, string][] = [...g.connections, [a, b]]

  // 물증 ↔ 진술 조합만 모순 판정 대상이다
  const ev = g.case.evidence.find((e) => e.id === a) ?? g.case.evidence.find((e) => e.id === b)
  const claim = parseClaimCard(a) ?? parseClaimCard(b)

  if (!ev || !claim) {
    return { state: { ...g, connections }, contradiction: false, message: '연결했지만 모순은 아니다' }
  }
  if (ev.slot !== claim.slot) {
    return { state: { ...g, connections }, contradiction: false, message: '시각이 달라 비교 대상이 아니다' }
  }

  const claimed = g.case.suspects[claim.suspect].claim[claim.slot]!
  const inRecord = ev.subjects.includes(claim.suspect)

  let why: string | null = null
  if (inRecord && claimed !== ev.place) {
    // ① 대면 모순 — 기록에 찍힌 장소와 본인 진술이 다르다
    why = `기록에는 ${placeLabel(g.case, ev.place)}인데 본인은 ${josa(placeLabel(g.case, claimed), '이라/라')} 했다`
  } else if (!inRecord && claimed === ev.place && ev.exhaustive) {
    // ② 부재 모순 — 그 구역을 남김없이 담은 기록에 그 사람이 없다.
    //    사람이 가장 먼저 떠올리는 추리다. exhaustive 가 아닌 기록(영수증·카드키)에는
    //    적용하지 않는다 — 결제/출입을 안 했을 뿐일 수 있으므로 논리적으로 성립하지 않는다.
    why = `${placeLabel(g.case, ev.place)} 구역 기록에 이 사람이 없다`
  }

  if (!why) {
    return {
      state: { ...g, connections },
      contradiction: false,
      message: inRecord ? '진술과 기록이 일치한다' : '이 기록으로는 그 진술을 반박할 수 없다',
    }
  }

  const key = `${ev.id}|${claim.suspect}|${claim.slot}`
  const foundContradictions = g.foundContradictions.includes(key)
    ? g.foundContradictions
    : [...g.foundContradictions, key]

  return {
    state: { ...g, connections, foundContradictions },
    contradiction: true,
    message: `${g.case.suspects[claim.suspect].name}: ${why}`,
  }
}

/**
 * 최종 추론 3축 (ADR 022) — 범인·동기·살인 도구.
 * '결정적 증거 지목' 과 '수단(카드키 발급 구분)' 축은 채점에서 빠졌다 —
 * 둘 다 잠긴 기록 사슬 하나에 걸려 있어 점수가 한 곳에 몰렸었다.
 * 그 사슬은 이제 **통찰 보너스**로만 산다 (아래 insight).
 */
export interface Submission {
  culprit: SuspectId
  motive: string
  weapon: string
}

export interface SubmitResult {
  state: GameState
  correct: { culprit: boolean; motive: boolean; weapon: boolean }
  /** 제출 시점에 기록으로 좁혀져 있던 후보 수 — 채점엔 안 쓰고 결과 화면의 서사에 쓴다 */
  candidatesLeft: number
  breakdown: { culprit: number; motive: number; weapon: number; efficiency: number; insight: number }
  total: number
}

/** 최종 채점 — LLM 은 여기 관여하지 않는다. 공정성·재현성의 근거. */
export function submit(g: GameState, s: Submission): SubmitResult {
  if (g.phase === 'result') throw new Error('이미 제출했다')

  const correct = {
    culprit: s.culprit === g.case.culprit,
    motive: s.motive === g.case.motive,
    weapon: s.weapon === g.case.weapon,
  }

  /**
   * 후보 수는 여전히 계산한다 — 점수 눈금(60/50/40)은 버렸지만, "좁혀서 맞혔는가
   * 찍어서 맞혔는가" 를 결과 화면이 말해주는 건 그대로 가치가 있다.
   * 눈금을 버린 이유: 축이 하나(범인)던 시절의 공정 장치다. 3축에서는 셋 다
   * 찍어서 맞힐 확률이 1/125 라, 만점 자체가 이미 찍기를 배제한다.
   */
  const candidatesLeft = candidatesFrom(g.case, new Set(g.cards)).length

  const breakdown = {
    culprit: correct.culprit ? 60 : 0,
    motive: correct.motive ? 15 : 0,
    weapon: correct.weapon ? 15 : 0,
    /**
     * 남은 현장 예산 ×2 — 조사를 다 쓰기 전에 확신으로 제출한 판의 보상.
     * 챕터 게이트를 지나 심문까지 간 판은 정의상 0 이다 (게이트가 예산 0 을 요구한다).
     * 그래서 기본 만점은 100 이고, 이 10점은 "심문 없이 끝낸" 예외적 판의 웃돈이다.
     */
    efficiency: Math.max(0, g.investigationsLeft) * 2,
    /**
     * 통찰 보너스 — 잠긴 카드키 기록(결정적 증거)을 실제로 열었는가.
     * ADR 022 §1: 수단 20점·증거 지목 20점이던 사슬을 여기로 강등했다.
     * 채점 축이 아니라 보너스이므로, 못 열어도 3축 만점(90+α)은 가능하다.
     */
    insight: g.cards.includes(g.case.decisiveEvidenceId) ? 10 : 0,
  }
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)

  return { state: { ...g, phase: 'result' }, correct, candidatesLeft, breakdown, total }
}
