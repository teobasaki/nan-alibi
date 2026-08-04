import { describe, it, expect } from 'vitest'
import { makeRng, pick, shuffle, randInt } from '../src/engine/rng'

describe('시드 고정 RNG (완료기준 A7)', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = makeRng(12345), b = makeRng(12345)
    const xs = Array.from({ length: 50 }, () => a.next())
    const ys = Array.from({ length: 50 }, () => b.next())
    expect(xs).toEqual(ys)
  })

  it('다른 시드는 다른 수열을 낸다', () => {
    const a = makeRng(1), b = makeRng(2)
    expect(Array.from({ length: 20 }, () => a.next()))
      .not.toEqual(Array.from({ length: 20 }, () => b.next()))
  })

  it('0 이상 1 미만을 낸다', () => {
    const r = makeRng(7)
    for (let i = 0; i < 500; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('randInt 는 [min,max] 범위를 벗어나지 않는다', () => {
    const r = makeRng(99)
    for (let i = 0; i < 300; i++) {
      const v = randInt(r, 3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
    }
  })

  it('pick 은 배열 원소 중 하나를 낸다', () => {
    const r = makeRng(4)
    const arr = ['a', 'b', 'c']
    for (let i = 0; i < 50; i++) expect(arr).toContain(pick(r, arr))
  })

  it('shuffle 은 원본을 훼손하지 않고 같은 시드면 같은 결과다', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8]
    const s1 = shuffle(makeRng(42), src)
    const s2 = shuffle(makeRng(42), src)
    expect(s1).toEqual(s2)
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8])   // 원본 불변
    expect([...s1].sort((a, b) => a - b)).toEqual(src)  // 원소 보존
  })

  it('게임 코드에 Math.random() 직접 호출이 없다', async () => {
    const { readdirSync, statSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((e) => {
        const p = join(d, e)
        return statSync(p).isDirectory() ? walk(p) : [p]
      })
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const f of walk('src')) {
      // 주석 속 언급은 허용, 실제 호출만 금지
      expect(stripComments(readFileSync(f, 'utf-8')), f).not.toContain('Math.random(')
    }
  })
})
