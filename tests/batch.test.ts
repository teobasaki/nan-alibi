import { describe, it, expect } from 'vitest'
import { generateCase } from '../src/engine/caseGen'
import { validateCase, generateValidCase } from '../src/engine/validate'
import { MIN_SOLUTION_LOWER, MIN_SOLUTION_UPPER, INVESTIGATION_BUDGET } from '../src/data/config'

const SEEDS = Array.from({ length: 100 }, (_, i) => 1000 + i)

describe('★ 100시드 배치 검증 (Task 5 — 완료기준 A1·A4)', () => {
  const raw = SEEDS.map((s) => ({ seed: s, v: validateCase(generateCase(s)) }))
  const passRate = raw.filter((r) => r.v.ok).length / SEEDS.length

  it('원생성 통과율이 95% 이상이다 (A1)', () => {
    const failed = raw.filter((r) => !r.v.ok)
    if (failed.length) {
      const why = new Map<string, number>()
      for (const f of failed) for (const x of f.v.violations) why.set(x.code, (why.get(x.code) ?? 0) + 1)
      console.log('  실패 사유:', [...why].map(([k, n]) => `${k}×${n}`).join(' '))
      console.log('  실패 시드 예:', failed.slice(0, 5).map((f) => f.seed).join(', '))
    }
    console.log(`  원생성 통과율: ${(passRate * 100).toFixed(1)}%`)
    expect(passRate).toBeGreaterThanOrEqual(0.95)
  })

  it('재생성까지 포함하면 100% 복구된다 (A1)', () => {
    let maxAttempts = 0
    for (const s of SEEDS) {
      const g = generateValidCase(s)
      expect(g.validation.ok).toBe(true)
      maxAttempts = Math.max(maxAttempts, g.attempts)
    }
    console.log(`  최대 재시도 횟수: ${maxAttempts}`)
    expect(maxAttempts).toBeLessThanOrEqual(10)
  })

  it('★ 모든 시드에서 최소 조사 수 m*가 3~5 이다 (A4)', () => {
    const dist = new Map<number, number>()
    for (const s of SEEDS) {
      const m = generateValidCase(s).validation.solve.minActions!
      dist.set(m, (dist.get(m) ?? 0) + 1)
      expect(m).toBeGreaterThanOrEqual(MIN_SOLUTION_LOWER)
      expect(m).toBeLessThanOrEqual(MIN_SOLUTION_UPPER)
      expect(m).toBeLessThan(INVESTIGATION_BUDGET)   // 여유가 반드시 남아야 한다
    }
    console.log('  m* 분포:', [...dist].sort((a, b) => a[0] - b[0]).map(([m, n]) => `${m}회:${n}건`).join('  '))
  })

  it('난이도가 한 값에 고정되지 않는다 (사슬 깊이 가변화 회귀 감시)', () => {
    const dist = new Map<number, number>()
    for (const s of SEEDS) {
      const m = generateValidCase(s).validation.solve.minActions!
      dist.set(m, (dist.get(m) ?? 0) + 1)
    }
    expect(dist.size).toBeGreaterThanOrEqual(2)
    // 어느 한 난이도가 90% 를 넘게 독식하면 사실상 고정된 것이다
    for (const [, n] of dist) expect(n / SEEDS.length).toBeLessThan(0.9)
  })

  it('모든 시드에서 조사 0회로는 풀리지 않는다 (A3)', () => {
    for (const s of SEEDS) {
      expect(generateValidCase(s).validation.solve.initialCandidates).toBeGreaterThanOrEqual(3)
    }
  })

  it('범인이 매 시드마다 고정되지 않는다 (반복 플레이 근거)', () => {
    const who = new Set(SEEDS.map((s) => generateValidCase(s).case.culprit))
    console.log('  등장한 범인 종류:', [...who].sort().join(', '))
    expect(who.size).toBeGreaterThanOrEqual(4)
  })

  it('배치 전체가 5초 안에 끝난다 (CI 예산)', () => {
    const t0 = Date.now()
    for (const s of SEEDS) generateValidCase(s)
    const ms = Date.now() - t0
    console.log(`  100시드 생성+검증: ${ms}ms`)
    expect(ms).toBeLessThan(5000)
  })
})
