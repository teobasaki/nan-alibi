import { describe, it, expect } from 'vitest'
import { nearestWithin } from '../src/ui/explore3d'

const at = (id: string, x: number, z: number) => ({ id, at: [x, z] as [number, number] })

describe('근접 판정 — 조사 1회를 오발로 잃지 않기', () => {
  it('반경 밖이면 아무것도 안 잡는다', () => {
    expect(nearestWithin([at('A', 5, 5)], 0, 0, 1)).toBeNull()
  })

  it('반경 안이면 잡는다', () => {
    expect(nearestWithin([at('A', 0.5, 0)], 0, 0, 1)).toBe('A')
  })

  /**
   * 처음엔 반경 안 첫 번째에서 break 했다 — 배열 순서가 이겼다.
   * 표식이 겹치는 자리에서 엉뚱한 것이 잡히고, 그건 조사 1회가 날아간다는 뜻이다.
   */
  it('겹치면 배열 순서가 아니라 거리가 이긴다', () => {
    const items = [at('먼쪽', 0.9, 0), at('가까운쪽', 0.2, 0)]
    expect(nearestWithin(items, 0, 0, 1)).toBe('가까운쪽')
  })

  it('순서를 뒤집어도 같은 답이 나온다', () => {
    const a = [at('먼쪽', 0.9, 0), at('가까운쪽', 0.2, 0)]
    const b = [at('가까운쪽', 0.2, 0), at('먼쪽', 0.9, 0)]
    expect(nearestWithin(a, 0, 0, 1)).toBe(nearestWithin(b, 0, 0, 1))
  })

  it('경계선 위는 안 잡는다 — 반경은 열린 구간이다', () => {
    expect(nearestWithin([at('A', 1, 0)], 0, 0, 1)).toBeNull()
  })

  it('빈 목록에도 터지지 않는다', () => {
    expect(nearestWithin([], 0, 0, 1)).toBeNull()
  })

  it('두 축 모두로 잰다 — x 만 보면 대각선이 틀린다', () => {
    // (0.8, 0.8) 은 x 만 보면 반경 1 안이지만 실제 거리는 1.13 이다
    expect(nearestWithin([at('대각', 0.8, 0.8)], 0, 0, 1)).toBeNull()
  })
})
