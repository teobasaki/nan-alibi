#!/usr/bin/env node
/**
 * varco 로 효과음을 생성한다 — **명세(`src/ui/sfxSpec.ts`)가 유일한 입력이다.**
 *
 * ## 이 프로젝트가 크레딧 44% 를 태우며 배운 두 규칙을 여기서부터 지킨다
 * ① **하나로 먼저 검증한다.** 인자 없이 돌리면 아무것도 생성하지 않고 명세만 점검한다.
 *    `--only stamp` 로 한 개를 만들어 귀로 들어본 뒤에야 `--all` 을 쓴다.
 * ② **도구 출력을 확인하고 다음으로 넘긴다.** 받은 바이트 수·형식을 검사하고,
 *    이상하면 파일을 쓰지 않는다. 빈 파일이 에셋 폴더에 들어가는 게 최악이다.
 *
 * ## 실패해도 게임은 그대로 간다
 * 생성물이 없으면 `sound.ts` 의 Web Audio 합성음이 그대로 쓰인다.
 * 그래서 이 스크립트는 빌드에 걸지 않는다 — 수동으로만 돈다.
 *
 * 사용:
 *   node scripts/gen-sfx.mjs                 명세 점검만 (키 불필요)
 *   node scripts/gen-sfx.mjs --only stamp    하나만 생성
 *   node scripts/gen-sfx.mjs --all           전부 생성 (하나 검증 후에만)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/sfx')
const ENDPOINT = process.env.VARCO_SFX_URL ?? 'https://api.varco.ai/v1/audio/generate'

/** `.dev.vars` 에서 키를 읽는다. 값을 출력하지 않는다. */
function readKey() {
  const f = resolve(ROOT, '.dev.vars')
  if (!existsSync(f)) return null
  const m = readFileSync(f, 'utf8').match(/^VARCO_API_KEY=(.+)$/m)
  const v = m?.[1]?.trim()
  return v && v.length > 8 ? v : null
}

/**
 * 명세를 TS 소스에서 읽는다. 빌드 없이 돌기 위해 정규식으로 뽑는다 —
 * 명세가 데이터라서 가능한 일이고, 형식이 깨지면 여기서 바로 걸린다.
 */
function loadSpecs() {
  const src = readFileSync(resolve(ROOT, 'src/ui/sfxSpec.ts'), 'utf8')
  const specs = []
  const re = /\{\s*key:\s*'([^']+)',[\s\S]*?moment:\s*'([^']*)',[\s\S]*?meaning:\s*'([^']*)',[\s\S]*?prompt:\s*([\s\S]*?),\s*seconds:\s*([\d.]+),\s*\}/g
  let m
  while ((m = re.exec(src))) {
    const prompt = m[4].split('\n').map((l) => l.trim()).join(' ')
      .replace(/^'|'$/g, '').replace(/'\s*\+\s*'/g, '').trim()
    specs.push({ key: m[1], moment: m[2], meaning: m[3], prompt, seconds: Number(m[5]) })
  }
  return specs
}

/** 명세 자체를 검증한다 — 생성 전에 걸러야 크레딧을 안 태운다 */
function lint(specs) {
  const problems = []
  if (specs.length === 0) problems.push('명세를 하나도 못 읽었다 — sfxSpec.ts 형식이 바뀌었나')
  const seen = new Set()
  for (const s of specs) {
    if (seen.has(s.key)) problems.push(`${s.key}: 키가 중복이다`)
    seen.add(s.key)
    if (s.prompt.length < 40) problems.push(`${s.key}: 프롬프트가 너무 짧다 (${s.prompt.length}자)`)
    if (!/no music/i.test(s.prompt)) problems.push(`${s.key}: "no music" 이 없다 — 배경음이 섞여 나온다`)
    if (s.seconds <= 0 || s.seconds > 5) problems.push(`${s.key}: 길이 ${s.seconds}초가 범위 밖이다`)
    if (!s.moment || !s.meaning) problems.push(`${s.key}: moment/meaning 이 비었다`)
  }
  return problems
}

async function generate(spec, key) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: spec.prompt, duration: spec.seconds, format: 'wav' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())

  // **받은 것을 확인하고 넘긴다.** 이 검사가 없어서 예전에 빈 파일이 파이프라인을 탔다.
  if (buf.length < 1024) throw new Error(`받은 데이터가 ${buf.length}바이트 — 오디오가 아니다`)
  const head = buf.subarray(0, 4).toString('ascii')
  if (head !== 'RIFF' && head !== 'OggS' && !buf.subarray(0, 3).equals(Buffer.from([0xff, 0xfb, 0x90]))) {
    throw new Error(`알 수 없는 형식 (앞 4바이트: ${head})`)
  }
  return buf
}

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const all = args.includes('--all')

const specs = loadSpecs()
const problems = lint(specs)

console.log(`명세 ${specs.length}건`)
for (const s of specs) console.log(`  ${s.key.padEnd(9)} ${s.seconds}초  ${s.moment}`)

if (problems.length) {
  console.error('\n✗ 명세 문제:')
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log('✓ 명세 점검 통과')

if (!only && !all) {
  console.log('\n생성하려면 --only <key> 로 하나 먼저 만들어 들어보고, 그 다음 --all.')
  process.exit(0)
}

const key = readKey()
if (!key) {
  console.error('\n✗ .dev.vars 에 VARCO_API_KEY 가 없다. 값은 직접 넣어라 — 이 스크립트는 키를 출력하지 않는다.')
  process.exit(1)
}

const targets = only ? specs.filter((s) => s.key === only) : specs
if (targets.length === 0) {
  console.error(`✗ '${only}' 라는 키가 명세에 없다`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
let ok = 0
for (const s of targets) {
  process.stdout.write(`  ${s.key} … `)
  try {
    const buf = await generate(s, key)
    writeFileSync(resolve(OUT, `${s.key}.wav`), buf)
    console.log(`${(buf.length / 1024).toFixed(0)}KB`)
    ok++
  } catch (e) {
    console.log(`실패 — ${e.message}`)
  }
}
console.log(`\n${ok}/${targets.length} 생성. 실패한 것은 합성음이 그대로 쓰인다.`)
