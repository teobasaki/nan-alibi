/**
 * 조사 계층 — **가설을 세우고 증명하는 판** (명세 V0.2, ADR 031).
 *
 * 기존 `game.ts` 는 자원(조사 5회·대화 10회)과 3축 채점을 소유한다. 이 파일은 그 옆에서
 * **추리의 상태**를 소유한다: 무엇을 들었고(Claim), 무엇이 확정됐고(Fact·Evidence),
 * 어떤 진술이 흔들리며(ClaimState), 지금 누구를 의심하는가(Hypothesis).
 *
 * ## 이 파일의 경계 — 다섯 개의 금지
 * 1. **판정하지 않는다.** 어떤 Claim 이 거짓인지 여기서 결론내지 않는다. 충돌 가능성은
 *    `QUESTIONABLE` 까지만 올라가고, 그다음은 **플레이어가 움직여야** 한다 (명세 §14·AC-12).
 * 2. **Evidence 를 만들지 않는다.** Evidence 는 사건 세계에 처음부터 있고 플레이어가 발견한다.
 *    `NPC 심문 → E03 생성` 구조를 핵심 경로에 쓰지 않는다 (명세 §8·금지 1).
 * 3. **Claim 을 지우지 않는다.** 말이 바뀌면 두 Claim 이 **나란히** 남는다 — 그 변화 자체가
 *    추리 정보다 (명세 §15).
 * 4. **`Math.random()` 을 쓰지 않는다** (불변식 5). 이 계층에 난수는 아예 없다.
 * 5. **AI 를 부르지 않는다.** 순수 함수만 있고, 전부 불변이다 (`game.ts` 와 같은 규율).
 *
 * ## 왜 상태를 여기 따로 드는가
 * `GameState` 를 확장하면 시드 사건 400개의 결정론이 깨진다 (ADR 031 의 버린 대안).
 * 조사 계층은 `GameState` 를 **읽기만** 하고 자기 상태를 따로 든다.
 */

import type { SuspectId } from '../types'

/* ────────────────────────────── Clue — 추리에 쓰는 정보의 상위 개념 ────────────────────────────── */

/** 명세 §7. 세 종류의 정보를 한 이름으로 다룬다 — 수사일지·근거 선택·Proof 가 같은 목록을 본다 */
export type ClueType = 'CLAIM' | 'FACT' | 'EVIDENCE'

/**
 * Evidence 의 상태 (명세 §8).
 * `UNDERSTOOD` 가 따로 있는 이유: 기록을 손에 넣은 것과 그 의미를 아는 것은 다르다.
 * 카메라 조각을 확보해도 "라벨이 바뀌었다" 를 읽어내지 못하면 Proof 에 쓸 수 없다.
 */
export type EvidenceState = 'AVAILABLE' | 'DISCOVERED' | 'UNDERSTOOD'

/**
 * Claim 의 상태 (명세 §13).
 *
 * `KNOWN` 들었다 (Truth 여부는 모른다) · `QUESTIONABLE` 충돌 가능 정보가 나타났다 ·
 * `CHALLENGED` 플레이어가 추궁했다 · `REVISED` 인물이 말을 고쳤다 ·
 * `CONFIRMED` 객관 정보와 일치한다 · `DISPROVED` 객관 정보와 양립 불가.
 *
 * **`QUESTIONABLE` 은 "거짓말" 이 아니다.** 시스템이 거짓을 선언하는 순간 추리가 사라진다.
 */
export type ClaimState =
  | 'KNOWN' | 'QUESTIONABLE' | 'CHALLENGED' | 'REVISED' | 'CONFIRMED' | 'DISPROVED'

/** 인물이 한 말 한 조각 (명세 §7 CLAIM). Truth 가 아니다 — 그게 이 타입의 존재 이유다 */
export interface ClaimDef {
  id: string
  speaker: SuspectId
  /** 화면에 그대로 뜨는 진술문. 정본 §10 의 문장을 옮긴다 */
  text: string
  /** 이 진술이 가리키는 시각 라벨 (없으면 시각과 무관한 진술) */
  at?: string
  /**
   * 이 Claim 과 **충돌할 수 있는** Clue 들. 하나라도 손에 들어오면 `QUESTIONABLE` 이 된다.
   * ⚠️ "충돌한다" 가 아니라 "충돌할 수 있다" 다 — 판정은 플레이어가 한다 (AC-12).
   */
  tension?: string[]
  /**
   * 추궁(`CHALLENGED`)이 성립했을 때 인물이 내놓는 **수정 진술** id.
   * 없으면 그 인물은 이 화제에서 말을 고치지 않는다 (모든 인물이 말을 고칠 필요는 없다).
   */
  revisedTo?: string
  /** 이 Claim 이 어떤 Claim 을 대체하는가 — 수정 진술 쪽에 적는다. 원본은 지우지 않는다 */
  revises?: string
}

