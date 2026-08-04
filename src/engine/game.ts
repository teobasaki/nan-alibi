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
  SUSPECTS,
  type CaseFile,
  type Evidence,
  type Slot,
  type SuspectId,
} from '../types'
import { INVESTIGATION_BUDGET } from '../data/config'

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
  /** 인물별 동요 수치 0~100 */
  pressure: Record<SuspectId, number>
  phase: Phase
}

export function createGame(c: CaseFile): GameState {
  // 기본 진술: 모든 인물의 **범행 시각** 주장만 무료 공개한다.
  // 나머지 시각은 심문해야 열린다 — 이게 심문에 값을 부여한다.
  const cards = SUSPECTS.map((s) => claimCardId(s, CRIME_SLOT))
  const pressure = Object.fromEntries(SUSPECTS.map((s) => [s, 0])) as Record<SuspectId, number>
  return {
    case: c,
    investigationsLeft: INVESTIGATION_BUDGET,
    cards,
    connections: [],
    foundContradictions: [],
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

/** 증거 제시 — 해금 관계가 있어야만 성립한다 (무의미한 제시로 예산이 날아가지 않게) */
export function presentEvidence(g: GameState, evId: string, s: SuspectId): GameState {
  assertCanAct(g)
  if (!g.cards.includes(evId)) throw new Error(`보유하지 않은 증거: ${evId}`)
  const unlock = g.case.presentUnlocks.find((u) => u.evidenceId === evId && u.suspectId === s)
  if (!unlock) throw new Error(`${s} 에게 ${evId} 를 제시할 근거가 없다`)
  return spend(g, [unlock.yieldsTestimonyId], [s, 35])
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
  if (!ev.subjects.includes(claim.suspect) || ev.slot !== claim.slot) {
    return { state: { ...g, connections }, contradiction: false, message: '서로 다른 인물·시각이라 비교 대상이 아니다' }
  }

  const claimed = g.case.suspects[claim.suspect].claim[claim.slot]
  if (claimed === ev.place) {
    return { state: { ...g, connections }, contradiction: false, message: '진술과 기록이 일치한다' }
  }

  const key = `${ev.id}|${claim.suspect}|${claim.slot}`
  const foundContradictions = g.foundContradictions.includes(key)
    ? g.foundContradictions
    : [...g.foundContradictions, key]

  return {
    state: { ...g, connections, foundContradictions },
    contradiction: true,
    message: `${claim.suspect} 의 진술과 ${ev.id} 기록이 어긋난다`,
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
  const breakdown = {
    culprit: correct.culprit ? 60 : 0,
    method: correct.method ? 20 : 0,
    decisive: correct.decisive ? 20 : 0,
    efficiency: g.investigationsLeft * 5,
    insight: g.foundContradictions.length * 5,
  }
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)

  return { state: { ...g, phase: 'result' }, correct, breakdown, total }
}
