/**
 * 지식 규칙 엔진 — **말할 수 있는 범위를 코드가 먼저 정한다** (명세 V0.2 §16·§35).
 *
 * ```
 * PLAYER QUESTION → QUESTION INTENT → RULE ENGINE → 허용 Claim/Fact → PERSONA AI → 자연어
 * ```
 *
 * AI 의 역할은 **표현**이다. 사건 Fact 나 진행 조건을 결정하지 않는다 (금지 5).
 * 이 파일은 그 경계의 실체다 — 여기서 나온 목록 밖의 내용을 AI 가 말하면 검증기가 잡는다.
 *
 * ## 이 엔진이 푸는 문제 (팀 3-3-(5))
 * *"모든 질문에서 정보를 숨기거나 모호하게 답한다면 플레이어가 새로운 사실을 얻을 방법이
 * 없어진다."* 그래서 정보를 네 층으로 나눈다 (명세 §9 1단계):
 *
 * | 층 | 규칙 필드 | 행동 |
 * |---|---|---|
 * | 일반적인 사실 | `availableFactIds` · `baseClaimIds` | **묻는 즉시 사실대로 답한다** (AC-11) |
 * | 숨기고 싶은 정보 | `defensiveClaimIds` | 처음에는 빼거나 돌려 말한다 |
 * | 거짓말해야 하는 정보 | `defensiveClaimIds` + `revisedClaimIds` | 숨길 이유가 있는 인물만 |
 * | 핵심 비밀 | `revisedClaimIds` + `requiredContextIds` | 근거를 쥐고 추궁해야 열린다 |
 *
 * **모든 용의자가 모든 질문에 거짓말할 필요는 없다.** 규칙이 없는 화제는 그냥 모르는 화제다.
 *
 * ## 경계
 * - Truth 를 읽지 않는다. 이 파일은 `Suspect.truth`·`isCulprit` 를 import 하지 않는다.
 * - 난수 없음. 같은 (인물·의도·상태)는 언제나 같은 허용 범위다.
 * - 판정하지 않는다. Claim 상태를 바꾸는 것은 `inquiry.ts` 의 리듀서이고, 그 호출은 UI 가 한다.
 */

import type { SuspectId } from '../types'
import type { ClaimState } from './inquiry'
import type { QuestionIntent } from './intent'

/** 명세 §16 `PersonaReaction` — 연기 지시. 게임 상태를 바꾸지 않는다 */
export type PersonaReaction =
  | 'NEUTRAL' | 'COOPERATIVE' | 'GUARDED' | 'DEFENSIVE' | 'ANXIOUS' | 'SHAKEN'

/** 명세 §16 */
export interface PersonaKnowledgeRule {
  suspectId: SuspectId
  intent: QuestionIntent
  /** 이 화제에서 평소 내놓는 진술 */
  baseClaimIds?: string[]
  /** 이 화제에서 **그냥 알려주는 객관 사실** — 숨길 이유가 없는 것 (AC-11) */
  availableFactIds?: string[]
  /** 처음에는 빼거나 돌려 말하는 진술 */
  defensiveClaimIds?: string[]
  /** 추궁이 성립하면 내놓는 수정 진술 */
  revisedClaimIds?: string[]
  /**
   * 수정 진술이 열리기 위해 플레이어가 쥐고 있어야 하는 Clue — **any-of** 다.
   *
   * 하나만 있으면 되는 이유가 명세에 있다: AC-04·05·06 은 "특정 Evidence 를 특정 인물에게
   * 제시해야만 다음 단계" 를 금지한다(금지 2). 여러 근거 중 아무거나로 같은 곳에 닿아야 한다.
   * 정말 두 개가 필요한 논증은 Proof 계층이 맡는다 — 대화의 문턱은 낮게 둔다.
   */
  requiredContextIds?: string[]
  reaction?: PersonaReaction
}