/** 객관적으로 확정된 사건 정보 (명세 §7 FACT). Claim 과 달리 거짓일 수 없다 */
export interface FactDef {
  id: string
  text: string
  /**
   * 이 Fact 를 어떻게 알 수 있나 — 화면의 출처 한 줄.
   * "시스템이 알려준다" 가 아니라 "어디서 확인된다" 를 적는다.
   */
  source: string
  /** 처음부터 알고 있는 사실인가 (사건 브리핑에 포함된 것) */
  known?: boolean
}

/* ────────────────────────────── 조사 상태 ────────────────────────────── */

/** Claim 하나의 지금 상태 + 그 상태가 된 근거 */
export interface ClaimTrack {
  state: ClaimState
  /** 이 상태로 밀어올린 Clue id 들 (플레이어가 화면에서 근거를 볼 수 있어야 한다) */
  because: string[]
}

/** 가설 (명세 §21) */
export type HypothesisStatus = 'DRAFT' | 'SUPPORTED' | 'CONTESTED' | 'DISPROVED' | 'PROVEN'

export interface Hypothesis {
  id: string
  subjectId?: SuspectId
  proposition: string
  supportClueIds: string[]
  counterClueIds: string[]
  proofPropositionIds: string[]
  status: HypothesisStatus
}

export interface InquiryState {
  /** Evidence id → 상태. 목록에 없으면 `AVAILABLE`(세계에는 있지만 아직 못 봤다) */
  evidence: Record<string, EvidenceState>
  /** Claim id → 상태. 목록에 없으면 아직 **듣지 못한** 진술이다 */
  claims: Record<string, ClaimTrack>
  /** 확인한 Fact id 들 */
  facts: string[]
  /** 플레이어가 이어 본 Clue 쌍 — 제출의 `connections` 초안이 된다 */
  links: [string, string][]
  /**
   * 지금 가장 의심하는 인물 (명세 §22). **정답 제출이 아니다.**
   * 언제든 바꿀 수 있고, 바꿔도 아무 자원을 소모하지 않는다.
   */
  suspect: SuspectId | null
  hypotheses: Hypothesis[]
  /** 플레이어 메모 (명세 §36) */
  memo: string
}

export function createInquiry(): InquiryState {
  return { evidence: {}, claims: {}, facts: [], links: [], suspect: null, hypotheses: [], memo: '' }
}

/* ────────────────────────────── 리듀서 — 전부 불변 ────────────────────────────── */

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)]

export const evidenceStateOf = (s: InquiryState, id: string): EvidenceState =>
  s.evidence[id] ?? 'AVAILABLE'

/** 기록을 확보했다 — `AVAILABLE → DISCOVERED`. 이미 이해한 기록은 내려가지 않는다 */
export function discover(s: InquiryState, id: string): InquiryState {
  if (evidenceStateOf(s, id) !== 'AVAILABLE') return s
  return { ...s, evidence: { ...s.evidence, [id]: 'DISCOVERED' } }
}

/**
 * 기록의 의미를 파악했다 — `DISCOVERED → UNDERSTOOD`.
 * **발견하지 않은 기록은 이해할 수 없다.** 순서를 건너뛰면 조용히 무시한다.
 */
export function understand(s: InquiryState, id: string): InquiryState {
  if (evidenceStateOf(s, id) !== 'DISCOVERED') return s
  return { ...s, evidence: { ...s.evidence, [id]: 'UNDERSTOOD' } }
}

export const claimStateOf = (s: InquiryState, id: string): ClaimState | null =>
  s.claims[id]?.state ?? null

/** 진술을 들었다 — 없으면 `KNOWN` 으로 들어온다. **이미 있는 상태를 되돌리지 않는다** */
export function hear(s: InquiryState, id: string, because: string[] = []): InquiryState {
  const cur = s.claims[id]
  if (cur) return because.length ? note(s, id, because) : s
  return { ...s, claims: { ...s.claims, [id]: { state: 'KNOWN', because: uniq(because) } } }
}

/** 근거만 덧붙인다 (상태는 그대로) */
function note(s: InquiryState, id: string, because: string[]): InquiryState {
  const cur = s.claims[id]
  if (!cur) return s
  return {
    ...s,
    claims: { ...s.claims, [id]: { ...cur, because: uniq([...cur.because, ...because]) } },
  }
}

/**
 * 상태 전이의 서열 — **뒤로 가지 않는다.**
 * 같은 Clue 를 다시 봐도 `CHALLENGED` 가 `QUESTIONABLE` 로 내려가면 플레이어가 한 일이 사라진다.
 * `CONFIRMED`/`DISPROVED` 는 객관 정보가 정한 종착점이라 가장 높다.
 */
