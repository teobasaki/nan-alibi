#!/usr/bin/env node
/**
 * **다섯 좌석 전부, E 가 먹는지 수치로 재본다.**
 *
 * 왜 있나: "경찰서에서 E 를 눌러도 심문이 안 뜬다" 는 실플레이 리포트.
 * 연행(E)은 `nearestWithin(seats, actor, PICK_RADIUS=1.1)` 인데, 좌석 좌표는
 * `pickChair` 가 고른 **실측 의자**로 갱신된다. 의자 곁 1.1m 안에 걸을 수 있는 칸이
 * 없으면 그 좌석의 E 는 영영 안 먹는다 — pickChair 의 "다가갈 수 있는가" 검사(0.8m
 * 8방향)와 PICK_RADIUS(1.1m) 는 **다른 기준**이라, 검사를 통과하고도 닿지 못하는
 * 의자가 이론상 가능하다. 이 스크립트가 그 어긋남을 오프라인에서 잡는다.
 *
 * 파이프라인은 런타임(`explore3d.ts`)의 거울이다:
 *   격자 굽기(probe-walkgrid 와 동일) → 문 뚫기 → 시작점 flood → 의자 실측
 *   (probe-chairs 와 동일 규칙: 좌면 높이 수평면 + 등받이) → pickChair 재현
 *   (main.ts SEAT_AT 앵커 5개, 근접 4.5m·접근성 0.8m 8방향) → 좌석별로
 *   "반경 1.1 안 도달 가능 칸 수" 와 "가장 가까운 도달 칸까지 거리" 를 찍는다.
 *
 *   node scripts/probe-seats.mjs            표 출력. 도달 칸 0 인 좌석이 있으면 exit 1
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
})

// ── 런타임 상수의 거울 (explore3d.ts / main.ts) ──
const CELL = 0.5, EDGE_MARGIN = 0.45
const WALL_LO = 0.3, WALL_HI = 1.9
const DOOR_MAX = 2
const SPAWN = [0, 5]
const PICK_RADIUS = 1.1
/** main.ts 의 SEAT_AT — 다섯 좌석 앵커 */
const SEAT_AT = [[-5.0, 1.5], [-2.5, 3.0], [0, 1.5], [2.5, 3.0], [5.0, 1.5]]

const doc = await io.read('public/room/station.opt.glb')
const tris = []
const chairTris = []             // 의자 재질 삼각형만 (재질명 /chair/i)
const bb = { x: [1e9, -1e9], z: [1e9, -1e9] }

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  if (/ceiling/i.test(node.getName())) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const isChair = /chair/i.test(prim.getMaterial()?.getName() ?? '')
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
      const t = [W(idx ? idx.getScalar(i) : i), W(idx ? idx.getScalar(i + 1) : i + 1), W(idx ? idx.getScalar(i + 2) : i + 2)]
      tris.push(t)
      if (isChair) chairTris.push(t)
      for (const v of t) {
        if (v[0] < bb.x[0]) bb.x[0] = v[0]; if (v[0] > bb.x[1]) bb.x[1] = v[0]
        if (v[2] < bb.z[0]) bb.z[0] = v[2]; if (v[2] > bb.z[1]) bb.z[1] = v[2]
      }
    }
  }
}

// ── 격자 (probe-walkgrid 와 동일) ──
const MIN_X = bb.x[0] + EDGE_MARGIN, MAX_X = bb.x[1] - EDGE_MARGIN
const MIN_Z = bb.z[0] + EDGE_MARGIN, MAX_Z = bb.z[1] - EDGE_MARGIN
const GW = Math.ceil((MAX_X - MIN_X) / CELL) + 1
const GH = Math.ceil((MAX_Z - MIN_Z) / CELL) + 1
const inBox = (x, z) => x >= MIN_X && x <= MAX_X && z >= MIN_Z && z <= MAX_Z
const gi = (x, z) => Math.round((z - MIN_Z) / CELL) * GW + Math.round((x - MIN_X) / CELL)

