/**
 * 사건 검증기 — 생성기는 제안하고, 검증기가 보증한다.
 *
 * 기획서 §3-3 의 V1~V7 을 그대로 코드로 옮긴 것.
 * 통과 못 한 사건은 플레이어에게 절대 도달하지 않는다 (generateValidCase 가 재생성).
 */

import {
  CRIME_PLACE,
  CRIME_SLOT,
  SLOTS,
  SUSPECTS,
  type CaseFile,
  type Slot,
  type SuspectId,
} from '../types'
import {
  MIN_INITIAL_CANDIDATES,
  MIN_INNOCENT_LIARS,
  MIN_SOLUTION_LOWER,
  MIN_SOLUTION_UPPER,
} from '../data/config'
import { generateCase } from './caseGen'
import { solve, type SolveResult } from './solver'

export interface Violation {
  code: 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7'
  message: string
}

export interface ValidationResult {
  ok: boolean
  violations: Violation[]
  solve: SolveResult
  /** 유효한 모순 개수 (V7) */
  contradictions: number
}

/**
 * 유효한 모순 = 물증이 확정한 사실과 어떤 인물의 진술이 충돌하는 (물증, 인물, 슬롯) 조합.
 * 플레이어가 보드에서 카드 2장을 연결했을 때 "모순 발견" 이 뜨는 지점들이다.
 */
export interface Contradiction {
  evidenceId: string
  suspect: SuspectId
  slot: Slot
}

export function findContradictions(c: CaseFile): Contradiction[] {
  const out: Contradiction[] = []
  for (const e of c.evidence) {
    for (const s of e.subjects) {
      if (c.suspects[s].claim[e.slot] !== e.place) {
        out.push({ evidenceId: e.id, suspect: s, slot: e.slot })
      }
    }
  }
  return out
}

export function validateCase(c: CaseFile): ValidationResult {
  const v: Violation[] = []

  // V1 — 범인은 정확히 1명
  const culprits = SUSPECTS.filter((s) => c.suspects[s].truth[CRIME_SLOT] === CRIME_PLACE)
  if (culprits.length !== 1) {
    v.push({ code: 'V1', message: `범행 시각 현장 인물이 ${culprits.length}명 (1이어야 함)` })
  } else if (culprits[0] !== c.culprit) {
    v.push({ code: 'V1', message: `현장 인물(${culprits[0]})과 지정 범인(${c.culprit}) 불일치` })
  }

  // V2 — 시간표 충돌 없음: 궤적 길이와 값이 온전한가
  for (const s of SUSPECTS) {
    const { truth, claim } = c.suspects[s]
    if (truth.length !== SLOTS.length || claim.length !== SLOTS.length) {
      v.push({ code: 'V2', message: `${s} 궤적 길이 이상` })
    }
    // 물증은 진실과 반드시 일치해야 한다 (물증은 거짓일 수 없다)
    for (const e of c.evidence) {
      if (e.subjects.includes(s) && truth[e.slot] !== e.place) {
        v.push({ code: 'V2', message: `물증 ${e.id} 이 ${s} 의 실제 궤적과 충돌` })
      }
    }
  }

  // V3 — 결정적 증거가 실제로 범인을 가리킨다
  const dec = c.evidence.filter((e) => e.decisive)
  if (dec.length !== 1) {
    v.push({ code: 'V3', message: `결정적 증거가 ${dec.length}개 (1이어야 함)` })
  } else {
    const d = dec[0]!
    if (d.subjects.length !== 1 || d.subjects[0] !== c.culprit || d.place !== CRIME_PLACE || d.slot !== CRIME_SLOT) {
      v.push({ code: 'V3', message: '결정적 증거가 범인을 범행 시각·현장으로 특정하지 못함' })
    }
  }

  const s = solve(c)

  // V4 — 조사 0회로는 안 풀린다
  if (s.initialCandidates < MIN_INITIAL_CANDIDATES) {
    v.push({ code: 'V4', message: `초기 후보 ${s.initialCandidates}명 (${MIN_INITIAL_CANDIDATES}명 이상이어야 함)` })
  }

  // V5 — 6회 안에 풀리되 너무 쉽지 않다
  if (s.minActions === null) {
    v.push({ code: 'V5', message: '조사 예산 내에 유일해 도달 불가' })
  } else if (s.minActions < MIN_SOLUTION_LOWER || s.minActions > MIN_SOLUTION_UPPER) {
    v.push({ code: 'V5', message: `최소 조사 수 ${s.minActions} (${MIN_SOLUTION_LOWER}~${MIN_SOLUTION_UPPER} 이어야 함)` })
  }

  // V6 — 무고한 사람에게도 의심 요소가 있다
  const innocentLiars = SUSPECTS.filter((x) => !c.suspects[x].isCulprit && c.suspects[x].lieSlots.length > 0)
  if (innocentLiars.length < MIN_INNOCENT_LIARS) {
    v.push({ code: 'V6', message: `거짓말하는 무고한 인물 ${innocentLiars.length}명 (${MIN_INNOCENT_LIARS}명 이상이어야 함)` })
  }

  // V7 — 유효한 모순이 2~3개 이상 존재
  const contradictions = findContradictions(c).length
  if (contradictions < 2) {
    v.push({ code: 'V7', message: `유효 모순 ${contradictions}개 (2개 이상이어야 함)` })
  }

  return { ok: v.length === 0, violations: v, solve: s, contradictions }
}

export interface GeneratedCase {
  case: CaseFile
  validation: ValidationResult
  /** 몇 번째 시도에 성공했는가 (1 = 첫 시도) */
  attempts: number
}

/**
 * 검증을 통과한 사건만 돌려준다. 실패하면 파생 시드로 재시도한다.
 * @throws maxAttempts 안에 못 만들면 던진다 — 조용히 잘못된 사건을 내보내는 것보다 낫다.
 */
export function generateValidCase(seed: number, maxAttempts = 40): GeneratedCase {
  for (let i = 0; i < maxAttempts; i++) {
    // 파생 시드: 같은 입력 시드는 항상 같은 결과를 내야 하므로 결정론적으로 변형한다
    const derived = (seed + i * 0x9e3779b1) >>> 0
    const c = generateCase(derived)
    const validation = validateCase(c)
    if (validation.ok) return { case: { ...c, seed }, validation, attempts: i + 1 }
  }
  throw new Error(`시드 ${seed}: ${maxAttempts}회 시도에도 유효한 사건 생성 실패`)
}
