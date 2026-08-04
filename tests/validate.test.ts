import { describe, it, expect } from 'vitest'
import { generateCase } from '../src/engine/caseGen'
import { validateCase, findContradictions, generateValidCase } from '../src/engine/validate'
import { solve, candidatesFrom } from '../src/engine/solver'
import { SUSPECTS, CRIME_SLOT, CRIME_PLACE } from '../src/types'
import { MIN_SOLUTION_LOWER, MIN_SOLUTION_UPPER, MIN_INITIAL_CANDIDATES } from '../src/data/config'

describe('해결 탐색기 (Task 4)', () => {
  it('조사 0회 시점에는 후보가 5명이다 — 진술만으로는 아무도 못 지운다', () => {
    const c = generateCase(101)
    expect(candidatesFrom(c, new Set())).toHaveLength(5)
  })

  it('결정적 증거를 획득하면 후보가 범인 1명으로 수렴한다 (A5)', () => {
    const c = generateCase(102)
    const cand = candidatesFrom(c, new Set([c.decisiveEvidenceId]))
    expect(cand).toEqual([c.culprit])
  })

  it('무고한 4명의 알리바이 물증만으로도 범인이 특정된다 (다른 해법 경로)', () => {
    const c = generateCase(103)
    const alibis = c.evidence
      .filter((e) => e.slot === CRIME_SLOT && e.place !== CRIME_PLACE)
      .map((e) => e.id)
    expect(candidatesFrom(c, new Set(alibis))).toEqual([c.culprit])
  })

  it('최소 조사 수가 예산(6) 안에 있고 경로를 낸다', () => {
    const c = generateValidCase(104).case
    const r = solve(c)
    expect(r.minActions).not.toBeNull()
    expect(r.minActions!).toBeLessThanOrEqual(6)
    expect(r.path.length).toBe(r.minActions)
  })
})

describe('검증기 V1~V7 (Task 4)', () => {
  it('생성된 사건은 V1(단일 범인)을 만족한다', () => {
    for (const seed of [201, 202, 203]) {
      const v = validateCase(generateCase(seed))
      expect(v.violations.filter((x) => x.code === 'V1')).toHaveLength(0)
    }
  })

  it('물증이 진실과 충돌하면 V2 를 잡는다', () => {
    const c = generateCase(204)
    const other = ([0, 1, 3, 4] as const).find((p) => p !== c.evidence[0]!.place)!
    c.evidence[0]!.place = other                       // 물증을 손상시킨다
    expect(validateCase(c).violations.some((x) => x.code === 'V2')).toBe(true)
  })

  it('결정적 증거를 없애면 V3 를 잡는다', () => {
    const c = generateCase(205)
    c.evidence = c.evidence.filter((e) => !e.decisive)
    expect(validateCase(c).violations.some((x) => x.code === 'V3')).toBe(true)
  })

  it('V4: 초기 후보가 기준 이상이다', () => {
    const v = validateCase(generateCase(206))
    expect(v.solve.initialCandidates).toBeGreaterThanOrEqual(MIN_INITIAL_CANDIDATES)
  })

  it('결정적 증거의 선행 조건을 없애면 너무 쉬워져 V5 를 잡는다', () => {
    const c = generateCase(207)
    c.evidence.find((e) => e.decisive)!.requires = []   // 즉시 조회 가능하게 만든다
    const v = validateCase(c)
    expect(v.solve.minActions).toBe(1)
    expect(v.violations.some((x) => x.code === 'V5')).toBe(true)
  })

  it('무고한 사람의 거짓말을 지우면 V6 를 잡는다', () => {
    const c = generateCase(208)
    for (const s of SUSPECTS) {
      if (!c.suspects[s].isCulprit) {
        c.suspects[s].claim = [...c.suspects[s].truth]
        c.suspects[s].lieSlots = []
      }
    }
    expect(validateCase(c).violations.some((x) => x.code === 'V6')).toBe(true)
  })

  it('V7: 유효 모순이 2개 이상이다', () => {
    for (const seed of [209, 210, 211]) {
      expect(findContradictions(generateCase(seed)).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('모순은 물증과 진술이 실제로 어긋나는 지점만 잡는다', () => {
    const c = generateCase(212)
    for (const x of findContradictions(c)) {
      const e = c.evidence.find((ev) => ev.id === x.evidenceId)!
      expect(c.suspects[x.suspect].claim[x.slot]).not.toBe(e.place)
    }
  })
})

describe('generateValidCase — 통과한 사건만 내보낸다', () => {
  it('검증 통과 사건을 돌려주고 요청 시드를 보존한다', () => {
    const g = generateValidCase(301)
    expect(g.validation.ok).toBe(true)
    expect(g.case.seed).toBe(301)
    expect(g.validation.solve.minActions!).toBeGreaterThanOrEqual(MIN_SOLUTION_LOWER)
    expect(g.validation.solve.minActions!).toBeLessThanOrEqual(MIN_SOLUTION_UPPER)
  })

  it('같은 시드는 같은 사건을 낸다 (A7)', () => {
    expect(JSON.stringify(generateValidCase(302).case)).toEqual(JSON.stringify(generateValidCase(302).case))
  })
})
