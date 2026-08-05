import { describe, it, expect } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { botRng, commonsenseBot, optimalBot, randomBot } from '../src/engine/bots'
import { INVESTIGATION_BUDGET } from '../src/data/config'

const SEEDS = Array.from({ length: 100 }, (_, i) => 20000 + i)
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(0)}%`

describe('★ 밸런스 — 봇 승률 (조사 예산 판정 근거)', () => {
  const rows = SEEDS.map((seed) => {
    const g = generateValidCase(seed)
    return {
      random: randomBot(g.case, botRng(seed)),
      common: commonsenseBot(g.case, botRng(seed)),
      optimal: optimalBot(g.case, g.validation.solve.path),
    }
  })
  const rate = (k: 'random' | 'common' | 'optimal') => rows.filter((r) => r[k].won).length / rows.length
  const avgActions = (k: 'random' | 'common' | 'optimal') =>
    rows.reduce((a, r) => a + r[k].actionsUsed, 0) / rows.length

  it('통계 출력', () => {
    console.log(`\n  예산 ${INVESTIGATION_BUDGET}회 · 시드 ${SEEDS.length}개`)
    for (const k of ['random', 'common', 'optimal'] as const) {
      console.log(`  ${k.padEnd(11)} 승률 ${pct(rows.filter((r) => r[k].won).length, rows.length).padStart(4)}  평균 소모 ${avgActions(k).toFixed(1)}회  평균 모순 ${(rows.reduce((a, r) => a + r[k].contradictions, 0) / rows.length).toFixed(1)}건`)
    }
    const fails = rows.filter((r) => !r.common.won).slice(0, 2)
    for (const f of fails) console.log(`  [상식봇 실패 예 seed ${f.common.seed}] ${f.common.log.join(' / ')}`)
  })

  it('완벽 봇은 항상 이긴다 — 사건이 실제로 풀린다는 증명', () => {
    expect(rate('optimal')).toBe(1)
  })

  it('무작위 봇은 절반 아래다 — 찍어서 되는 게임이 아니다', () => {
    expect(rate('random')).toBeLessThan(0.5)
  })

  it('★ 상식 봇 승률이 목표 구간(60~75%)에 있다', () => {
    const r = rate('common')
    expect(r).toBeGreaterThanOrEqual(0.6)
    expect(r).toBeLessThanOrEqual(0.75)
  })
})
