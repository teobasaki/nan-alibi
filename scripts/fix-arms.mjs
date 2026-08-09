#!/usr/bin/env node
/**
 * 착석 모델의 **팔 자세를 다시 잡는다.**
 *
 * ## 무엇이 틀렸나
 * `scripts/pose-seated.py` 의 `fit_arms()` 는 "손이 무릎 위에 오는" 조합을 탐색으로
 * 골랐는데, 관통 벌점이 사실상 꺼져 있었다. 세 겹으로 겹쳤다:
 * - 몸통 여유(`CLEAR`)를 `{side}Shoulder`(쇄골 뿌리, 중심에서 2.7~3.5cm)로 쟀다.
 *   실제 어깨관절은 `{side}Arm`(15.6~20.5cm)이다 — 벌점이 5~8배 작았다.
 * - 가드 구간이 가슴 13cm 뿐이라 배·아랫갈비가 무방비였다.
 * - 아마추어 1단위 = 1cm 인데 `0.075` 를 미터로 썼다 — "허벅지 위 7.5cm" 가 실제로는 0.75mm.
 * 게다가 비용함수에 **팔꿈치를 굽히라는 항이 없어** 최소해가 "쭉 뻗은 팔"이었다.
 *
 * 실측(수정 전): 팔꿈치가 곧게 편 데서 **4~27°** 밖에 안 굽었고(사람은 55~70°),
 * 손목이 몸통 중심에서 **5~9cm** 라 몸 안에 있었다.
 *
 * ## 이 스크립트가 하는 일
 * 팔 본 여섯 개(위팔·아래팔 좌우)의 **노드 회전만** 다시 정한다. 목표는 네 가지 —
 * 팔꿈치 굽힘 · 손목이 몸통 밖 · 손목이 허벅지 위 · 손이 앞으로. 격자 탐색이다.
 *
 * 노드 회전은 glTF JSON 에 있고 Draco 버퍼에 없다. **텍스처를 다시 압축하지 않는다.**
 *
 *   node scripts/fix-arms.mjs           재보기만 한다
 *   node scripts/fix-arms.mjs --write   실제로 고쳐 쓴다
 */

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
})

/** 앉아서 두 손을 허벅지 위에 얹은 자세. 도(°)와 cm. */
const TARGET = { elbow: 58, wristX: 19, wristY: 5, wristZ: 14 }

const SLUGS = ['security', 'investor', 'expartner', 'appraiser', 'manager',
  'secretary', 'nephew', 'housekeeping']

const mul = (a, b) => { const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s }
  return o }
const trs = (t, q, s) => { const [x, y, z, w] = q
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
             2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
             2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
             t[0], t[1], t[2], 1]
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= s[c]
  return m }
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
const eul = (x, y, z) => { const R = Math.PI / 180
  const c1 = Math.cos(x * R / 2), s1 = Math.sin(x * R / 2)
  const c2 = Math.cos(y * R / 2), s2 = Math.sin(y * R / 2)
  const c3 = Math.cos(z * R / 2), s3 = Math.sin(z * R / 2)
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3,
          c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3] }
const sub = (a, b) => a.map((v, i) => v - b[i])
const len = (a) => Math.hypot(...a)
const ang = (u, v) => Math.acos(Math.max(-1, Math.min(1,
  (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v))))) * 180 / Math.PI

const score = (m) => Math.abs(m.elbow - TARGET.elbow)
  + Math.abs(m.wristX - TARGET.wristX) * 1.6      // 몸 파고듦이 가장 눈에 띈다
  + Math.abs(m.wristY - TARGET.wristY)
  + Math.abs(m.wristZ - TARGET.wristZ) * 0.8

const write = process.argv.includes('--write')
console.log('모델          팔꿈치 전→후   손목X 전→후   손목Y 후  손목Z 후')

for (const slug of SLUGS) {
  const path = `public/characters/${slug}.opt.glb`
  let doc
  try { doc = await io.read(path) } catch { console.log(slug.padEnd(13), '없음'); continue }
  const nodes = doc.getRoot().listNodes()
  const by = {}; for (const n of nodes) by[n.getName()] = n
  const par = new Map(); for (const n of nodes) for (const c of n.listChildren()) par.set(c, n)
  const over = new Map()
  const W = (n) => { const ch = []; let c = n; while (c) { ch.unshift(c); c = par.get(c) }
    let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for (const b of ch) m = mul(m, trs(b.getTranslation(), over.get(b) ?? b.getRotation(), b.getScale()))
    return m }
  const P = (name) => { const m = W(by[name]); return [m[12], m[13], m[14]] }

  const before = {}
  const after = {}
  let ok = true
  for (const side of ['Left', 'Right']) {
    const A = by[side + 'Arm'], F = by[side + 'ForeArm'], H = by[side + 'Hand']
    if (!A || !F || !H) { ok = false; break }
    const meas = () => { const sh = P(side + 'Arm'), el = P(side + 'ForeArm'), wr = P(side + 'Hand')
      const hip = P(side + 'UpLeg'), knee = P(side + 'Leg'), hips = P('Hips')
      return { elbow: ang(sub(el, sh), sub(wr, el)),
        wristX: Math.abs(wr[0] - hips[0]) * 100,
        // 허벅지 윗면 ≈ 엉덩이~무릎 중간 높이 + 대퇴 반지름(8cm)
        wristY: (wr[1] - ((hip[1] + knee[1]) / 2 + 0.08)) * 100,
        wristZ: (wr[2] - hips[2]) * 100 } }
    before[side] = meas()
    const aR = A.getRotation(), fR = F.getRotation()
    let best = null
    for (let ax = -25; ax <= 25; ax += 5) for (let az = -35; az <= 15; az += 5)
      for (let fx = -80; fx <= 10; fx += 5) for (let fz = -45; fz <= 25; fz += 5) {
        over.set(A, qmul(aR, eul(ax, 0, az)))
        over.set(F, qmul(fR, eul(fx, 0, fz)))
        const m = meas(), sc = score(m)
        if (!best || sc < best.sc) best = { sc, ax, az, fx, fz, m }
      }
    over.set(A, qmul(aR, eul(best.ax, 0, best.az)))
    over.set(F, qmul(fR, eul(best.fx, 0, best.fz)))
    after[side] = best.m
    if (write) {
      A.setRotation(qmul(aR, eul(best.ax, 0, best.az)))
      F.setRotation(qmul(fR, eul(best.fx, 0, best.fz)))
    }
  }
  if (!ok) { console.log(slug.padEnd(13), '팔 본을 못 찾았다 — 건너뜀'); continue }
  const f = (v) => v.toFixed(0)
  console.log(slug.padEnd(13),
    `${f(before.Left.elbow)}→${f(after.Left.elbow)}°`.padStart(12),
    `${f(before.Left.wristX)}→${f(after.Left.wristX)}cm`.padStart(13),
    f(after.Left.wristY).padStart(8) + 'cm',
    f(after.Left.wristZ).padStart(8) + 'cm')
  if (write) await io.write(path, doc)
}
console.log(write ? '\n고쳐 썼다.' : '\n--write 를 붙이면 실제로 고친다.')
