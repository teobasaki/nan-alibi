/**
 * 스킨드 메시의 **화면에 나오는 크기**를 재는 도구. 두 3D 씬이 같이 쓴다.
 *
 * ## `Box3.setFromObject` 를 쓰면 안 되는 이유 — 이 프로젝트가 두 번 당했다
 * 착석 모델은 스킨드 메시인데 노드에 `scale 0.01` 이 걸려 있다. 스킨드 메시는
 * 렌더링할 때 그 노드 스케일이 `bindMatrix`/`bindMatrixInverse` 로 **상쇄**되어
 * 실제 크기는 뼈가 정한다. 그런데 `Box3` 는 `matrixWorld` 를 곧이곧대로 곱하므로
 * 0.01 이 그대로 남는다. **같은 모델이 0.017m 로 재진다 — 실제는 1.35m 다.**
 *
 * 그래서 두 곳에서 똑같이 터졌다:
 * - 탐색 씬: 배율이 `SEAT_HEIGHT/키` 라 **185~345배**가 됐다 (사람이 안 보였다)
 * - 취조실: 바닥 보정이 `position.y -= box.min.y` 라 **100배 작았다** (사람이 떴다)
 *
 * 한 곳에 두는 이유가 이것이다 — 한쪽만 고치면 다른 쪽이 그대로 남는다.
 */

import * as THREE from 'three'

/**
 * 뼈를 적용해 Y 범위를 잰다. 전수 검사는 하지 않는다 —
 * 정점이 50만 개여도 **키를 재는 데는 몇백 점이면 충분하다.**
 */
export function measureY(root: THREE.Object3D): { lo: number; hi: number } {
  root.updateMatrixWorld(true)
  const v = new THREE.Vector3()
  let lo = Infinity
  let hi = -Infinity
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.getAttribute('position')
    if (!pos) return
    const sk = o as THREE.SkinnedMesh
    const step = Math.max(1, Math.floor(pos.count / 500))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i)
      if (sk.isSkinnedMesh) sk.applyBoneTransform(i, v)   // 뼈가 실제 크기를 정한다
      v.applyMatrix4(m.matrixWorld)
      if (v.y < lo) lo = v.y
      if (v.y > hi) hi = v.y
    }
  })
  return { lo, hi }
}

/** 화면에 나오는 키(m). 못 재면 0. */
export function measuredHeight(root: THREE.Object3D): number {
  const { lo, hi } = measureY(root)
  return hi > lo ? hi - lo : 0
}

/**
 * **발을 바닥에 붙인다.**
 * 모델마다 원점이 다르다 — 어떤 것은 엉덩이, 어떤 것은 발밑, 어떤 것은 그 사이다.
 * `position.y = 0` 으로 두면 그 차이가 그대로 나온다. 실측: 다섯 중 하나가
 * **90cm 공중에 떠 있었고** 나머지는 10~28cm 묻혀 있었다.
 * 크기를 맞춘 **뒤에** 부를 것 — 배율이 바뀌면 최저점도 바뀐다.
 */
export function groundIt(o: THREE.Object3D, floor = 0): void {
  const { lo } = measureY(o)
  if (Number.isFinite(lo)) o.position.y += floor - lo
}
