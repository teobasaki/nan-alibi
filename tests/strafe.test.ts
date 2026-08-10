/**
 * 1인칭 이동 축 — **A/D 가 뒤집히지 않는다.**
 *
 * 3D 씬은 headless 테스트가 못 닿지만, **부호 하나 틀리면 게걸음이 반대로 가는**
 * 이 산수만은 순수 함수로 떼어 잠근다. 실제로 한 번 틀렸다 —
 * 오른쪽 벡터를 손으로 짐작해 `(cosθ, 0, −sinθ)` 로 썼고, 그건 참값의 부호 반전이라
 * D 를 누르면 왼쪽으로 갔다. 짐작한 부호는 또 틀리므로 외적의 정의를 테스트로 박는다.
 */
import { describe, it, expect } from 'vitest'
import { moveDirFor } from '../src/ui/sceneRules'

/** 두 벡터가 (오차 안에서) 같은가 */
const near = (a: readonly [number, number], b: readonly [number, number]): void => {
  expect(a[0]).toBeCloseTo(b[0], 6)
  expect(a[1]).toBeCloseTo(b[1], 6)
}

describe('1인칭 이동 축 — 앞은 보는 쪽, 오른쪽은 앞 × 위', () => {
  it('정면(θ=0)에서 W 는 +Z 로 간다', () => {
    near(moveDirFor(0, 1, 0), [0, 1])
  })

  it('★ 정면에서 D 는 −X, A 는 +X — 뒤집히면 여기서 빨개진다', () => {
    // three.js 오른손 좌표계에서 앞=(0,0,1) 일 때 오른쪽 = 앞 × 위 = (−1,0,0)
    near(moveDirFor(0, 0, 1), [-1, 0])
    near(moveDirFor(0, 0, -1), [1, 0])
  })

  it('90° 돌면 축도 함께 돈다 — 몸 기준이 유지된다', () => {
    // θ=90°: 앞=(1,0,0) · 오른쪽=(0,0,1)
    near(moveDirFor(Math.PI / 2, 1, 0), [1, 0])
    near(moveDirFor(Math.PI / 2, 0, 1), [0, 1])
  })

  it('앞과 오른쪽은 언제나 직각이다 (어느 각에서도)', () => {
    for (const t of [0, 0.3, 1.1, 2.7, -1.9, 5.5]) {
      const f = moveDirFor(t, 1, 0)
      const r = moveDirFor(t, 0, 1)
      expect(f[0] * r[0] + f[1] * r[1]).toBeCloseTo(0, 6)
    }
  })

  it('대각(W+D)은 두 축의 합이고 길이가 √2 다 — 정규화는 호출부가 한다', () => {
    const d = moveDirFor(0, 1, 1)
    near(d, [-1, 1])
    expect(Math.hypot(d[0], d[1])).toBeCloseTo(Math.SQRT2, 6)
  })

  it('입력이 없으면 0 이다 — atan2(0,0) 로 몸이 홱 도는 사고를 막는다', () => {
    near(moveDirFor(1.2, 0, 0), [0, 0])
  })
})
