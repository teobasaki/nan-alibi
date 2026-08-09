#!/usr/bin/env node
/**
 * varco 사운드 API 규약 탐지기 — **추측을 반복하지 않고 재본다.**
 *
 * 첫 시도에서 내가 엔드포인트를 지어냈다가 404 HTML 을 받았다. Supertone 에서도
 * 같은 실수를 했다(없는 voice_id → 403). 두 번 같은 실수를 했으면 그건 우연이 아니라
 * 습관이므로, 여기서는 **후보를 늘어놓고 상류에게 물어본다.**
 *
 * 키는 `.dev.vars` 에서 읽고 **절대 출력하지 않는다.** 상태 코드와 응답 앞부분만 찍는다.
 *
 * 사용: node scripts/probe-varco.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readKey() {
  const f = resolve(ROOT, '.dev.vars')
  if (!existsSync(f)) return null
  const m = readFileSync(f, 'utf8').match(/^VARCO_API_KEY=(.+)$/m)
  const v = m?.[1]?.trim()
  return v && v.length > 8 ? v : null
}

/** 문서 사이트가 SPA 라 못 읽었다. 먼저 기계가 읽을 수 있는 스펙이 있는지 본다. */
const SPECS = [
  'https://api.varco.ai/openapi.json',
  'https://api.varco.ai/api/openapi.json',
  'https://api.varco.ai/en/reference/openapi.json',
  'https://api.varco.ai/docs/openapi.json',
  'https://api.varco.ai/v1/openapi.json',
  'https://api.varco.ai/swagger.json',
]

/** 문서 URL(`/en/reference/sound-mono2stereo`)에서 유추한 경로들 */
const ENDPOINTS = [
  'https://api.varco.ai/v1/sound/generate',
  'https://api.varco.ai/v1/sound/text-to-sound',
  'https://api.varco.ai/v1/sound/text2sound',
  'https://api.varco.ai/v1/sound',
  'https://api.varco.ai/api/v1/sound/generate',
  'https://api.varco.ai/sound/generate',
  'https://api.varco.ai/v1/audio/generate',
]

/** 인증 헤더 이름도 공급자마다 다르다 — 이것도 재본다 */
const AUTHS = (k) => [
  ['Authorization', `Bearer ${k}`],
  ['x-api-key', k],
  ['api-key', k],
  ['X-VARCO-API-KEY', k],
]

const short = (s) => s.replace(/\s+/g, ' ').slice(0, 120)

async function probe(url, headers, body) {
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    })
    const ct = res.headers.get('content-type') ?? ''
    const text = await res.text().catch(() => '')
    return { status: res.status, ct, body: short(text) }
  } catch (e) {
    return { status: 0, ct: '', body: short(String(e)) }
  }
}

const key = readKey()
if (!key) {
  console.error('✗ .dev.vars 에 VARCO_API_KEY 가 없다. 값은 직접 넣어라.')
  process.exit(1)
}
console.log('키 확인됨 (값은 출력하지 않는다)\n')

console.log('── ① 기계가 읽을 수 있는 스펙이 있는가 ──')
for (const u of SPECS) {
  const r = await probe(u, {})
  const good = r.status === 200 && r.ct.includes('json')
  console.log(`  ${good ? '★' : ' '} ${String(r.status).padEnd(3)} ${u}`)
  if (good) {
    console.log('\n    ↑ 스펙을 찾았다. 여기서 정확한 경로를 읽으면 된다.')
    console.log('   ', r.body)
    process.exit(0)
  }
}

console.log('\n── ② 엔드포인트 × 인증 헤더 조합 ──')
console.log('   (404=경로 없음 · 401/403=경로는 맞고 인증이 틀림 · 400=경로·인증 맞고 본문이 틀림)\n')
const hits = []
for (const url of ENDPOINTS) {
  for (const [hk, hv] of AUTHS(key)) {
    const r = await probe(url, { [hk]: hv }, { prompt: 'a single door closing', duration: 1 })
    // 404 HTML 은 "그런 경로 없음" 이다. 그 밖의 응답은 전부 단서다.
    const html = r.ct.includes('html')
    const mark = !html && r.status !== 404 ? '★' : ' '
    if (mark === '★') hits.push({ url, hk, ...r })
    console.log(`  ${mark} ${String(r.status).padEnd(3)} ${hk.padEnd(16)} ${url.replace('https://api.varco.ai', '')}`)
  }
}

console.log('\n── 결과 ──')
if (!hits.length) {
  console.log('  전부 404/HTML 이다. 경로 후보가 전부 틀렸다.')
  console.log('  → 문서(https://api.varco.ai/en/docs/plugin-sound)를 사람이 직접 열어')
  console.log('    curl 예제 한 줄만 알려주면 즉시 맞춘다.')
} else {
  for (const h of hits) {
    console.log(`  ${h.status} ${h.hk} ${h.url}`)
    console.log(`      ${h.body}`)
  }
}