/** 대화 한 턴에서 페르소나가 할 수 있는 것 */
export type ResponseMode =
  /** 아는 것을 답한다 */
  | 'ANSWER'
  /** 숨기고 싶은 것이 있어 돌려 답한다 */
  | 'DEFLECT'
  /** 말을 고친다 — 원래 진술은 남는다 */
  | 'REVISE'
  /** 이 화제를 모른다 */
  | 'UNSURE'
  /** 질문의 의도를 못 읽었다 — 되묻는다 (명세 §12) */
  | 'CLARIFY'

/** 명세 §35 의 `Allowed Response Payload` */
export interface AllowedResponse {
  speakerId: SuspectId
  intent: QuestionIntent
  mode: ResponseMode
  /** 이번 턴에 말해도 되는 진술 id */
  claimIds: string[]
  /** 이번 턴에 말해도 되는 객관 사실 id */
  factIds: string[]
  reaction: PersonaReaction
  /** 절대 말하면 안 되는 것 — 프롬프트에 **내용을 넣지 않고** id 만 남긴다 */
  forbiddenFactIds: string[]
  /** 이번 턴에 수정된 진술이 있으면 (원본, 수정) 쌍 — 호출부가 상태기계를 돌린다 */
  revisionOf?: [string, string]
}

export interface AllowedInput {
  suspectId: SuspectId
  intent: QuestionIntent
  /** 플레이어가 손에 쥔 Clue id 전부 (`heldClueIds`) */
  held: readonly string[]
  /** Claim id → 지금 상태. 추궁(`CHALLENGED`)이 수정의 문을 연다 */
  claimStates: Readonly<Record<string, ClaimState>>
  /** 함께 들이민 Clue (PRESENT_CLUE 경로) */
  presentedClueIds?: readonly string[]
  /** 의도 확신도. 낮으면 되묻는다 — 그래도 질문 1회는 소모된다 (명세 §12) */
  confidence?: number
  rules: readonly PersonaKnowledgeRule[]
}

/**
 * **절대 프롬프트에 실리지 않는 것.** id 만 목록으로 남겨 서버가 대조할 수 있게 한다.
 * (내용을 넣고 "말하지 마세요" 라고 쓰는 것이 유출 설계다 — prompt.ts 머리말과 같은 규율.)
 */
export const FORBIDDEN_FACT_IDS: readonly string[] = [
  'F-GC001-CULPRIT',
  'F-GC001-METHOD',
  'F-GC001-COVERUP-SEQUENCE',
]

const has = (held: readonly string[], ids?: readonly string[]): boolean =>
  !ids?.length ? false : ids.some((id) => held.includes(id))

/**
 * 이 턴에 무엇을 말할 수 있는가.
 *
 * 결정 순서:
 *   ① 의도를 못 읽었으면 되묻는다 (`CLARIFY`)
 *   ② 규칙이 없으면 모르는 화제다 (`UNSURE`)
 *   ③ 수정 진술이 있고 **추궁이 성립**했으면 말을 고친다 (`REVISE`)
 *   ④ 숨기고 싶은 것이 있으면 돌려 답한다 (`DEFLECT`)
 *   ⑤ 그 밖에는 아는 것을 답한다 (`ANSWER`)
 *
 * ③의 "추궁이 성립" 은 둘 중 하나다 — 플레이어가 그 진술을 직접 추궁했거나(`CHALLENGED`),
 * `requiredContextIds` 중 하나를 **쥐고서** 이 화제를 물었거나. 후자가 있는 이유:
 * 명세 §14 는 자동 전이를 금지하지만, 근거를 들고 같은 화제를 다시 묻는 것은
 * **플레이어의 행동**이다. 시스템이 알아서 올린 것이 아니다.
 */
