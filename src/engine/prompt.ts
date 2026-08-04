/**
 * 프롬프트 조립 + 지식 시트.
 *
 * llm-persona-game 스킬 §2:
 *   - `knows` 에 없는 사실은 **프롬프트에 넣지 않는다.**
 *     알려주면서 "말하지 마세요" 라고 하는 건 유출 설계다.
 *   - 다른 인물의 시트를 같은 프롬프트에 절대 넣지 않는다.
 *   - 거짓말은 LLM 이 지어내지 않는다. 미리 고정하고, **어떻게 말할지**만 맡긴다.
 *
 * 캐시 설계: buildPersonaPrefix() 의 결과는 판 내내 **바이트 단위로 고정**이다.
 * 타임스탬프·랜덤 id 를 절대 넣지 마라 — 한 바이트만 달라도 캐시가 통째로 죽는다.
 */

import {
  PLACE_LABEL,
  SLOT_LABEL,
  type CaseFile,
  type Slot,
  type SuspectId,
} from '../types'
import { personaById } from '../data/personas'

/** 사실 원자 id — 그 인물이 "말할 수 있는" 자기 진술 1건 */
export const factId = (s: SuspectId, slot: Slot): string => `F:${s}:${slot}`

export function parseFactId(id: string): { suspect: SuspectId; slot: Slot } | null {
  const m = /^F:(S[1-5]):([0-4])$/.exec(id)
  return m ? { suspect: m[1] as SuspectId, slot: Number(m[2]) as Slot } : null
}

/**
 * 이 인물이 공개할 수 있는 사실 id 전체 — 화이트리스트의 원본.
 * LLM 이 이 목록 밖의 id 를 반환하면 응답을 폐기한다 (verify.ts).
 */
export function allowedFactIds(c: CaseFile, s: SuspectId): string[] {
  return [
    ...([0, 1, 2, 3, 4] as Slot[]).map((t) => factId(s, t)),
    ...c.suspects[s].testimonies,
  ]
}

/** 판 내내 고정되는 프리픽스 — 캐시 지점은 이 문자열의 끝이다 */
export function buildPersonaPrefix(c: CaseFile, s: SuspectId, personaId: string): string {
  const sus = c.suspects[s]
  const p = personaById(personaId)

  // 지식 시트: **진술(claim)** 만 넣는다. 진실(truth)은 절대 넣지 않는다 —
  // 범인이 자기 진짜 위치를 알면 프롬프트에서 새어나갈 경로가 생긴다.
  const sheet = ([0, 1, 2, 3, 4] as Slot[])
    .map((t) => `  ${factId(s, t)} = "${SLOT_LABEL[t]}에 ${PLACE_LABEL[sus.claim[t]!]}에 있었다"`)
    .join('\n')

  const lies = sus.lieSlots.length
    ? sus.lieSlots.map((t) => `  ${SLOT_LABEL[t]} 항목은 사실이 아니다. 이유: ${sus.lieReason}`).join('\n')
    : '  없음 — 당신은 전부 사실대로 말하고 있다.'

  return [
    '당신은 살인 사건의 용의자로 심문받고 있다. 탐정의 질문에 인물로서 답하라.',
    '',
    `[인물] ${s}`,
    `- 문장: ${p.sentence}`,
    `- 버릇: ${p.tic}`,
    `- 회피: ${p.avoidance}`,
    `- 압박 반응: ${p.pressureResponse}`,
    '',
    '[당신이 말할 수 있는 사실 — 이 목록이 전부다]',
    sheet,
    '',
    '[당신이 감추는 것]',
    lies,
    '',
    '[규칙]',
    '1. 위 목록에 없는 시각·장소·인물·사건을 절대 지어내지 마라.',
    '2. 다른 용의자가 무엇을 아는지 당신은 모른다. 추측해서 말하지 마라.',
    '3. revealedFactIds 에는 이번 답변에서 실제로 언급한 사실의 id 만 넣어라.',
    '4. 답변은 3문장, 120자 이내. 인물의 말만 쓰고 지문·해설을 붙이지 마라.',
    '5. 당신은 자신이 범인인지 아닌지 모른다고 가정하고 행동하라. 자백하지 마라.',
  ].join('\n')
}

export interface TurnInput {
  question: string
  /** 제시된 증거의 사람이 읽는 설명 (없으면 순수 질문) */
  presentedEvidence?: string
  /** 현재 동요 수치 0~100 */
  pressure: number
  /** 이전 대화 (질문, 답변) 쌍 */
  history: { q: string; a: string }[]
}

/** 프리픽스 뒤에 붙는 가변부 — 여기부터는 캐시되지 않는다 */
export function buildTurn(t: TurnInput): string {
  const lines: string[] = []
  for (const h of t.history) {
    lines.push(`탐정: ${h.q}`)
    lines.push(`나: ${h.a}`)
  }
  if (t.presentedEvidence) {
    lines.push(`[탐정이 증거를 내밀었다] ${t.presentedEvidence}`)
  }
  lines.push(`탐정: ${t.question}`)
  lines.push(`(현재 당신의 동요 정도: ${t.pressure}/100)`)
  return lines.join('\n')
}

/**
 * 구조화 출력 스키마 — OpenAI strict 모드.
 * strict 는 **모든 필드가 required** 이고 `additionalProperties:false` 가 필수다.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    speech: { type: 'string', description: '인물의 대사. 3문장 120자 이내.' },
    revealedFactIds: {
      type: 'array',
      items: { type: 'string' },
      description: '이번 답변에서 언급한 사실 id. 지식 시트 밖 id 금지.',
    },
    pressureDelta: { type: 'integer', description: '동요 변화량 -20~40' },
    tell: { type: 'string', enum: ['none', 'gaze', 'pause', 'stammer', 'anger'] },
  },
  required: ['speech', 'revealedFactIds', 'pressureDelta', 'tell'],
  additionalProperties: false,
} as const

export interface PersonaReply {
  speech: string
  revealedFactIds: string[]
  pressureDelta: number
  tell: 'none' | 'gaze' | 'pause' | 'stammer' | 'anger'
}
