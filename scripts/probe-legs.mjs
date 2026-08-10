#!/usr/bin/env node
/**
 * **다리 위상·무릎 각도를 8종 전부, 브라우저 없이 재본다.**
 *
 * 왜 있나: "캐릭터 다리가 안 떨어져 있다(붙어 보임)" 실플레이 리포트.
 * 걷기 클립은 unrollLegs(ADR 021 — rest delta 에 (x,y,z,w)→(-x,y,-z,w))를 거쳐
 * 재생되는데, 재굽기(pose-seated 7종) 후 rest 가 바뀐 모델에서 이 보정이
 * 오적용/미적용되면 두 다리가 **동상**(같이 움직임)으로 붙거나 꼬인다.
 * 한 모델 확인으로 결론 내지 않는다 — ADR 020·021 의 교훈 그대로 전 모델을 돌린다.
 *
 * 잰다:
 *   [걷기 7종]  L/R UpLeg 의 rest 기준 delta 를 **런타임과 같은 보정을 적용한 뒤**
 *               주축에 사영한 신호 sL(t)·sR(t) 의 상관계수.
 *               교차 보행 = 위상 반대 = **상관 음수**. 동상(붙음) = 양수 = 환자.
 *   [착석 8종]  무릎 굽힘각(허벅지↔정강이, 앉음 = 60~120° 기대)과
 *               무릎·발 좌우 간격(m). 간격 ≈ 0 이면 다리가 붙어 구워진 것.
 *
 *   node scripts/probe-legs.mjs
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { readdirSync } from 'node:fs'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
})

// ── 쿼터니언 소도구 (three 없이) ──
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const qInv = (q) => [-q[0], -q[1], -q[2], q[3]]   // 단위 쿼터니언 가정
/** 회전 벡터(axis*angle) — 위상 신호의 재료 */
const qToRotVec = (q) => {
  const w = Math.min(1, Math.max(-1, q[3]))
  const ang = 2 * Math.acos(w)
  const s = Math.sqrt(Math.max(0, 1 - w * w))
  if (s < 1e-6) return [0, 0, 0]
  const k = (ang > Math.PI ? ang - 2 * Math.PI : ang) / s   // 최단호로 정규화
  return [q[0] * k, q[1] * k, q[2] * k]
}

const findNode = (doc, name) => doc.getRoot().listNodes().find((n) => n.getName() === name)
const worldPos = (node) => { const m = node.getWorldMatrix(); return [m[12], m[13], m[14]] }
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const angleBetween = (u, v) => {
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const lu = Math.hypot(...u), lv = Math.hypot(...v)
  return Math.acos(Math.min(1, Math.max(-1, d / (lu * lv)))) * 180 / Math.PI
}

/** 트랙에서 본 이름의 quaternion 샘플 배열을 뽑는다 */
const quatTrack = (doc, boneName) => {
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetNode()?.getName() !== boneName || ch.getTargetPath() !== 'rotation') continue
      const v = ch.getSampler().getOutput().getArray()
      const out = []
      for (let i = 0; i + 3 < v.length; i += 4) out.push([v[i], v[i + 1], v[i + 2], v[i + 3]])
      return out
    }
  }
  return null
}

const files = readdirSync('public/characters')
const walks = files.filter((f) => f.endsWith('.walk.opt.glb')).sort()
const seated = files.filter((f) => f.endsWith('.opt.glb') && !f.includes('.walk.')).sort()

