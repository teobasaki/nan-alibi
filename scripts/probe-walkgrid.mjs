#!/usr/bin/env node
/**
 * 탐색 씬의 **충돌 격자를 브라우저 없이 재본다.**
 *
 * 왜 있나: 벽 충돌이 안 걸린다는 보고를 브라우저에서 재려니 렌더가 멈춘 창에서는
 * rAF 가 안 돌아 측정이 매번 헛돌았다. 같은 계산을 Node 에서 하면 몇 초고 결정적이다.
 * (런타임 격자와 **정확히 일치**함을 확인했다 — 같은 띠에서 양쪽 다 149칸이었다.)
 *
 * 세 가지를 한 번에 뽑는다:
 *   - `보임`   : 사람 몸 높이(0.3~2.6m)에 뭔가 있는 칸 = 화면에서 장애물로 보이는 것
 *   - `충돌`   : 지금 규칙이 막는 칸
 *   - `통과`   : 보이는데 안 막는 칸 = **벽을 뚫고 다니는 자리**
 *
 * 규칙을 바꿔 가며 비교한다:
 *   RULE=band  LO=? HI=?  높이 띠 하나 (기본 — 런타임과 같은 0.3~2.6m)
 *   RULE=tall            바닥 근처와 머리 위에 **둘 다** 있는 칸만
 *
 *   node scripts/probe-walkgrid.mjs                       지금 규칙
 *   RULE=band LO=2.0 HI=3.0 node scripts/probe-walkgrid.mjs   가구 위만 막던 예전 규칙
 */

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
})

const CELL = 0.5, EDGE_MARGIN = 0.45
// 런타임과 같이 **방 bbox 에서 유도한다** — 원점 중심 상수를 쓰면 허공에 벽이 생긴다
let BX = [1e9, -1e9], BZ = [1e9, -1e9]

const RULE = process.env.RULE ?? 'band'
// 기본값은 **런타임(`explore3d.ts` 의 WALL_LO/WALL_HI)과 같아야 한다** — 거울이라야 쓸모가 있다
const LO = Number(process.env.LO ?? 0.3)
const HI = Number(process.env.HI ?? 1.9)

/** 사람 몸이 지나가는 높이 — 이 사이에 면이 있으면 화면에서 장애물로 보인다 */
const BODY_LO = 0.3, BODY_HI = 2.6
/** '벽' 판정용 두 표본 높이. 벽은 둘 다 있고, 책상은 아래만, 문틀은 위만 있다. */
const LOW_LO = 0.35, LOW_HI = 0.85
const HIGH_LO = 2.0, HIGH_HI = 2.6

const doc = await io.read('public/room/station.opt.glb')
let verts = 0
const tris = []          // [v0,v1,v2] 월드 좌표
const bb = { x: [1e9, -1e9], y: [1e9, -1e9], z: [1e9, -1e9] }

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  if (/ceiling/i.test(node.getName())) continue      // 천장은 숨긴다 = 벽이 아니다
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const idx = prim.getIndices()
    const count = idx ? idx.getCount() : pos.getCount()
    const a = [0, 0, 0]
    const W = (i) => {
      pos.getElement(i, a)
      return [m[0] * a[0] + m[4] * a[1] + m[8] * a[2] + m[12],
              m[1] * a[0] + m[5] * a[1] + m[9] * a[2] + m[13],
              m[2] * a[0] + m[6] * a[1] + m[10] * a[2] + m[14]]
    }
    for (let i = 0; i + 2 < count; i += 3) {
      const t = [W(idx ? idx.getScalar(i) : i),
                 W(idx ? idx.getScalar(i + 1) : i + 1),
                 W(idx ? idx.getScalar(i + 2) : i + 2)]
      tris.push(t)
      for (const v of t) {
        verts++
        if (v[0] < bb.x[0]) bb.x[0] = v[0]; if (v[0] > bb.x[1]) bb.x[1] = v[0]
        if (v[1] < bb.y[0]) bb.y[0] = v[1]; if (v[1] > bb.y[1]) bb.y[1] = v[1]
        if (v[2] < bb.z[0]) bb.z[0] = v[2]; if (v[2] > bb.z[1]) bb.z[1] = v[2]
      }
    }
  }
}

