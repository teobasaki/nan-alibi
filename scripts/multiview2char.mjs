#!/usr/bin/env node
/**
 * 멀티뷰 사진 → 3D → 리깅.
 *
 * ## 왜 여러 장인가
 * 정면 한 장만 주면 Meshy 는 **옆·뒤를 지어낸다.** 그래서 실루엣이 뭉개지고
 * 표면 요철이 얕아져 "사진을 세워둔 것" 처럼 보인다.
 * 여러 시점을 주면 그 면들이 추측이 아니라 실제 정보로 채워진다.
 *
 * ## 예전 설정의 문제 (배포본을 열어 실측한 것)
 * | | 예전 | 지금 |
 * |---|---|---|
 * | 폴리곤 | 30,000 — 손에 몇백 개뿐이라 손가락이 뭉쳤다 | 150,000 |
 * | 배포 텍스처 | 768 (원본 2048 의 1/7) | 2048 |
 * | PBR 맵 | 없음 → 표면 요철이 사라져 레고처럼 보였다 | 요청 + 수신 여부를 찍는다 |
 *
 * 텍스처 한 장이 몸 전체 아틀라스라, 768 이면 얼굴에 배정되는 건 실질 200~300px 이다.
 * 화면에서 얼굴이 그보다 크게 나오므로 뭉개져 보였다.
 *
 * 사용법: node scripts/multiview2char.mjs <slug>
 *   public/refs/<slug>-{front,left,right,back}.png 를 읽는다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASE = 'https://api.meshy.ai/openapi'
const key = /^MESHY_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf-8'))[1].trim().replace(/^["']|["']$/g, '')
const slug = process.argv[2] ?? 'security'
const VIEWS = ['front', 'left', 'right', 'back']
/**
 * 얼굴 클로즈업 시점. **있으면 함께 넣는다.**
 *
 * 왜 필요한가: 전신 한 장에서 얼굴은 키의 1/7.5 밖에 안 된다.
 * 4면 시트를 쪼개면 거기서 또 1/4 이 되어 **실측 84px** 까지 떨어졌다 —
 * 화면에서 얼굴이 200px 넘게 나오는데 소스가 84px 이면 확대일 뿐이다.
 * 머리·어깨만 담은 시트를 따로 받으면 같은 요청 한 번으로 **300px 이상**이 된다.
 *
 * 전신은 실루엣·의상·비율을, 얼굴 클로즈업은 이목구비를 담당한다.
 */
const FACE_VIEWS = ['face-front', 'face-left', 'face-right', 'face-back']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const req = async (p, init) => {
  const r = await fetch(BASE + p, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : null
}
const bal = async () => (await req('/v1/balance')).balance

/**
 * **있는 시점만 쓴다.** 넷을 다 갖추면 가장 좋지만, 둘만 있어도 정면 한 장보다는 낫다 —
 * 멀티뷰가 실제로 효과가 있는지 싸게 확인하려면 이 유연성이 필요하다.
 * 최소 둘은 있어야 '멀티' 라고 부를 수 있다.
 */
const body = VIEWS.map((v) => `public/refs/${slug}-${v}.png`).filter((f) => existsSync(f))
const face = FACE_VIEWS.map((v) => `public/refs/${slug}-${v}.png`).filter((f) => existsSync(f))
const files = [...body, ...face]
if (body.length < 2) {
  console.error(`전신 시점이 ${body.length}개뿐이다. 최소 2개 필요.`)
  console.error(`public/refs/${slug}-{front,left,right,back}.png — 같은 인물·같은 의상이어야 한다.`)
  process.exit(1)
}
console.log(`  전신 ${body.length}장 + 얼굴 ${face.length}장 = ${files.length}장`)
if (!face.length) {
  console.log('  ⚠️ 얼굴 클로즈업이 없다 — 얼굴 해상도가 84px 수준에 머문다')
}

const urls = files.map((f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`)
const start = await bal()
console.log(`\n▶ ${slug} · 멀티뷰 ${urls.length}장 → 3D · 잔액 ${start}\n`)

const { result: id } = await req('/v1/multi-image-to-3d', {
  method: 'POST',
  body: JSON.stringify({
    image_urls: urls,
    ai_model: 'meshy-6',
    should_texture: true,
    enable_pbr: true,
    should_remesh: true,
    topology: 'quad',
    target_polycount: 150000,
  }),
})

process.stdout.write('  메시 ')
let job
for (let i = 0; i < 300; i++) {
  await sleep(4000)
  job = await req(`/v1/multi-image-to-3d/${id}`)
  if (job.status === 'SUCCEEDED') break
  if (job.status === 'FAILED' || job.status === 'CANCELED') throw new Error(JSON.stringify(job.task_error ?? {}))
  process.stdout.write('.')
}
writeFileSync(`public/characters/${slug}.mv.glb`, Buffer.from(await (await fetch(job.model_urls.glb)).arrayBuffer()))
console.log(`\n  메시 ${start - (await bal())}크레딧 · ${slug}.mv.glb`)

// enable_pbr 을 줘도 맵이 안 오는 경우가 있었다. 무엇이 왔는지 반드시 찍는다.
const maps = Object.keys(job.texture_urls?.[0] ?? {})
console.log(`  받은 텍스처 맵: ${maps.length ? maps.join(', ') : '(없음 — 노멀맵 부재가 레고 느낌의 원인이다)'}`)

const { result: rigId } = await req('/v1/rigging', {
  method: 'POST',
  body: JSON.stringify({ input_task_id: id, height_meters: 1.72 }),
})
process.stdout.write('  리깅 ')
let rig
for (let i = 0; i < 300; i++) {
  await sleep(4000)
  rig = await req(`/v1/rigging/${rigId}`)
  if (rig.status === 'SUCCEEDED') break
  if (rig.status === 'FAILED' || rig.status === 'CANCELED') {
    console.log(`\n  ⚠️ 리깅 실패: ${JSON.stringify(rig.task_error ?? {}).slice(0, 200)}`)
    break
  }
  process.stdout.write('.')
}
if (rig?.result?.rigged_character_glb_url) {
  writeFileSync(
    `public/characters/${slug}.mvrigged.glb`,
    Buffer.from(await (await fetch(rig.result.rigged_character_glb_url)).arrayBuffer()),
  )
  console.log(`\n  저장: ${slug}.mvrigged.glb`)
}
const end = await bal()
console.log(`  합계 ${start - end}크레딧 · 잔액 ${end}\n`)
