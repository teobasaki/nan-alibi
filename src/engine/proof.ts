/**
 * 증명 계층 — **범인을 발견하는 게임에서 가설을 증명하는 게임으로** (명세 V0.2 §24~§34).
 *
 * 최종 판정은 특정 Evidence id 가 아니라 **증명된 명제**를 기준으로 한다.
 * ```
 * 제출된 Clue → 연결 확인 → Support Rule 평가 → Proposition 성립 → 추론 Closure → Verdict
 * ```
 * **AI 는 이 과정에 참여하지 않는다** (§33). 이 파일에 LLM 호출은 없고, 전부 순수 함수다.
 *
 * ## 왜 명제인가
 * 기존 판정은 "결정적 Evidence 1개를 골랐는가" 였다. 그러면 게임이 *어떤 증거를 찾는가*로
 * 좁아진다. 명제 기준은 *무엇이 성립했는가*를 본다 — 같은 결론에 두 길이 있어도 둘 다 옳다
 * (§27·§28 의 Proof Path A/B, AC-15).
 *
 * ## 경계
 * - 정답을 알려주지 않는다. Verdict 는 무엇이 부족한지까지만 말한다 (§34).
 * - 범인 이름을 이 파일에 적지 않는다. 사건 데이터가 준다.
 * - 난수 없음. 같은 제출은 언제나 같은 Verdict 다.
 */

import type { ClaimState } from './inquiry'

/* ────────────────────────────── 모양 ────────────────────────────── */

/**
 * 명제 하나를 지지하는 규칙. 한 명제에 여러 규칙을 두면 **아무 규칙 하나로도 성립**한다 —
 * 그것이 "같은 사실에 이르는 여러 경로" 의 구현이다 (§28 Support Route A/B).
 */
export interface SupportRule {
  /** 이 Clue 들이 **전부** 제출돼야 한다 */
  allOf?: string[]
  /** 이 중 **하나**라도 제출되면 된다 */
  anyOf?: string[]
  /** 이 명제들이 먼저 성립해야 한다 (추론 Closure) */
  derivedFrom?: string[]
}

export type PropositionState = 'UNKNOWN' | 'SUPPORTED' | 'PROVEN'

export interface ProofProposition {
  id: string
  statement: string
  supportRules: SupportRule[]
}

/** 명세 §32 */
export interface DeductionSubmission {
  culpritId: string
  methodId: string
  selectedClueIds: string[]
  connections: { fromId: string; toId: string }[]
}

/** 명세 §34 */
export type Verdict =
  | 'PROVEN'
  | 'CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE'
  | 'METHOD_UNPROVEN'
  | 'CONTRADICTORY_PROOF'
  | 'UNPROVEN'

export interface ProofContext {
  /** 이 사건의 명제 표 */
  propositions: readonly ProofProposition[]
  /** 범인을 입증하려면 성립해야 하는 명제들 (§26) */
  culpritProof: { suspectId: string; requires: readonly string[] }
  /** 범행 방식을 입증하려면 성립해야 하는 명제들 */
  methodProof: { methodId: string; requires: readonly string[] }
  /** 플레이어가 실제로 쥔 Clue — 손에 없는 것을 근거로 낼 수는 없다 */
  held: readonly string[]
  /**
   * **브리핑으로 이미 아는 것** — 근거 칸을 쓰지 않고 규칙 평가에 들어간다.
   *
   * 사람은 논증할 때 "피해자가 그날 밤 사망했다" 를 증거로 인용하지 않는다. 그건 전제다.
   * 이 목록이 없으면 플레이어가 전제를 근거 슬롯으로 사 와야 하고(§31 은 2~4개를 말한다),
   * 실제로 그렇게 두니 두 축(PROP-05·06)을 동시에 세울 방법이 없었다 — 실측으로 걸린 문제다.
   */
  given?: readonly string[]
  /** Claim 상태 — 이미 반박된 진술을 근거로 쓰면 모순이다 */
  claimStates: Readonly<Record<string, ClaimState>>
  /** Clue id → 그 Clue 가 대체한 Clue id (수정 진술). 원본과 수정본을 함께 내면 모순이다 */
  revisionOf?: Readonly<Record<string, string>>
}