// ── ① 걷기 — L/R 위상 (unrollLegs 적용 후, 런타임과 동일) ──
console.log('── 걷기 클립: L/R UpLeg 위상 (unrollLegs 보정 후) ──')
console.log('모델            프레임  상관계수   진폭L    진폭R   판정')
let sick = 0
for (const f of walks) {
  const slug = f.replace('.walk.opt.glb', '')
  const doc = await io.read(`public/characters/${f}`)
  const restL = findNode(doc, 'LeftUpLeg')?.getRotation() ?? [0, 0, 0, 1]
  const restR = findNode(doc, 'RightUpLeg')?.getRotation() ?? [0, 0, 0, 1]
  const trkL = quatTrack(doc, 'LeftUpLeg')
  const trkR = quatTrack(doc, 'RightUpLeg')
  if (!trkL || !trkR) { console.log(`${slug.padEnd(15)} 트랙 없음 — 확인 필요`); sick++; continue }

  // 런타임 unrollLegs: delta = rest⁻¹·q → (x,y,z,w)→(-x,y,-z,w). 위상은 delta 로 잰다.
  const deltas = (trk, rest) => trk.map((q) => {
    const d = qMul(qInv(rest), q)
    return qToRotVec([-d[0], d[1], -d[2], d[3]])
  })
  const dL = deltas(trkL, restL)
  const dR = deltas(trkR, restR)
  const n = Math.min(dL.length, dR.length)

  // 주축: L 신호의 분산 최대 축(간이 — 성분 분산 비교)
  const varAxis = (ds) => {
    const v = [0, 1, 2].map((k) => {
      const mean = ds.reduce((a, r) => a + r[k], 0) / ds.length
      return ds.reduce((a, r) => a + (r[k] - mean) ** 2, 0)
    })
    return v.indexOf(Math.max(...v))
  }
  const ax = varAxis(dL.slice(0, n))
  const sL = dL.slice(0, n).map((r) => r[ax])
  const sR = dR.slice(0, n).map((r) => r[ax])
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const mL = mean(sL), mR = mean(sR)
  let num = 0, denL = 0, denR = 0
  for (let i = 0; i < n; i++) { num += (sL[i] - mL) * (sR[i] - mR); denL += (sL[i] - mL) ** 2; denR += (sR[i] - mR) ** 2 }
  const corr = num / Math.sqrt(denL * denR || 1)
  const ampL = Math.max(...sL) - Math.min(...sL)
  const ampR = Math.max(...sR) - Math.min(...sR)
  // 판정: 진폭이 있는데 상관이 양수면 두 다리가 같이 움직인다 = 환자
  const still = ampL < 0.15 || ampR < 0.15
  const bad = !still && corr > -0.2
  if (bad) sick++
  console.log(`${slug.padEnd(15)} ${String(n).padStart(4)}   ${corr.toFixed(2).padStart(6)}   ${ampL.toFixed(2).padStart(5)}   ${ampR.toFixed(2).padStart(5)}   ${still ? '진폭 부족 — 확인 필요' : bad ? '✗ 동상(붙음)' : '✓ 교차 보행'}`)
}

// ── ② 착석 — 무릎 각도와 좌우 간격 (rest pose) ──
console.log('\n── 착석 rest: 무릎 굽힘각·좌우 간격 ──')
console.log('모델            무릎L    무릎R    무릎간격  발간격   판정')
for (const f of seated) {
  const slug = f.replace('.opt.glb', '')
  const doc = await io.read(`public/characters/${f}`)
  const g = (nm) => findNode(doc, nm)
  const need = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
  if (need.some((nm) => !g(nm))) { console.log(`${slug.padEnd(15)} 본 누락 — 확인 필요`); continue }
  const P = Object.fromEntries(need.map((nm) => [nm, worldPos(g(nm))]))
  // 무릎 굽힘각 = 180° - (허벅지 벡터 ↔ 정강이 벡터). 앉은 자세면 60~120° 굽힘 기대.
  const flex = (up, kn, ft) => 180 - angleBetween(sub(P[kn], P[up]), sub(P[ft], P[kn]))
  const kneeL = flex('LeftUpLeg', 'LeftLeg', 'LeftFoot')
  const kneeR = flex('RightUpLeg', 'RightLeg', 'RightFoot')
  const kneeGap = dist(P.LeftLeg, P.RightLeg)
  const footGap = dist(P.LeftFoot, P.RightFoot)
  const fused = kneeGap < 0.06 || footGap < 0.05        // 사실상 한 다리로 구워진 것
  const straight = kneeL < 25 && kneeR < 25              // 앉았는데 다리가 펴져 있음
  const verdict = fused ? '✗ 다리 붙음' : straight ? '△ 무릎이 펴짐(선 자세?)' : '✓'
  if (fused) sick++
  console.log(`${slug.padEnd(15)} ${kneeL.toFixed(0).padStart(4)}°   ${kneeR.toFixed(0).padStart(4)}°   ${kneeGap.toFixed(2)}m     ${footGap.toFixed(2)}m    ${verdict}`)
}

console.log(sick ? `\n✗ 환자 ${sick}건` : '\n✓ 전 모델 정상')
process.exit(sick ? 1 : 0)