const MIN_X = bb.x[0] + EDGE_MARGIN, MAX_X = bb.x[1] - EDGE_MARGIN
const MIN_Z = bb.z[0] + EDGE_MARGIN, MAX_Z = bb.z[1] - EDGE_MARGIN
const GW = Math.ceil((MAX_X - MIN_X) / CELL) + 1
const GH = Math.ceil((MAX_Z - MIN_Z) / CELL) + 1
const inBox = (x, z) => x >= MIN_X && x <= MAX_X && z >= MIN_Z && z <= MAX_Z
const gi = (x, z) => Math.round((z - MIN_Z) / CELL) * GW + Math.round((x - MIN_X) / CELL)

const seen = new Uint8Array(GW * GH)
const floorAt = new Uint8Array(GW * GH)   // 바닥이 있는 칸 = 건물 안
const low = new Uint8Array(GW * GH)
const high = new Uint8Array(GW * GH)
const band = new Uint8Array(GW * GH)

/** 런타임과 같은 방식 — **삼각형의 모서리를 따라 찍는다.** 수직 벽은 XZ 넓이가 0이다. */
const stampEdge = (p0, p1) => {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2]
  const steps = Math.max(1,
    Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5)),
    Math.ceil(Math.abs(dy) / (CELL * 0.5)))
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const x = p0[0] + dx * t, y = p0[1] + dy * t, z = p0[2] + dz * t
    if (!inBox(x, z)) continue
    const i = gi(x, z)
    if (y >= BODY_LO && y <= BODY_HI) seen[i] = 1
    if (y >= LOW_LO && y <= LOW_HI) low[i] = 1
    if (y >= HIGH_LO && y <= HIGH_HI) high[i] = 1
    if (y >= LO && y <= HI) band[i] = 1
  }
}
/** 수평면은 XZ 로 투영해도 넓이가 남는다 — 바닥 유무는 면적으로 판정한다 */
const fillFloor = (t) => {
  const xs = [t[0][0], t[1][0], t[2][0]], zs = [t[0][2], t[1][2], t[2][2]]
  const x0 = Math.max(MIN_X, Math.min(...xs)), x1 = Math.min(MAX_X, Math.max(...xs))
  const z0 = Math.max(MIN_Z, Math.min(...zs)), z1 = Math.min(MAX_Z, Math.max(...zs))
  if (x1 < x0 || z1 < z0) return
  const d = (ax, az, bx, bz, px, pz) => (bx - ax) * (pz - az) - (bz - az) * (px - ax)
  for (let z = z0; z <= z1 + 1e-9; z += CELL) {
    for (let x = x0; x <= x1 + 1e-9; x += CELL) {
      const s1 = d(xs[0], zs[0], xs[1], zs[1], x, z)
      const s2 = d(xs[1], zs[1], xs[2], zs[2], x, z)
      const s3 = d(xs[2], zs[2], xs[0], zs[0], x, z)
      const neg = s1 < 0 || s2 < 0 || s3 < 0
      const pos = s1 > 0 || s2 > 0 || s3 > 0
      if (neg && pos) continue
      floorAt[gi(x, z)] = 1
    }
  }
}

for (const t of tris) {
  const lo = Math.min(t[0][1], t[1][1], t[2][1])
  const hi = Math.max(t[0][1], t[1][1], t[2][1])
  if (hi >= -0.6 && lo <= 0.25) fillFloor(t)     // 바닥은 **면적**을 채운다 (큰 삼각형이라 모서리만으로는 안 잡힌다)
  if (hi < Math.min(LO, BODY_LO) || lo > Math.max(HI, BODY_HI)) continue
  stampEdge(t[0], t[1]); stampEdge(t[1], t[2]); stampEdge(t[2], t[0])
}

