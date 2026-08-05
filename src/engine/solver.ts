/**
 * 해결 탐색기 — "이 사건이 조사 몇 회로 풀리는가" 를 **증명**한다.
 *
 * 이 파일이 프로젝트의 핵심 주장을 지탱한다:
 *   "매 판 다른 사건이 생성되지만, 정해진 조사 횟수 안에 유일한 진실에 도달한다."
 * 이 주장을 UI 없이 검증하는 유일한 수단이 여기 BFS 다.
 *
 * 모델:
 *   상태 = 지금까지 획득한 항목 id 집합 (물증 + 증언). 획득은 단조 증가 — 잃는 게 없다.
 *   행동 3종은 각각 조사 1회를 소모한다:
 *     LOOKUP   기록 조회      선행 조건이 충족된 물증 1건
 *     INTERVIEW 심문          그 인물의 증언 전부
 *     PRESENT  증거 제시      (증거, 인물) 쌍이 해금 관계일 때 증언 1건
 *   카드 연결·모순 판정은 **무료** 라서 행동에 포함하지 않는다 (기획서 §2).
 *
 * 판정: 물증만이 위치를 확정한다. 진술은 거짓일 수 있으므로 후보를 지우지 못한다.
 */

import { CRIME_PLACE, CRIME_SLOT, SUSPECTS, type CaseFile, type SuspectId } from '../types'
import { INVESTIGATION_BUDGET } from '../data/config'

export interface SolveResult {
  /** 유일해까지 필요한 최소 조사 수. 도달 불가면 null */
  minActions: number | null
  /** 최소 경로 한 개 (사람이 읽을 수 있는 형태) */
  path: string[]
  /** 조사 0회 시점의 후보 수 — V4 검사에 쓴다 */
  initialCandidates: number
}

/** 획득한 물증만으로 범인 후보를 좁힌다. 진술은 쓰지 않는다 (거짓일 수 있으므로). */
export function candidatesFrom(c: CaseFile, obtained: ReadonlySet<string>): SuspectId[] {
  const cleared = new Set<SuspectId>()
  let pinned: SuspectId | null = null

  for (const e of c.evidence) {
    if (!obtained.has(e.id) || e.slot !== CRIME_SLOT) continue
    for (const s of e.subjects) {
      if (e.place === CRIME_PLACE) pinned = s
      else cleared.add(s)
    }
  }
  // 현장에 있었음이 확정된 인물이 있으면 그 사람 하나로 확정된다
  if (pinned) return [pinned]
  return SUSPECTS.filter((s) => !cleared.has(s))
}

interface Action {
  label: string
  /** 이 행동으로 새로 얻는 항목 id들 */
  yields: string[]
  /** 실행 가능 조건 */
  can(obtained: ReadonlySet<string>): boolean
}

function actionsOf(c: CaseFile): Action[] {
  const acts: Action[] = []

  for (const e of c.evidence) {
    acts.push({
      label: `조회:${e.id}`,
      yields: [e.id],
      can: (o) => !o.has(e.id) && e.requires.every((r) => o.has(r)),
    })
  }

  for (const s of SUSPECTS) {
    const ts = c.suspects[s].testimonies
    if (ts.length === 0) continue
    acts.push({
      label: `심문:${s}`,
      yields: ts,
      can: (o) => ts.some((t) => !o.has(t)),
    })
  }

  for (const u of c.presentUnlocks) {
    acts.push({
      label: `제시:${u.evidenceId}→${u.suspectId}`,
      yields: [u.yieldsTestimonyId],
      can: (o) => o.has(u.evidenceId) && !o.has(u.yieldsTestimonyId),
    })
  }

  return acts
}

const keyOf = (o: ReadonlySet<string>) => [...o].sort().join('|')

/**
 * 최소 조사 수를 BFS 로 구한다.
 * @param budget 이 횟수를 넘으면 탐색을 끊는다 (기본값 = 게임의 조사 예산)
 */
export function solve(c: CaseFile, budget = INVESTIGATION_BUDGET): SolveResult {
  const acts = actionsOf(c)
  const start = new Set<string>()
  const initialCandidates = candidatesFrom(c, start).length

  if (initialCandidates === 1) {
    // 조사 0회에 이미 풀린다 — 사건으로서 실격 (V4 가 잡는다)
    return { minActions: 0, path: [], initialCandidates }
  }

  let frontier: { obtained: Set<string>; path: string[] }[] = [{ obtained: start, path: [] }]
  const seen = new Set<string>([keyOf(start)])

  for (let depth = 1; depth <= budget; depth++) {
    const next: typeof frontier = []
    for (const node of frontier) {
      for (const a of acts) {
        if (!a.can(node.obtained)) continue
        const obtained = new Set(node.obtained)
        for (const y of a.yields) obtained.add(y)
        const k = keyOf(obtained)
        if (seen.has(k)) continue
        seen.add(k)

        const path = [...node.path, a.label]
        const cand = candidatesFrom(c, obtained)
        if (cand.length === 1) {
          // 후보가 1명으로 좁혀졌다. 그게 실제 범인인지도 확인한다.
          if (cand[0] === c.culprit) return { minActions: depth, path, initialCandidates }
          // 범인이 아닌 사람으로 수렴했다면 사건이 잘못 만들어진 것 — 계속 탐색하지 않는다
          return { minActions: null, path, initialCandidates }
        }
        next.push({ obtained, path })
      }
    }
    if (next.length === 0) break
    frontier = next
  }

  return { minActions: null, path: [], initialCandidates }
}
