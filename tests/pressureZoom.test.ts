/**
 * pressureZoomBias — 압박도→카메라 거리 배율 순수 함수 테스트.
 *
 * 3D 렌더링과 무관한 산수만 검증한다 (sceneRules 와 같은 원칙).
 * 보장 사항:
 *   ① 범위 — 출력은 항상 [1 - MAX_SHRINK, 1] 안에 있다.
 *   ② 복원 — pressure 0 이면 bias 가 1 로 돌아간다.
 *   ③ 접근성 — reducedMotion=true 이면 항상 1.
 *   ④ 단조 램프 — 한 프레임 변화가 상한을 넘지 않는다.
 *   ⑤ 갇힘 방지 — 어떤 경로를 거쳐도 pressure 0 에서 충분히 반복하면 1 에 도달.
 */
import { describe, it, expect } from 'vitest'
import { pressureZoomBias, PRESSURE_ZOOM } from '../src/ui/stage3d'

const { MAX_SHRINK, LERP } = PRESSURE_ZOOM

describe('pressureZoomBias', () => {
  it('pressure 0 이면 target=1, bias 가 1 쪽으로 다가간다', () => {
    const next = pressureZoomBias(0, 0.96, false)
    expect(next).toBeGreaterThan(0.96)
    expect(next).toBeLessThanOrEqual(1)
  })

  it('pressure 100 이면 bias 가 1-MAX_SHRINK 쪽으로 다가간다', () => {
    const next = pressureZoomBias(100, 1.0, false)
    expect(next).toBeLessThan(1.0)
    expect(next).toBeGreaterThanOrEqual(1 - MAX_SHRINK)
  })

  it('출력은 항상 [1-MAX_SHRINK, 1] 범위 안이다', () => {
    // 극단 입력
    for (const p of [-50, 0, 50, 100, 200]) {
      for (const cur of [0.5, 0.94, 1, 1.2]) {
        const v = pressureZoomBias(p, cur, false)
        expect(v).toBeGreaterThanOrEqual(1 - MAX_SHRINK)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('reducedMotion=true 이면 항상 1', () => {
    expect(pressureZoomBias(100, 0.94, true)).toBe(1)
    expect(pressureZoomBias(50, 0.97, true)).toBe(1)
    expect(pressureZoomBias(0, 0.96, true)).toBe(1)
  })

  it('한 프레임 변화량이 MAX_SHRINK × LERP 를 넘지 않는다', () => {
    const maxStep = MAX_SHRINK * LERP + 1e-12 // 부동소수 여유
    for (const p of [0, 30, 60, 100]) {
      for (const cur of [1 - MAX_SHRINK, 0.97, 1]) {
        const next = pressureZoomBias(p, cur, false)
        expect(Math.abs(next - cur)).toBeLessThanOrEqual(maxStep)
      }
    }
  })

  it('압박 해소(100→0) 후 충분히 반복하면 1 에 복귀한다 (갇힘 방지)', () => {
    // pressure 100 으로 300 프레임 → 그 뒤 pressure 0 으로 600 프레임
    let bias = 1
    for (let i = 0; i < 300; i++) bias = pressureZoomBias(100, bias, false)
    // 확인: 충분히 내려갔다
    expect(bias).toBeLessThan(0.96)

    for (let i = 0; i < 600; i++) bias = pressureZoomBias(0, bias, false)
    // 1 에 매우 가까워야 한다 (부동소수 오차 이내)
    expect(bias).toBeGreaterThan(1 - 1e-6)
  })

  it('항상 단조 접근 — 목표를 지나치지 않는다', () => {
    // pressure 80 의 target
    const target = 1 - (80 / 100) * MAX_SHRINK
    let bias = 1
    for (let i = 0; i < 500; i++) {
      const prev = bias
      bias = pressureZoomBias(80, bias, false)
      // 위에서 내려가는 방향 — 한 번도 target 아래로 가지 않는다
      expect(bias).toBeGreaterThanOrEqual(target - 1e-12)
      // 단조감소
      expect(bias).toBeLessThanOrEqual(prev + 1e-12)
    }
  })
})