export function allowedResponse(input: AllowedInput): AllowedResponse {
  const { suspectId, intent, held, claimStates, presentedClueIds, rules } = input
  const base: Omit<AllowedResponse, 'mode' | 'claimIds' | 'factIds' | 'reaction'> = {
    speakerId: suspectId,
    intent,
    forbiddenFactIds: [...FORBIDDEN_FACT_IDS],
  }

  if (intent === 'UNKNOWN' || (input.confidence !== undefined && input.confidence <= 0.25)) {
    return { ...base, mode: 'CLARIFY', claimIds: [], factIds: [], reaction: 'NEUTRAL' }
  }

  const mine = rules.filter((r) => r.suspectId === suspectId)
  /**
   * 제시·추궁은 **화제가 아니라 대상**을 가리킨다. `PRESENT_CLUE`·`CHALLENGE_CLAIM`·
   * `ASK_REASON_FOR_LIE` 로 들어오면 그 인물의 규칙 전체에서 열릴 수 있는 것을 찾는다 —
   * "이 기록을 어떻게 설명하겠습니까" 는 특정 화제어가 없지만 답은 있어야 한다.
   */
  const wide = intent === 'PRESENT_CLUE' || intent === 'CHALLENGE_CLAIM' || intent === 'ASK_REASON_FOR_LIE'
  const scoped = wide ? mine : mine.filter((r) => r.intent === intent)
  if (scoped.length === 0) {
    // 이 사람의 규칙이 아예 없으면 모르는 화제다. 되묻지 않고 모른다고 답한다.
    return { ...base, mode: 'UNSURE', claimIds: [], factIds: [], reaction: 'GUARDED' }
  }

  const context = [...held, ...(presentedClueIds ?? [])]

  /* ③ 수정 — 추궁이 성립했는가 */
  for (const r of scoped) {
    if (!r.revisedClaimIds?.length) continue
    const target = r.defensiveClaimIds?.[0] ?? r.baseClaimIds?.[0]
    const challenged = !!target && (claimStates[target] === 'CHALLENGED')
    const withEvidence = has(context, r.requiredContextIds)
    if (!challenged && !withEvidence) continue
    /**
     * **이미 고친 말을 또 고치지 않는다.** 수정 진술이 이미 손에 있으면 그 사람은
     * 같은 화제에서 다시 무너지지 않는다 — 그러면 심문이 자판기가 된다.
     */
    const already = r.revisedClaimIds.every((id) => claimStates[id])
    if (already) {
      return {
        ...base, mode: 'ANSWER',
        claimIds: [...r.revisedClaimIds],
        factIds: [...(r.availableFactIds ?? [])],
        reaction: r.reaction ?? 'GUARDED',
      }
    }
    return {
      ...base,
      mode: 'REVISE',
      claimIds: [...r.revisedClaimIds],
      factIds: [...(r.availableFactIds ?? [])],
      reaction: r.reaction ?? 'SHAKEN',
      ...(target ? { revisionOf: [target, r.revisedClaimIds[0]!] as [string, string] } : {}),
    }
  }

  /* ④ 숨김 — 돌려 답한다 */
  const defensive = scoped.find((r) => r.defensiveClaimIds?.length)
  if (defensive) {
    return {
      ...base,
      mode: 'DEFLECT',
      claimIds: [...defensive.defensiveClaimIds!],
      // 숨기는 화제에서도 **객관 사실은 준다** — 그게 AC-11 의 요구다
      factIds: [...(defensive.availableFactIds ?? [])],
      reaction: defensive.reaction ?? 'DEFENSIVE',
    }
  }

  /* ⑤ 답한다 */
  const claimIds = [...new Set(scoped.flatMap((r) => r.baseClaimIds ?? []))]
  const factIds = [...new Set(scoped.flatMap((r) => r.availableFactIds ?? []))]
  if (claimIds.length === 0 && factIds.length === 0) {
    return { ...base, mode: 'UNSURE', claimIds: [], factIds: [], reaction: 'GUARDED' }
  }
  return {
    ...base, mode: 'ANSWER', claimIds, factIds,
    reaction: scoped.find((r) => r.reaction)?.reaction ?? 'COOPERATIVE',
  }
}

/* ────────────────────────────── 프롬프트로 옮기기 ────────────────────────────── */

/** 규칙 엔진의 결과를 읽을 수 있는 문장으로 — 프롬프트의 **가변부**에 들어간다 */
export interface ClueTextLookup {
  claim(id: string): string | undefined
  fact(id: string): string | undefined
}