const band = new Uint8Array(GW * GH)
const floorAt = new Uint8Array(GW * GH)

const stampEdge = (p0, p1) => {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2]
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5)), Math.ceil(Math.abs(dy) / (CELL * 0.5)))
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const x = p0[0] + dx * t, y = p0[1] + dy * t, z = p0[2] + dz * t
    if (!inBox(x, z)) continue
    if (y >= WALL_LO && y <= WALL_HI) band[gi(x, z)] = 1
  }
}
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
      if ((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0)) continue
      floorAt[gi(x, z)] = 1
    }
  }
}
for (const t of tris) {
  const lo = Math.min(t[0][1], t[1][1], t[2][1])
  const hi = Math.max(t[0][1], t[1][1], t[2][1])
  if (hi >= -0.6 && lo <= 0.25) fillFloor(t)
  if (hi < WALL_LO || lo > WALL_HI) continue
  stampEdge(t[0], t[1]); stampEdge(t[1], t[2]); stampEdge(t[2], t[0])
}
const solid = new Uint8Array(GW * GH)
for (let i = 0; i < solid.length; i++) solid[i] = (band[i] || !floorAt[i]) ? 1 : 0

// ── 문 뚫기 (0-1 BFS, 런타임 동일) ──
{
  const N = GW * GH
  const dist = new Int32Array(N).fill(0x7fffffff)
  const prev = new Int32Array(N).fill(-1)
  const start = gi(SPAWN[0], SPAWN[1])
  dist[start] = 0
  const dq = [start]
  let head = 0
  while (head < dq.length) {
    const i = dq[head++]
    const r = (i / GW) | 0, c = i % GW
    for (const j of [r > 0 ? i - GW : -1, r < GH - 1 ? i + GW : -1, c > 0 ? i - 1 : -1, c < GW - 1 ? i + 1 : -1]) {
      if (j < 0 || !floorAt[j]) continue
      const w = solid[j] ? 1 : 0
      if (dist[i] + w < dist[j]) {
        dist[j] = dist[i] + w; prev[j] = i
        if (w) dq.push(j); else dq.splice(head, 0, j)
      }
    }
  }
  for (let i = 0; i < N; i++) {
    if (!floorAt[i] || solid[i]) continue
    if (dist[i] === 0 || dist[i] > DOOR_MAX) continue
    for (let j = i; j !== -1 && dist[j] > 0; j = prev[j]) if (solid[j]) solid[j] = 0
  }
}

// ── 시작점 flood → reach (런타임 floodFrom 과 동일) ──
const reach = new Uint8Array(GW * GH)
{
  const q = [gi(SPAWN[0], SPAWN[1])]
  if (!solid[q[0]]) reach[q[0]] = 1
  for (let h = 0; h < q.length; h++) {
    const i = q[h], r = (i / GW) | 0, c = i % GW
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nr >= GH || nc < 0 || nc >= GW) continue
      const n = nr * GW + nc
      if (solid[n] || !floorAt[n] || reach[n]) continue
      reach[n] = 1
      q.push(n)
    }
  }
}
const reachableAt = (x, z) => inBox(x, z) && reach[gi(x, z)] === 1

