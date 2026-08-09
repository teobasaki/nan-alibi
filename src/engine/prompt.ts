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
    `[당신] ${sus.name}, ${sus.age}세, ${sus.job}`,
    `- 피해자 ${c.victim.name}(${c.victim.title})와의 관계: ${sus.relation}`,
    // 동기 축(ADR 022)의 단서 경로. 다섯 명 전부 사정이 하나씩 있으므로 이 줄은 범인을 가르지 않는다.
    // 정면으로 물으면 부인하되 관계 이야기에서 결이 배어나게 한다 — 그래야 심문이 동기 지목의 근거가 된다.
    `- 피해자와 얽힌 사정: ${sus.motive}. 정면으로 물으면 인정하지 말되, 관계를 이야기할 때 그 그늘이 배어나게 하라.`,
    `- 사건 장소: ${c.venue.name} ${c.venue.room}`,
    sus.lieSlots.length
      ? `- 당신에게는 남에게 알리고 싶지 않은 사정이 있다: ${sus.lieReason}. 구체적 내용은 절대 먼저 말하지 마라.`
      : '- 당신은 숨기는 것이 없다.',
    '',
    `[말투] ${s}`,
    `- 문장: ${p.sentence}`,
    `- 버릇: ${p.tic} (매 문장 붙이지 말고 두세 번에 한 번만 — 기계처럼 들리면 실패다)`,
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
    '4. 답변은 2~3문장, 120자 이내. 인물의 말만 쓰고 지문·해설을 붙이지 마라.',
    '5. 당신은 자신이 범인인지 아닌지 모른다고 가정하고 행동하라. 자백하지 마라.',
    '',
    '[가장 중요한 규칙]',
    '6. **묻는 것에만 답하라.** 시각과 장소를 목록처럼 나열하지 마라.',
    '   한 답변에 시각은 최대 1개만 언급한다. 묻지도 않은 다른 시각을 덧붙이는 것은 금지다.',
    '7. 관계·감정·이유를 물으면 위치가 아니라 그 질문에 답하라.',
    '   위 [당신] 정보(직업·관계·사정)를 재료로 인물답게 답하라.',
    '   "말할 것이 없다" 로만 답하는 것은 이 심문에서 최악의 답변이다. 회피하더라도 결이 있어야 한다.',
    '   단, 새로운 시각·장소·인물 이름을 지어내는 것은 여전히 금지다.',
    '8. 같은 말을 반복하지 마라. 이미 한 말은 "아까 말씀드렸습니다" 로 줄이고 새로운 결을 더하라.',
    '9. 시각은 목록에 있는 값 그대로 하나만 말하라.',
    '   "22:00부터 22:30까지" 같은 **구간 표현을 절대 쓰지 마라** — 목록에 없는 주장이 된다.',
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
    /**
     * ## 대사와 **조서**를 분리한다
     *
     * QA 지적(5.3): "AI 가 자연스럽게 말해도 그 답변이 추리에 쓸 근거로 남지 않는다."
     * 플레이어가 대사에서 시간·장소·행동·확신도를 직접 뽑아내야 했고,
     * 그래서 대화는 풍부한데 사건은 진전되지 않는 느낌이 생겼다.
     *
     * **AI 는 인물을 연기하고, 시스템은 그 말을 검증 가능한 조서로 옮긴다.**
     * 같은 호출에서 둘을 함께 받으면 추가 지연이 0 이다.
     */
    statement: {
      type: 'object',
      properties: {
        time: { type: 'string', description: '이번 답변이 가리키는 시각. 모르면 빈 문자열.' },
        place: { type: 'string', description: '주장한 장소. 없으면 빈 문자열.' },
        action: { type: 'string', description: '무엇을 했다고 말했는가. 20자 이내.' },
        certainty: {
          type: 'string',
          enum: ['확언', '추정', '기억없음'],
          description: '본인이 얼마나 확신하는가',
        },
        newInfo: { type: 'boolean', description: '이전 답변에 없던 사실을 말했는가' },
      },
      required: ['time', 'place', 'action', 'certainty', 'newInfo'],
      additionalProperties: false,
    },
  },
  required: ['speech', 'revealedFactIds', 'pressureDelta', 'tell', 'statement'],
  additionalProperties: false,
} as const

/** 대사에서 뽑아낸 **조서 한 줄**. 플레이어의 기억 대신 시스템이 든다. */
export interface Statement {
  time: string
  place: string
  action: string
  certainty: '확언' | '추정' | '기억없음'
  newInfo: boolean
}

export interface PersonaReply {
  speech: string
  revealedFactIds: string[]
  pressureDelta: number
  tell: 'none' | 'gaze' | 'pause' | 'stammer' | 'anger'
  statement: Statement
}
