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
  PLACE_LABEL,
  SUSPECTS,
  type CaseFile,
  type Evidence,
  type Slot,
  type SuspectId,
} from '../types'
import { INVESTIGATION_BUDGET } from '../data/config'
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
  investigationsLeft: number
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

/** @param budget 밸런스 스윕용 오버라이드. 게임은 항상 기본값을 쓴다. */
export function createGame(c: CaseFile, budget = INVESTIGATION_BUDGET): GameState {
  // 기본 진술: 모든 인물의 **범행 시각** 주장만 무료 공개한다.
  // 나머지 시각은 심문해야 열린다 — 이게 심문에 값을 부여한다.
  const cards = SUSPECTS.map((s) => claimCardId(s, CRIME_SLOT))
  const pressure = Object.fromEntries(SUSPECTS.map((s) => [s, 0])) as Record<SuspectId, number>
  return {
    case: c,
    investigationsLeft: budget,
    cards,
    connections: [],
    foundContradictions: [],
    ruledOut: [],
    pressure,
    phase: 'investigate',
  }
}

function spend(g: GameState, cards: string[], pressureDelta?: [SuspectId, number]): GameState {
  const left = g.investigationsLeft - 1
  const pressure = pressureDelta
    ? { ...g.pressure, [pressureDelta[0]]: Math.max(0, Math.min(100, g.pressure[pressureDelta[0]] + pressureDelta[1])) }
    : g.pressure
  return {
    ...g,
    investigationsLeft: left,
    cards: [...new Set([...g.cards, ...cards])],
    pressure,
    phase: left <= 0 ? 'submit' : g.phase,
  }
}

function assertCanAct(g: GameState): void {
  if (g.phase !== 'investigate' || g.investigationsLeft <= 0) {
    throw new Error('조사 예산을 모두 소모했다 — 이제 지목만 가능하다')
  }
}

