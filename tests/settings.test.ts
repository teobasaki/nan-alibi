import { describe, it, expect } from 'vitest'
import { normalize, load, save, DEFAULTS } from '../src/ui/settings'

/** localStorage 는 사용자가 직접 고칠 수 있다. 저장된 값을 믿지 않는다. */
describe('설정 정규화 — 저장된 값을 신뢰하지 않는다', () => {
  it('빈 값·이상한 타입이면 기본값이다', () => {
    for (const bad of [null, undefined, 0, 'x', [], true]) {
      expect(normalize(bad)).toEqual(DEFAULTS)
    }
  })

  it('없는 음성 모드는 기본값으로 떨어진다', () => {
    expect(normalize({ voice: 'supertone' }).voice).toBe(DEFAULTS.voice)
    expect(normalize({ voice: 42 }).voice).toBe(DEFAULTS.voice)
  })

  it('아는 음성 모드는 그대로 통과한다', () => {
    for (const v of ['auto', 'local', 'off'] as const) {
      expect(normalize({ voice: v }).voice).toBe(v)
    }
  })

  it('강도는 0~1.5 로 잘린다', () => {
    expect(normalize({ intensity: -3 }).intensity).toBe(0)
    expect(normalize({ intensity: 99 }).intensity).toBe(1.5)
    expect(normalize({ intensity: 0.7 }).intensity).toBeCloseTo(0.7)
  })

  it('NaN·Infinity 는 기본값이다 — 슬라이더 하나로 게임이 깨지면 안 된다', () => {
    expect(normalize({ intensity: NaN }).intensity).toBe(DEFAULTS.intensity)
    expect(normalize({ intensity: Infinity }).intensity).toBe(DEFAULTS.intensity)
  })
})

describe('설정 저장·복원', () => {
  const mem = (init = ''): Storage => {
    let v = init
    return { getItem: () => v, setItem: (_: string, n: string) => { v = n } } as unknown as Storage
  }

  it('저장한 것이 그대로 돌아온다', () => {
    const s = mem()
    save({ voice: 'local', intensity: 0.4 }, s)
    expect(load(s)).toEqual({ voice: 'local', intensity: 0.4 })
  })

  it('망가진 JSON 이 있어도 기본값으로 뜬다', () => {
    expect(load(mem('{{{'))).toEqual(DEFAULTS)
  })

  it('손으로 고친 값도 정규화해서 읽는다', () => {
    expect(load(mem('{"voice":"해킹","intensity":999}'))).toEqual(DEFAULTS.voice === 'auto'
      ? { voice: 'auto', intensity: 1.5 } : DEFAULTS)
  })

  it('쓰기가 막혀도 던지지 않는다 — 사파리 프라이빗 모드', () => {
    const blocked = { setItem: () => { throw new Error('QuotaExceeded') } } as unknown as Storage
    expect(() => save(DEFAULTS, blocked)).not.toThrow()
  })
})
