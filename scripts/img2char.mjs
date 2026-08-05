#!/usr/bin/env node
/**
 * 인물 사진 → 3D. text-to-3d 보다 **원본 얼굴을 잘 보존하는지** 확인하는 실험.
 * 사용법: node scripts/img2char.mjs <slug>   (public/portraits/<slug>.png 를 쓴다)
 */
import { readFileSync, writeFileSync } from 'node:fs'
const BASE = 'https://api.meshy.ai/openapi'
const key = /^MESHY_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars','utf-8'))[1].trim().replace(/^["']|["']$/g,'')
const slug = process.argv[2] ?? 'security'
const sleep = (ms) => new Promise(r=>setTimeout(r,ms))
const req = async (p, init) => {
  const r = await fetch(BASE+p, { ...init, headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json', ...(init?.headers??{}) }})
  const t = await r.text(); if(!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0,300)}`)
  return t ? JSON.parse(t) : null
}
const bal = async () => (await req('/v1/balance')).balance

// **전신 T포즈 레퍼런스**를 쓴다 (public/refs). 흉상(public/portraits)을 넣으면
// 3D 도 흉상이 되고 오토리깅이 "Pose estimation failed" 로 거부한다 — 실제로 겪었다.
const b64 = readFileSync(`public/refs/${slug}.png`).toString('base64')
const start = await bal()
console.log(`▶ ${slug} 사진 → 3D · 잔액 ${start}`)

const { result: id } = await req('/v1/image-to-3d', { method:'POST', body: JSON.stringify({
  image_url: `data:image/png;base64,${b64}`,
  ai_model: 'meshy-6', should_texture: true, enable_pbr: true,
  should_remesh: true, topology: 'quad', target_polycount: 30000,
})})
process.stdout.write('  생성 ')
let job
for (let i=0;i<200;i++){ await sleep(4000); job = await req(`/v1/image-to-3d/${id}`)
  if (job.status==='SUCCEEDED') break
  if (job.status==='FAILED'||job.status==='CANCELED') throw new Error(JSON.stringify(job.task_error??{}))
  process.stdout.write('.') }
writeFileSync(`public/characters/${slug}.img.glb`, Buffer.from(await (await fetch(job.model_urls.glb)).arrayBuffer()))
const afterMesh = await bal()
console.log(`\n  메시 ${start-afterMesh}크레딧`)

// 리깅까지 붙여야 앉힐 수 있다
const { result: rigId } = await req('/v1/rigging', { method:'POST', body: JSON.stringify({ input_task_id: id, height_meters: 1.7 })})
process.stdout.write('  리깅 ')
let rig
for (let i=0;i<200;i++){ await sleep(4000); rig = await req(`/v1/rigging/${rigId}`)
  if (rig.status==='SUCCEEDED') break
  if (rig.status==='FAILED'||rig.status==='CANCELED') { console.log(`\n  ⚠️ 리깅 실패: ${JSON.stringify(rig.task_error??{}).slice(0,200)}`); break }
  process.stdout.write('.') }
if (rig?.result?.rigged_character_glb_url) {
  writeFileSync(`public/characters/${slug}.imgrigged.glb`, Buffer.from(await (await fetch(rig.result.rigged_character_glb_url)).arrayBuffer()))
  console.log(`\n  저장: ${slug}.imgrigged.glb`)
}
console.log(`  합계 ${start - await bal()}크레딧 · 잔액 ${await bal()}`)
