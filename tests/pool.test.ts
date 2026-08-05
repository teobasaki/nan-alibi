import { describe, it, expect } from 'vitest'
import { SEED_POOL, pickPoolSeed } from '../src/data/pool'
import { generateValidCase } from '../src/engine/validate'

describe('사전 검증 시드 풀 (완료기준 D4)', () => {
  it('풀 크기가 200 이상이다', () => {
    console.log(`  풀 크기: ${SEED_POOL.length} (${SEED_POOL[0]} ~ ${SEED_POOL[SEED_POOL.length - 1]})`)
    expect(SEED_POOL.length).toBeGreaterThanOrEqual(200)
  })

  it('★ 풀의 모든 시드가 1회 시도에 검증을 통과한다 (런타임 재시도 0회)', () => {
    const t0 = Date.now()
    for (const seed of SEED_POOL) {
      // maxAttempts=1 — 파생 시드 재시도가 허용되면 "첫 시도 통과" 를 증명하지 못한다
      const g = generateValidCase(seed, 1)
      expect(g.validation.ok, `시드 ${seed}`).toBe(true)
      expect(g.attempts, `시드 ${seed}`).toBe(1)
    }
    console.log(`  ${SEED_POOL.length}시드 재검증: ${Date.now() - t0}ms`)
  }, 60000)

  it('시드가 중복되지 않고 전부 양의 정수다', () => {
    expect(new Set(SEED_POOL).size).toBe(SEED_POOL.length)
    for (const s of SEED_POOL) {
      expect(Number.isInteger(s), `시드 ${s}`).toBe(true)
      expect(s).toBeGreaterThan(0)
    }
  })

  it('생성된 사건의 seed 가 풀의 시드와 같다 (서버 재생성 계약)', () => {
    // 서버가 이 시드로 사건을 재생성하므로 가공되면 안 된다
    for (const seed of SEED_POOL.slice(0, 20)) {
      expect(generateValidCase(seed).case.seed).toBe(seed)
    }
  })

  it('pickPoolSeed 는 항상 풀 안의 시드를 낸다', () => {
    const set = new Set(SEED_POOL)
    for (let i = 0; i < 1000; i++) {
      expect(set.has(pickPoolSeed(i / 1000))).toBe(true)
    }
    // 양끝과 이상값에서도 범위를 벗어나지 않는다
    for (const r of [0, 0.5, 0.999999, 1, 1.5, -1, NaN, Infinity]) {
      expect(set.has(pickPoolSeed(r)), `rnd=${r}`).toBe(true)
    }
  })

  it('pickPoolSeed 는 풀 전체에 고르게 퍼진다 (한 시드에 고이지 않는다)', () => {
    const got = new Set(Array.from({ length: 500 }, (_, i) => pickPoolSeed(i / 500)))
    expect(got.size).toBeGreaterThanOrEqual(Math.min(SEED_POOL.length, 200))
  })

  it('같은 난수는 같은 시드를 낸다 (결정론)', () => {
    expect(pickPoolSeed(0.42)).toBe(pickPoolSeed(0.42))
  })
})