/** 지금 조회 가능한 물증 (선행 조건 충족 + 미보유) */
export function availableEvidence(g: GameState): Evidence[] {
  return g.case.evidence.filter(
    (e) => !g.cards.includes(e.id) && e.requires.every((r) => g.cards.includes(r)),
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
  return g.case.evidence
    .filter((e) => !g.cards.includes(e.id) && !e.requires.every((r) => g.cards.includes(r)))
    .map((e) => {
      const missing = e.requires
        .filter((r) => !g.cards.includes(r))
        .map((r) => (r === 'T-SLIP' ? '범인의 자백성 진술' : '관련자의 증언'))
      return { evidence: e, met: e.requires.length - missing.length, total: e.requires.length, missing }
    })
}

export function lookupEvidence(g: GameState, evId: string): GameState {
  assertCanAct(g)
  const e = g.case.evidence.find((x) => x.id === evId)
  if (!e) throw new Error(`없는 물증: ${evId}`)
  if (g.cards.includes(evId)) throw new Error(`이미 보유한 물증: ${evId}`)
  if (!e.requires.every((r) => g.cards.includes(r))) {
    throw new Error(`선행 조건 미충족: ${evId} (필요: ${e.requires.join(', ')})`)
  }
  return spend(g, [evId])
}

/** 심문 — 그 인물의 진술 궤적 5칸 + 보유 증언을 연다 */
export function interview(g: GameState, s: SuspectId): GameState {
  assertCanAct(g)
  const claims = ([0, 1, 2, 3, 4] as Slot[]).map((t) => claimCardId(s, t))
  return spend(g, [...claims, ...g.case.suspects[s].testimonies], [s, 10])
}

/**
 * 증거 제시 — **누구에게든 제시할 수 있고, 언제나 조사 1회를 소모한다.**
 *
 * 초기 구현은 "해금 관계가 없으면 거부" 였는데, 그게 **정답 유출 경로**였다:
 * 해금 쌍은 범인에게만 존재하므로, 카드를 하나 들고 다섯 명을 훑으면
 * 버튼이 켜지는 사람이 곧 범인이었다 — 조사 0회로 답이 새어나간다.
 *
 * 그래서 "낭비 방지" 를 포기하고 **낭비할 자유** 를 준다.
 * 헛된 제시는 인물의 회피 반응만 얻고 조사 1회를 잃는다 — 그게 자원 게임의 긴장이다.
 */
export function presentEvidence(g: GameState, evId: string, s: SuspectId): GameState {
  assertCanAct(g)
  if (!g.cards.includes(evId)) throw new Error(`보유하지 않은 증거: ${evId}`)
  const unlock = g.case.presentUnlocks.find((u) => u.evidenceId === evId && u.suspectId === s)
  const next = spend(g, unlock ? [unlock.yieldsTestimonyId] : [], [s, unlock ? 35 : 12])
  // 무반응도 정보다 — "이 조합은 아니다" 를 기록해 같은 실수를 반복하지 않게 한다.
  // 조사 1회를 잃고 아무것도 안 남으면 그건 벌이지 소거가 아니다 (ADR 010).
  return unlock ? next : { ...next, ruledOut: [...next.ruledOut, `${evId}|${s}`] }
}

/** 이 제시가 실제로 무언가를 열었는가 — UI 가 사후에 알려주기 위한 것 (사전 노출 금지) */
export function presentYields(g: GameState, evId: string, s: SuspectId): boolean {
  return g.case.presentUnlocks.some((u) => u.evidenceId === evId && u.suspectId === s)
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
    why = `기록에는 ${PLACE_LABEL[ev.place]}인데 본인은 ${PLACE_LABEL[claimed]}이라 했다`
  } else if (!inRecord && claimed === ev.place && ev.exhaustive) {
    // ② 부재 모순 — 그 구역을 남김없이 담은 기록에 그 사람이 없다.
    //    사람이 가장 먼저 떠올리는 추리다. exhaustive 가 아닌 기록(영수증·카드키)에는
    //    적용하지 않는다 — 결제/출입을 안 했을 뿐일 수 있으므로 논리적으로 성립하지 않는다.
    why = `${PLACE_LABEL[ev.place]} 구역 기록에 이 사람이 없다`
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

export interface Submission {
  culprit: SuspectId
  method: string
  decisiveEvidenceId: string
}

export interface SubmitResult {
  state: GameState
  correct: { culprit: boolean; method: boolean; decisive: boolean }
  /** 수단을 맞혔지만 판독 근거(결정적 증거 카드)가 없어 점수가 없는 경우 */
  methodGuessed: boolean
  /** 제출 시점에 기록으로 좁혀져 있던 후보 수 */
  candidatesLeft: number
  breakdown: { culprit: number; method: number; decisive: number; efficiency: number; insight: number }
  total: number
}

/** 최종 채점 — LLM 은 여기 관여하지 않는다. 공정성·재현성의 근거. */
export function submit(g: GameState, s: Submission): SubmitResult {
  if (g.phase === 'result') throw new Error('이미 제출했다')

  const correct = {
    culprit: s.culprit === g.case.culprit,
    method: s.method === g.case.method,
    decisive: s.decisiveEvidenceId === g.case.decisiveEvidenceId,
  }
  /**
   * **수단 점수는 판독한 사람만 받는다.**
   *
   * 수단은 결정적 증거 카드의 '발급 구분' 에 찍혀 있다 (ADR 014). 그런데 채점은
   * 눈감고 찍은 5분의 1 적중에도 똑같이 20점을 주고 있었다 — 판독 가능하게 만든
   * 설계를 채점이 배신한 것이다 (자동 리뷰 minor/fairness 지적).
   * 카드를 쥐지 않았다면 맞아도 0점이다. 결과 화면이 그 이유를 밝힌다.
   */
  const hasDecisiveCard = g.cards.includes(g.case.decisiveEvidenceId)
  const methodGuessed = correct.method && !hasDecisiveCard

  /**
   * **찍어 맞힌 것과 좁혀서 맞힌 것은 다르다.**
   *
   * 수단에는 "근거 없이 맞히면 0점" 을 적용해 놓고 범인에는 적용하지 않아
   * 스스로와 모순이었다 (자동 리뷰가 세 판 연속 major/fairness 로 지적).
   *
   * 승리의 정의는 바꾸지 않는다 — 범인 적중이 곧 해결이다. 밸런스(상식 봇 64%)를
   * 다시 재야 하기 때문이다. 대신 **좁힌 만큼 점수를 준다.**
   *
   * 처음엔 1명=60 / 그 외=40 의 두 칸이었는데, 후보 1명은 **결정적 증거를 얻어야만**
   * 도달한다(현장 기록이 범인을 못박기 때문). 그러면 60·20·20 = 100점 전부가
   * 도달률 26% 짜리 사슬 하나에 걸린다 — 점수를 한 곳에 몰아 놓은 셈이다
   * (자동 리뷰: "60점 경로가 구조적으로 막혀 있다").
   * 알리바이 기록으로 둘셋을 지운 플레이도 보상하도록 눈금을 나눈다.
   */
  const candidatesLeft = candidatesFrom(g.case, new Set(g.cards)).length
  const culpritScore = !correct.culprit ? 0
    : candidatesLeft === 1 ? 60
    : candidatesLeft <= 3 ? 50
    : 40

  const breakdown = {
    culprit: culpritScore,
    method: correct.method && hasDecisiveCard ? 20 : 0,
    decisive: correct.decisive ? 20 : 0,
    efficiency: g.investigationsLeft * 5,
    insight: g.foundContradictions.length * 5,
  }
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)

  return { state: { ...g, phase: 'result' }, correct, methodGuessed, candidatesLeft, breakdown, total }
}