export interface ProofResult {
  verdict: Verdict
  /** 명제별 상태 — 결과 화면이 "무엇이 성립했나" 를 그린다 */
  propositions: Record<string, PropositionState>
  /** 성립한 명제 id */
  proven: string[]
  /** 범인 축이 섰는가 */
  culpritProven: boolean
  /** 방식 축이 섰는가 */
  methodProven: boolean
  /** 왜 이 판정인가 — **정답은 말하지 않는다** */
  reasons: string[]
  /** 제출에서 버려진 Clue (손에 없는 것) */
  ignored: string[]
}

/* ────────────────────────────── 평가 ────────────────────────────── */

const satisfied = (rule: SupportRule, clues: Set<string>, proven: Set<string>): boolean => {
  if (rule.allOf?.length && !rule.allOf.every((id) => clues.has(id))) return false
  if (rule.anyOf?.length && !rule.anyOf.some((id) => clues.has(id))) return false
  if (rule.derivedFrom?.length && !rule.derivedFrom.every((id) => proven.has(id))) return false
  // 빈 규칙은 성립으로 보지 않는다 — 데이터 실수로 명제가 공짜가 되면 안 된다
  return Boolean(rule.allOf?.length || rule.anyOf?.length || rule.derivedFrom?.length)
}

/**
 * 명제 상태를 **닫힐 때까지** 계산한다 (§33 5단계 추론 Closure).
 * `derivedFrom` 때문에 한 번 훑는 것으로는 부족하다 — 앞 명제가 성립하면 뒤 명제가 열린다.
 * 표 크기가 작고(7개) 단조 증가하므로 반복은 반드시 끝난다.
 */
export function closeProof(
  propositions: readonly ProofProposition[],
  clues: Set<string>,
): { state: Record<string, PropositionState>; proven: Set<string> } {
  const proven = new Set<string>()
  const state: Record<string, PropositionState> = {}
  for (const p of propositions) state[p.id] = 'UNKNOWN'

  for (let pass = 0; pass < propositions.length + 1; pass++) {
    let grew = false
    for (const p of propositions) {
      if (proven.has(p.id)) continue
      const hit = p.supportRules.some((r) => satisfied(r, clues, proven))
      if (hit) { proven.add(p.id); state[p.id] = 'PROVEN'; grew = true }
      else if (state[p.id] === 'UNKNOWN' && partial(p, clues)) state[p.id] = 'SUPPORTED'
    }
    if (!grew) break
  }
  return { state, proven }
}

/** 규칙의 일부만 충족됐는가 — 화면이 "가까워졌다" 를 말할 수 있게 (§34 의 불완전한 Proof) */
function partial(p: ProofProposition, clues: Set<string>): boolean {
  return p.supportRules.some((r) =>
    (r.allOf ?? []).some((id) => clues.has(id)) || (r.anyOf ?? []).some((id) => clues.has(id)))
}

/**
 * 제출을 판정한다. **정답을 알려주지 않는다** — 무엇이 부족한지까지만 말한다 (§34).
 *
 * 순서는 명세 §33 그대로다: 제출 Clue 확인 → 연결 확인 → Support Rule 평가 →
 * 명제 생성 → Closure → 범인 Proof → 방식 Proof → Verdict.
 */
