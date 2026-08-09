#!/usr/bin/env node
/**
 * 방 GLB 에서 **의자 좌면의 좌표를 실측한다.**
 *
 * 왜 있나: 앉은 캐릭터를 손 좌표에 놓았더니 허공에 앉았다. "의자 위치를 눈대중으로
 * 맞추지 말고 좌표를 뽑아서 그 위치에 배치하라" — 그대로 한다.
 *
 * 방법: 수평면(|법선 y| > 0.8)이면서 좌면 높이(0.35~0.62m)에 있는 삼각형을 모아
 * XZ 로 뭉친다(cluster). 뭉치 하나가 의자 하나다. 등받이(같은 뭉치 위 0.65~1.2m 의
 * 수직면)의 방향으로 **의자가 보는 쪽**도 알아낸다.
 *
 * 경찰서는 재질이 `Chair___Table` 로 합쳐져 있어 그 재질만 보면 되고,
 * 취조실은 재질 이름이 lambert 뿐이라 전체에서 높이·크기로 거른다.
 *
 *   node scripts/probe-chairs.mjs public/room/station.opt.glb
 *   node scripts/probe-chairs.mjs public/room/room.opt.glb --scale 1.9
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
})

const file = process.argv[2] ?? 'public/room/station.opt.glb'
const scaleArg = process.argv.indexOf('--scale')
const SCALE = scaleArg > 0 ? Number(process.argv[scaleArg + 1]) : 1
// 방을 통째로 들어올리는 씬이 있다 (취조실: room.position.y = 0.53*1.9).
// 런타임과 같은 바닥 기준으로 재려면 그 오프셋을 더해야 한다.
const offArg = process.argv.indexOf('--yoff')
const YOFF = offArg > 0 ? Number(process.argv[offArg + 1]) : 0
const MAT_RE = /chair/i          // 이 재질만 (없으면 전체)

const doc = await io.read(file)
const seatTris = []              // {cx, cz, y, area}
const backPts = []               // {x, y, z}

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const matName = prim.getMaterial()?.getName() ?? ''
    const hasChairMat = MAT_RE.test(matName)
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const idx = prim.getIndices()
    const count = idx ? idx.getCount() : pos.getCount()
    const a = [0, 0, 0]
    const W = (i) => {
      pos.getElement(i, a)
      return [ (m[0]*a[0]+m[4]*a[1]+m[8]*a[2]+m[12]) * SCALE,
               (m[1]*a[0]+m[5]*a[1]+m[9]*a[2]+m[13]) * SCALE + YOFF,
               (m[2]*a[0]+m[6]*a[1]+m[10]*a[2]+m[14]) * SCALE ]
    }
    for (let i = 0; i + 2 < count; i += 3) {
      const v0 = W(idx ? idx.getScalar(i) : i)
      const v1 = W(idx ? idx.getScalar(i + 1) : i + 1)
      const v2 = W(idx ? idx.getScalar(i + 2) : i + 2)
      // 법선
      const ux = v1[0]-v0[0], uy = v1[1]-v0[1], uz = v1[2]-v0[2]
      const vx = v2[0]-v0[0], vy = v2[1]-v0[1], vz = v2[2]-v0[2]
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx
      const nl = Math.hypot(nx, ny, nz) || 1e-9
      const cy = (v0[1]+v1[1]+v2[1]) / 3
      if (Math.abs(ny/nl) > 0.8 && cy > 0.35 && cy < 0.62) {
        if (MAT_RE.test(matName) || !hasChairMatAnywhere) {
          seatTris.push({ cx:(v0[0]+v1[0]+v2[0])/3, cz:(v0[2]+v1[2]+v2[2])/3, y:cy, area:nl/2 })
        }
      }
      // 등받이 후보 — 수직면, 좌면 위
      if (Math.abs(ny/nl) < 0.35 && cy > 0.62 && cy < 1.25 && (MAT_RE.test(matName) || !hasChairMatAnywhere)) {
        backPts.push({ x:(v0[0]+v1[0]+v2[0])/3, y:cy, z:(v0[2]+v1[2]+v2[2])/3 })
      }
    }
  }
}
// 재질에 chair 가 하나라도 있으면 그 재질만 쓴다
var hasChairMatAnywhere = doc.getRoot().listMaterials().some((mm) => MAT_RE.test(mm.getName()))

// XZ 클러스터 — 0.45m 안이면 같은 의자
const clusters = []
for (const t of seatTris) {
  let c = clusters.find((k) => Math.hypot(k.x - t.cx, k.z - t.cz) < 0.45)
  if (!c) { c = { x: t.cx, z: t.cz, y: 0, w: 0 }; clusters.push(c) }
  const w = c.w + t.area
  c.x = (c.x * c.w + t.cx * t.area) / w
  c.z = (c.z * c.w + t.cz * t.area) / w
  c.y = (c.y * c.w + t.y * t.area) / w
  c.w = w
}
// 너무 작은 뭉치(선반 모서리 등)는 버린다
const seats = clusters.filter((c) => c.w > 0.02).map((c) => {
  // 등받이: 좌면 중심에서 0.5m 안의 수직면 무게중심 → 그 반대가 정면
  const near = backPts.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < 0.5)
  let facing = null
  if (near.length > 3) {
    const bx = near.reduce((s, p) => s + p.x, 0) / near.length
    const bz = near.reduce((s, p) => s + p.z, 0) / near.length
    facing = Math.atan2(c.x - bx, c.z - bz)          // 등받이 → 좌면 방향
  }
  return { x: +c.x.toFixed(2), z: +c.z.toFixed(2), y: +c.y.toFixed(3),
    area: +c.w.toFixed(3), facing: facing === null ? null : +facing.toFixed(2) }
})
seats.sort((a, b) => b.area - a.area)
console.log(JSON.stringify({ file, 의자수: seats.length, seats }, null, 1))