const MODE_LINE: Record<ResponseMode, string> = {
  ANSWER: '아래 내용을 사실대로 말하라. 숨기지 말고, 묻은 것에 답하라.',
  DEFLECT: '아래 진술을 유지하라. 더 자세히 말하지 말고, 질문을 살짝 비껴가라. 거짓을 새로 만들지는 마라.',
  REVISE: '지금까지의 말을 **고쳐야 한다.** 아래 내용을 인정하되, 자백하지는 마라 — 그 이상은 말하지 않는다.',
  UNSURE: '이 화제는 당신이 모른다. 모른다고 말하되, 아는 것이 있으면 그 결은 남겨라.',
  CLARIFY: '질문의 뜻을 정확히 알 수 없다. 무엇을 묻는지 되물어라. 아무것도 지어내지 마라.',
}

const REACTION_LINE: Record<PersonaReaction, string> = {
  NEUTRAL: '평온하게',
  COOPERATIVE: '협조적으로',
  GUARDED: '말을 아끼며',
  DEFENSIVE: '방어적으로',
  ANXIOUS: '불안하게',
  SHAKEN: '흔들리는 목소리로',
}

/**
 * 프롬프트 블록. **허용된 것만 글로 실린다** — 금지 항목은 id 도 내용도 넣지 않는다
 * (알려주면서 말하지 말라고 하는 것이 유출 설계다).
 */
export function renderAllowedBlock(a: AllowedResponse, look: ClueTextLookup): string {
  const claims = a.claimIds.map((id) => look.claim(id)).filter(Boolean)
  const facts = a.factIds.map((id) => look.fact(id)).filter(Boolean)
  const lines = [
    '[이번 답변의 범위 — 이 목록이 전부다]',
    `- 태도: ${REACTION_LINE[a.reaction]}`,
    `- 지시: ${MODE_LINE[a.mode]}`,
  ]
  if (claims.length) {
    lines.push('- 말할 수 있는 진술:')
    for (const t of claims) lines.push(`  · "${t}"`)
  }
  if (facts.length) {
    lines.push('- 말할 수 있는 객관 사실 (숨길 이유가 없다):')
    for (const t of facts) lines.push(`  · ${t}`)
  }
  if (!claims.length && !facts.length) {
    lines.push('- 말할 수 있는 새 내용이 없다. 새 시각·장소·인물·기록을 지어내지 마라.')
  }
  /**
   * id 형식 실수로 답변이 통째로 폐기되는 것을 막는다.
   * 실측: 모델이 `F:S5:2` 대신 `S5:2` 를 넣어 `unknown-fact` 로 반려되는 일이 있었다 —
   * 대사는 멀쩡한데 부수 필드 하나 때문에 버려진다. **비워도 된다**고 알려주는 편이 싸다
   * (검증기의 본 방어선은 대사 본문의 시각·장소 검사다).
   */
  lines.push('- 위 문장을 그대로 말할 때는 revealedFactIds 를 비워 두어도 된다.')
  return lines.join('\n')
}

/**
 * **규칙 기반 폴백** (AC-13) — AI 가 죽어도 사건이 진행된다.
 *
 * 기존 폴백은 페르소나별 회피 대사였다. 그것만 있으면 AI 장애 중에는 **아무 정보도** 안 나오고,
 * 그 상태로 질문 횟수를 쓰면 플레이어가 손해를 본다. 허용된 진술·사실이 있으면
 * 그 문장을 그대로 말하게 한다 — 표현은 투박하지만 **사건은 앞으로 간다.**
 * (문장은 사건 데이터의 것이므로 여기서 새 사실이 생기지 않는다.)
 */
export function ruleFallbackSpeech(a: AllowedResponse, look: ClueTextLookup): string | null {
  const claim = a.claimIds.map((id) => look.claim(id)).find(Boolean)
  if (claim) return claim
  const fact = a.factIds.map((id) => look.fact(id)).find(Boolean)
  if (fact) return fact
  if (a.mode === 'CLARIFY') return '어떤 일을 말씀하시는 건지 정확히 모르겠습니다.'
  if (a.mode === 'UNSURE') return '그 부분은 제가 알 수 없습니다.'
  return null
}