export function validateProof(sub: DeductionSubmission, ctx: ProofContext): ProofResult {
  const reasons: string[] = []
  const held = new Set(ctx.held)

  /* ① 제출된 Clue 확인 — 손에 없는 것은 근거가 아니다 */
  const ignored = sub.selectedClueIds.filter((id) => !held.has(id))
  // 전제(브리핑 사실)는 고르지 않아도 평가에 들어간다
  const clues = new Set([
    ...sub.selectedClueIds.filter((id) => held.has(id)),
    ...(ctx.given ?? []),
  ])
  if (ignored.length) reasons.push('확보하지 않은 근거는 셈에서 빠졌다.')

  /* ② 모순 검사 — 서로 양립할 수 없는 것을 함께 근거로 냈는가 (§34 CONTRADICTORY_PROOF) */
  const contradictions: string[] = []
  for (const id of clues) {
    // 이미 기록과 어긋난 진술을 근거로 쓰면 모순이다
    if (ctx.claimStates[id] === 'DISPROVED') contradictions.push(id)
    // 원본과 수정본을 함께 내는 것도 모순이다 — 둘 중 하나만 성립할 수 있다
    const origin = ctx.revisionOf?.[id]
    if (origin && clues.has(origin)) contradictions.push(origin)
  }
  if (contradictions.length) {
    return {
      verdict: 'CONTRADICTORY_PROOF',
      propositions: Object.fromEntries(ctx.propositions.map((p) => [p.id, 'UNKNOWN' as const])),
      proven: [],
      culpritProven: false,
      methodProven: false,
      reasons: ['서로 양립할 수 없는 근거가 함께 들어 있다. 어긋난 진술과 고쳐진 진술을 같은 근거로 쓸 수는 없다.'],
      ignored,
    }
  }

  /* ③~⑤ 규칙 평가 + Closure */
  const { state, proven } = closeProof(ctx.propositions, clues)

  /* ⑥ 범인 Proof */
  const culpritRight = sub.culpritId === ctx.culpritProof.suspectId
  const missingCulprit = ctx.culpritProof.requires.filter((id) => !proven.has(id))
  const culpritProven = culpritRight && missingCulprit.length === 0

  /* ⑦ 방식 Proof */
  const methodRight = sub.methodId === ctx.methodProof.methodId
  const missingMethod = ctx.methodProof.requires.filter((id) => !proven.has(id))
  const methodProven = methodRight && missingMethod.length === 0

  /* ⑧ Verdict */
  let verdict: Verdict
  if (culpritProven && methodProven) {
    verdict = 'PROVEN'
  } else if (culpritProven && !methodProven) {
    verdict = 'METHOD_UNPROVEN'
    reasons.push('범인에 대한 논증은 섰지만, 범행 방식을 뒷받침하는 근거가 부족하다.')
  } else if (proven.size > 0 && somePointsAt(sub.culpritId, ctx, proven)) {
    /**
     * **선택한 인물에 대한 추론은 가능하지만 다른 후보를 제거하지 못했다** (§34).
     * "수상함 ≠ 증명" 이 이 판정의 존재 이유다 (§30 Case A).
     */
    verdict = 'CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE'
    reasons.push('현재 추론만으로는 다른 가능성이 남아 있습니다.')
  } else {
    verdict = 'UNPROVEN'
    reasons.push('선택한 인물과 범행을 연결할 논리가 아직 서지 않았다.')
  }

  return {
    verdict,
    propositions: state,
    proven: [...proven],
    culpritProven,
    methodProven,
    reasons,
    ignored,
  }
}

/**
 * 그 인물을 **가리키기는 하는가** — 범인 축 명제 중 하나라도 성립했으면 그렇다.
 * 이름을 여기서 비교하지 않는다: 사건이 준 `culpritProof.suspectId` 와만 견준다.
 */
function somePointsAt(culpritId: string, ctx: ProofContext, proven: Set<string>): boolean {
  if (culpritId !== ctx.culpritProof.suspectId) return false
  return ctx.culpritProof.requires.some((id) => proven.has(id))
}

/**
 * 결과 화면에 쓰는 한 줄 (§34). **정답을 직접 알려주지 않는다.**
 */
export const VERDICT_LINE: Record<Verdict, string> = {
  PROVEN: '입증됐다 — 범인과 범행 방식이 근거로 연결됐다.',
  CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE: '현재 추론만으로는 다른 가능성이 남아 있습니다.',
  METHOD_UNPROVEN: '범인 논증은 섰다. 그러나 범행 방식이 아직 증명되지 않았다.',
  CONTRADICTORY_PROOF: '근거가 서로 어긋난다 — 같은 사건에서 양립할 수 없는 두 이야기를 함께 냈다.',
  UNPROVEN: '아직 증명되지 않았다 — 근거와 결론 사이가 이어지지 않는다.',
}
