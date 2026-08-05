#!/usr/bin/env node
/**
 * 사건 시드 풀 굽기 — 검증을 **빌드 타임으로** 옮긴다 (완료기준 D4).
 *
 * 왜 필요한가: `generateValidCase(seed)` 는 실패하면 파생 시드로 최대 40회 재시도한다.
 * 그게 **게임 시작 시점**에 돌면 최악의 경우 첫 화면이 눈에 띄게 늦는다.
 * 그러니 "첫 시도에 통과하는 시드" 만 미리 골라 구워 두고, 런타임은 그중 하나를 집기만 한다.
 *
 * 계약 (깨면 서버가 죽는다):
 *   구워진 값은 **시드 그 자체**다. `functions/api/interrogate.ts` 가 같은 시드로 사건을
 *   재생성하므로, 사건 데이터를 굽거나 시드를 가공해 저장하면 클라이언트와 서버가 갈라진다.
 *
 * 엔진이 TS 라서 노드로 직접 못 부른다 → scripts/review.mjs 와 같은 방식으로
 * 임시 테스트 파일을 만들어 vitest 러너에 태운다.
 * 다만 결과는 stdout 이 아니라 파일로 받는다 — 큰 출력은 잘려 나간 전례가 있다.
 *
 * 사용법:
 *   npm run gen:pool                       # 시드 1~3000 스캔
 *   FROM=1 TO=8000 npm run gen:pool        # 범위 지정
 */
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const FROM = Number(process.env.FROM ?? 1)
const TO = Number(process.env.TO ?? 3000)
const MIN_POOL = Number(process.env.MIN_POOL ?? 200)
/**
 * 통과한 시드를 전부 굽지 않고 이만큼만 남긴다.
 * 지금 생성기는 첫 시도 통과율이 100% 라, 전부 구우면 pool.json 이 그냥 [1..3000] 이 된다 —
 * 정보량 0 인 15KB 를 번들에 싣는 셈이다. 400개면 반복 플레이에 차고 넘치고,
 * **스캔 범위 전체에 고르게** 뽑으므로 생성기가 특정 구간에서 깨지면 테스트가 잡아낸다
 * (앞에서부터 400개를 자르면 1~400 구간만 감시하게 된다).
 */
const POOL_SIZE = Number(process.env.POOL_SIZE ?? 400)

const TEST_PATH = 'tests/_genpool.test.ts'
const OUT_PATH = 'src/data/pool.json'
const TMP_DIR = 'node_modules/.cache/nan-alibi'
const TMP_PATH = `${TMP_DIR}/genpool.json`

mkdirSync(TMP_DIR, { recursive: true })

const src = `
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { generateValidCase } from '../src/engine/validate'

it('gen-pool', () => {
  const seeds: number[] = []
  let scanned = 0
  for (let seed = ${FROM}; seed <= ${TO}; seed++) {
    scanned++
    try {
      // maxAttempts=1 → 재시도 없이 첫 시도에 통과한 시드만 남는다
      const g = generateValidCase(seed, 1)
      if (g.validation.ok && g.attempts === 1) seeds.push(seed)
    } catch {
      // 첫 시도 실패 = 풀에 넣지 않는다. 그게 이 스크립트의 목적이다.
    }
  }
  writeFileSync(${JSON.stringify(TMP_PATH)}, JSON.stringify({ seeds, scanned }))
}, 600000)
`

writeFileSync(TEST_PATH, src)
let result
try {
  execFileSync('npx', ['vitest', 'run', TEST_PATH], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  result = JSON.parse(readFileSync(TMP_PATH, 'utf-8'))
} finally {
  rmSync(TEST_PATH, { force: true })
  rmSync(TMP_PATH, { force: true })
}

const { seeds, scanned } = result
const rate = ((seeds.length / scanned) * 100).toFixed(1)

if (seeds.length < MIN_POOL) {
  throw new Error(
    `첫 시도 통과 시드가 ${seeds.length}개뿐이다 (최소 ${MIN_POOL}). 스캔 범위(FROM~TO)를 넓혀라.`,
  )
}

// 통과분에서 고르게 솎아낸다 (POOL_SIZE 이하면 전부 남는다)
const step = Math.max(1, Math.floor(seeds.length / POOL_SIZE))
const pool = seeds.filter((_, i) => i % step === 0).slice(0, POOL_SIZE)
if (pool.length < MIN_POOL) throw new Error(`솎아낸 풀이 ${pool.length}개다 (최소 ${MIN_POOL})`)

// 한 줄에 다 몰아넣으면 diff 가 읽히지 않는다 — 12개씩 끊는다
const lines = []
for (let i = 0; i < pool.length; i += 12) lines.push('  ' + pool.slice(i, i + 12).join(', '))
writeFileSync(OUT_PATH, `[\n${lines.join(',\n')}\n]\n`)

console.log(`\n▶ 시드 ${FROM}~${TO} (${scanned}개) 스캔`)
console.log(`  첫 시도 통과: ${seeds.length}개 (${rate}%)`)
console.log(`  풀에 구움: ${pool.length}개 (${pool[0]} ~ ${pool[pool.length - 1]})`)
console.log(`  → ${OUT_PATH}`)