const solid = new Uint8Array(GW * GH)
for (let i = 0; i < solid.length; i++) {
  const obstacle = RULE === 'band' ? band[i] : (low[i] && high[i] ? 1 : 0)
  solid[i] = (obstacle || !floorAt[i]) ? 1 : 0   // 런타임과 같이 **바닥 없으면 못 간다**
}

// 시작점에서 걸어서 닿는 칸 (BFS)
const SPAWN = [0, 5]
const reach = new Uint8Array(GW * GH)
const q = [gi(SPAWN[0], SPAWN[1])]
if (solid[q[0]]) console.log('⚠ 시작점이 막혀 있다')
else reach[q[0]] = 1
for (let h = 0; h < q.length; h++) {
  const i = q[h], r = (i / GW) | 0, c = i % GW
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nr = r + dr, nc = c + dc
    if (nr < 0 || nr >= GH || nc < 0 || nc >= GW) continue
    const n = nr * GW + nc
    if (solid[n] || reach[n]) continue
    reach[n] = 1
    q.push(n)
  }
}

let nSeen = 0, nSolid = 0, nReach = 0, nThrough = 0, nFree = 0, nVoid = 0
for (let i = 0; i < solid.length; i++) {
  if (seen[i]) nSeen++
  if (solid[i]) nSolid++
  if (reach[i]) nReach++
  if (!solid[i]) nFree++
  if (seen[i] && !solid[i]) nThrough++
  if (reach[i] && !floorAt[i]) nVoid++
}

console.log(JSON.stringify({
  규칙: RULE === 'band' ? `띠 ${LO}~${HI}m` : `아래(${LOW_LO}~${LOW_HI}) + 위(${HIGH_LO}~${HIGH_HI}) 둘 다`,
  정점: verts,
  bbox: { x: bb.x.map((v) => +v.toFixed(1)), y: bb.y.map((v) => +v.toFixed(1)), z: bb.z.map((v) => +v.toFixed(1)) },
  걷는범위: { x: [+MIN_X.toFixed(1), +MAX_X.toFixed(1)], z: [+MIN_Z.toFixed(1), +MAX_Z.toFixed(1)] },
  격자: `${GW}x${GH}`, 삼각형: tris.length,
  보이는칸: nSeen, 막는칸: nSolid, 통과하는칸: nThrough,
  빈칸: nFree, 도달칸: nReach, 고립: nFree - nReach,
  바닥없는데_걸어감: nVoid,
}))

const SEATS = [[-5, 1.5], [-2.5, 3], [0, 1.5], [2.5, 3], [5, 1.5]]
const PLACES = [[-9.5, 5.5], [9.5, 5.5], [0, -6.5], [-9.5, -5], [9.5, -5]]
const chk = (n, a) => a.map(([x, z], i) =>
  `${n}${i} (${x},${z}) ${!inBox(x, z) ? '범위밖' : solid[gi(x, z)] ? '벽' : reach[gi(x, z)] ? '✓도달' : '✗고립'}`)
console.log([...chk('좌석', SEATS), ...chk('장소', PLACES)].join('\n'))

/** `#` 막음 · `!` 보이는데 안 막음(뚫림) · (공백) 도달 · `.` 고립 */
let out = ''
for (let r = 0; r < GH; r++) {
  let line = ''
  for (let c = 0; c < GW; c++) {
    const i = r * GW + c
    line += solid[i] ? '#' : (seen[i] ? '!' : (reach[i] ? ' ' : '.'))
  }
  out += line + '\n'
}
console.log('\n# 막음 · ! 보이는데 안 막음 · (공백) 걸을 수 있음 · . 고립\n' + out)