const RANK: Record<ClaimState, number> = {
  KNOWN: 0, QUESTIONABLE: 1, CHALLENGED: 2, REVISED: 3, CONFIRMED: 4, DISPROVED: 4,
}

function raise(s: InquiryState, id: string, to: ClaimState, because: string[]): InquiryState {
  const cur = s.claims[id] ?? { state: 'KNOWN' as ClaimState, because: [] }
  const next: ClaimTrack = {
    state: RANK[to] > RANK[cur.state] ? to : cur.state,
    because: uniq([...cur.because, ...because]),
  }
  return { ...s, claims: { ...s.claims, [id]: next } }
}

/**
 * 충돌 **가능성**이 생겼다 — `QUESTIONABLE`.
 * 이름을 `suspectLie` 로 하지 않은 이유가 여기 있다: 시스템은 거짓말을 선언하지 않는다.
 * 들은 적 없는 진술에는 걸지 않는다 — 안 들은 말이 흔들릴 수는 없다.
 */
export function question(s: InquiryState, id: string, because: string[]): InquiryState {
  if (!s.claims[id]) return s
  return raise(s, id, 'QUESTIONABLE', because)
}

/** 플레이어가 추궁했다 — `CHALLENGED`. **자동으로 일어나지 않는다** (명세 §14) */
export function challenge(s: InquiryState, id: string, because: string[] = []): InquiryState {
  if (!s.claims[id]) return s
  return raise(s, id, 'CHALLENGED', because)
}

export interface ReviseResult {
  state: InquiryState
  /** 새로 들은 수정 진술 id (없으면 인물이 말을 고치지 않았다) */
  revised: string | null
}

/**
 * 인물이 말을 고쳤다 — 원본은 `DISPROVED`, 새 진술은 `REVISED` 로 **함께** 남는다 (명세 §15·§18).
 * 원본을 지우면 "무엇이 어떻게 바뀌었나" 라는 정보가 사라진다.
 */
export function revise(s: InquiryState, id: string, revisedId: string): ReviseResult {
  if (!s.claims[id]) return { state: s, revised: null }
  const withNew = raise(hear(s, revisedId, [id]), revisedId, 'REVISED', [id])
  return { state: raise(withNew, id, 'DISPROVED', [revisedId]), revised: revisedId }
}

/** 객관 정보와 일치했다 — `CONFIRMED` */
export function confirm(s: InquiryState, id: string, because: string[]): InquiryState {
  if (!s.claims[id]) return s
  return raise(s, id, 'CONFIRMED', because)
}

/** 객관 정보와 양립 불가 — `DISPROVED`. 수정 진술 없이도 이 상태가 될 수 있다 */
export function disprove(s: InquiryState, id: string, because: string[]): InquiryState {
  if (!s.claims[id]) return s
  return raise(s, id, 'DISPROVED', because)
}

/** Fact 를 확인했다 */
export function learnFact(s: InquiryState, id: string): InquiryState {
  return s.facts.includes(id) ? s : { ...s, facts: [...s.facts, id] }
}

/** Clue 둘을 이어 봤다. 순서는 의미가 없으므로 같은 쌍은 한 번만 쌓인다 */
export function link(s: InquiryState, a: string, b: string): InquiryState {
  if (a === b) return s
  const has = s.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  return has ? s : { ...s, links: [...s.links, [a, b]] }
}

/** 지금 의심하는 인물을 바꾼다 — 자원을 소모하지 않고, 언제든 되돌릴 수 있다 (명세 §22) */
export function setSuspect(s: InquiryState, who: SuspectId | null): InquiryState {
  return { ...s, suspect: who }
}

export function setMemo(s: InquiryState, memo: string): InquiryState {
  return { ...s, memo }
}

/** 가설을 세우거나 갱신한다. 같은 id 면 덮어쓴다 */
export function upsertHypothesis(s: InquiryState, h: Hypothesis): InquiryState {
  const i = s.hypotheses.findIndex((x) => x.id === h.id)
  const hypotheses = i < 0 ? [...s.hypotheses, h] : s.hypotheses.map((x, k) => (k === i ? h : x))
  return { ...s, hypotheses }
}

/* ────────────────────────────── 조회 ────────────────────────────── */

/** 손에 들어온 Clue id 전부 — 근거 선택·Proof 가 이 목록에서만 고를 수 있다 */
export function heldClueIds(s: InquiryState): string[] {
  return [
    ...Object.entries(s.evidence).filter(([, v]) => v !== 'AVAILABLE').map(([k]) => k),
    ...Object.keys(s.claims),
    ...s.facts,
  ]
}

/** 흔들리는 진술 — 다음 질문거리다. 수사일지가 이 목록을 보여 준다 */
export function shakyClaims(s: InquiryState): string[] {
  return Object.entries(s.claims)
    .filter(([, t]) => t.state === 'QUESTIONABLE' || t.state === 'CHALLENGED')
    .map(([id]) => id)
}