// ── 의자 실측 (probe-chairs / 런타임 findChairs 와 동일 규칙) ──
const seatsAcc = []
for (const t of chairTris) {
  const e1 = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]]
  const e2 = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]]
  const nx = e1[1] * e2[2] - e1[2] * e2[1]
  const ny = e1[2] * e2[0] - e1[0] * e2[2]
  const nz = e1[0] * e2[1] - e1[1] * e2[0]
  const len = Math.hypot(nx, ny, nz)
  const area = len / 2
  if (area < 1e-6) continue
  const nyAbs = Math.abs(ny) / len
  const cy = (t[0][1] + t[1][1] + t[2][1]) / 3
  const cx = (t[0][0] + t[1][0] + t[2][0]) / 3
  const cz = (t[0][2] + t[1][2] + t[2][2]) / 3
  if (nyAbs > 0.8 && cy > 0.35 && cy < 0.62) {
    let c = seatsAcc.find((k) => Math.hypot(k.x - cx, k.z - cz) < 0.45)
    if (!c) { c = { x: cx, z: cz, y: 0, w: 0, bx: 0, bz: 0, bn: 0 }; seatsAcc.push(c) }
    const w = c.w + area
    c.x = (c.x * c.w + cx * area) / w
    c.z = (c.z * c.w + cz * area) / w
    c.y = (c.y * c.w + cy * area) / w
    c.w = w
  }
  if (nyAbs < 0.35 && cy > 0.62 && cy < 1.2) {
    const c = seatsAcc.find((k) => Math.hypot(k.x - cx, k.z - cz) < 0.5)
    if (c) { c.bx += cx; c.bz += cz; c.bn++ }
  }
}
const chairs = seatsAcc.filter((c) => c.w > 0.1 && c.w < 2.0).filter((c) => c.bn > 3)

// ── pickChair 재현 (explore3d.ts 와 동일: 4.5m 이내 최근접 + 0.8m 8방향 접근성) ──
const taken = new Set()
const pickChair = (ax, az) => {
  let best = null, bestD = 4.5
  for (const c of chairs) {
    if (taken.has(c)) continue
    let approachable = false
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      if (reachableAt(c.x + Math.cos(a) * 0.8, c.z + Math.sin(a) * 0.8)) { approachable = true; break }
    }
    if (!approachable) continue
    const d = Math.hypot(c.x - ax, c.z - az)
    if (d < bestD) { bestD = d; best = c }
  }
  if (best) taken.add(best)
  return best
}

// placeReachable 재현 (의자를 못 받은 좌석의 폴백 자리)
const placeReachable = (x, z) => {
  if (reachableAt(x, z)) return [x, z]
  for (let r = CELL; r < 14; r += CELL) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
      if (reachableAt(px, pz)) return [px, pz]
    }
  }
  return [x, z]
}

// ── 좌석별 판정 ──
console.log(`격자 ${GW}x${GH} · 의자 실측 ${chairs.length}개\n`)
console.log('좌석  앵커          최종 위치        의자  1.1m내 도달칸  최근접 도달칸')
let fail = 0
SEAT_AT.forEach((anchor, i) => {
  const chair = pickChair(anchor[0], anchor[1])
  const at = chair ? [chair.x, chair.z] : placeReachable(anchor[0], anchor[1])
  // PICK_RADIUS 안의 도달 가능 칸(중심 기준)을 센다 — E 가 먹으려면 ≥1 이어야 한다
  let cells = 0, minD = Infinity
  for (let r = 0; r < GH; r++) {
    for (let c = 0; c < GW; c++) {
      if (!reach[r * GW + c]) continue
      const cx = MIN_X + c * CELL, cz = MIN_Z + r * CELL
      const d = Math.hypot(cx - at[0], cz - at[1])
      if (d <= PICK_RADIUS) cells++
      if (d < minD) minD = d
    }
  }
  const ok = cells >= 1
  if (!ok) fail++
  console.log(
    `S${i + 1}    (${anchor[0].toFixed(1)},${anchor[1].toFixed(1)})`.padEnd(20)
    + `(${at[0].toFixed(2)},${at[1].toFixed(2)})`.padEnd(17)
    + `${chair ? '의자' : '바닥'}   ${String(cells).padStart(2)}칸          ${minD.toFixed(2)}m  ${ok ? '✓' : '✗ E 불가'}`)
})
console.log(fail ? `\n✗ ${fail}개 좌석이 PICK_RADIUS(1.1m) 밖 — E 연행 불가` : '\n✓ 다섯 좌석 전부 E 가 닿는다')
process.exit(fail ? 1 : 0)
