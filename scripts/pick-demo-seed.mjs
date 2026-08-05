#!/usr/bin/env node
/**
 * 60초 시연용 시드 고르기 — 해커톤 심사위원 앞에서 틀지 않을 한 판을 찾는다.
 *
 * 왜 필요한가: 사건은 시드마다 다르게 생성된다. 그중에는 "심문 세 번 해도 아무것도 안 걸리는"
 * 판도 있고 "두 번째 행동에서 바로 모순이 터지는" 판도 있다. 60초 시연에서는 후자만 쓸모가 있다.
 * 감으로 고르면 리허설 때 괜찮던 시드가 본무대에서 밋밋해진다 — 조건을 숫자로 박고 스캔한다.
 *
 * 좋은 데모 시드의 조건 (필수):
 *   ① 상식 봇이 **이긴다** — 심사위원 앞에서 지면 안 된다
 *   ② 조사 4회 이내에 **첫 모순**이 나온다 — "아하" 가 빨리 와야 한다
 *   ③ 증거 제시에서 **★반응**(무언가 열림)이 최소 1회 — LLM 페르소나가 흔들리는 장면이
 *      이 게임의 킬러 데모다. 무반응만 나오는 판은 화면상 아무 일도 안 일어난 것처럼 보인다
 * 가산점:
 *   ④ **결정적 증거까지 적중** — 완주 장면이 붙으면 최고
 *   ⑤ 행동 수가 적다 — 60초 안에 실제로 클릭할 수 있어야 한다
 *
 * TS 엔진은 vitest 러너를 통해 돌린다 (scripts/review.mjs 의 collectTranscripts 패턴).
 *
 * **기본은 사전 검증 시드 풀(`src/data/pool.json`)만 훑는다.** 풀 밖의 시드도 `?seed=` 로 열리지만,
 * 풀 시드는 생성기가 **첫 시도에** 통과한 것이 증명돼 있어(tests/pool.test.ts) 판 시작 대기가 0초다.
 * 심사위원 앞에서 재시도 지연을 볼 이유가 없다.
 *
 * 사용법:
 *   npm run demo:seed                 # 사전 검증 풀 전체 스캔 (권장)
 *   npm run demo:seed -- 70000 600    # 임의 범위: 시작 시드 70000 부터 600개
 */
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

/** 인자가 없으면 풀 모드 */
const RANGE = process.argv[2] !== undefined
const START = Number(process.argv[2] ?? 0)
const COUNT = Number(process.argv[3] ?? 400)
/** 조건 ②의 상한 — "조사 N회 이내에 첫 모순" */
const FIRST_CONTRA_MAX = Number(process.env.FIRST_CONTRA_MAX ?? 4)
/** 자세히 볼 상위 후보 수 (stdout 64KB 절단 방지) */
const TOP = 8

const TMP = 'tests/_demo-seed.test.ts'

const src = `
import { it } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { commonsenseBot, botRng } from '../src/engine/bots'
import { createGame, availableEvidence } from '../src/engine/game'
import { SLOT_LABEL, PLACE_LABEL, SUSPECTS, CRIME_SLOT, CRIME_PLACE } from '../src/types'
import { personaById } from '../src/data/personas'
import { INVESTIGATION_BUDGET } from '../src/data/config'
import { SEED_POOL } from '../src/data/pool'

const FIRST_CONTRA_MAX = ${FIRST_CONTRA_MAX}, TOP = ${TOP}
const SEEDS: number[] = ${RANGE}
  ? Array.from({ length: ${COUNT} }, (_, i) => ${START} + i)
  : [...SEED_POOL]
const POOL = new Set(SEED_POOL)

/**
 * "몇 번째 조사에서 첫 모순이 나왔나" 를 예산 오버라이드로 **재현**해 구한다.
 * 상식 봇의 행동 선택은 investigationsLeft 에 의존하지 않고 rng 는 매번 같은 시드로 새로 만들므로,
 * budget=k 로 돌린 결과는 전체 판의 앞 k 행동과 정확히 같다. 아래에서 prefix 일치를 실제로 검증한다.
 */
function firstContradictionAt(c: any, full: string[]): number | null {
  for (let k = 1; k <= INVESTIGATION_BUDGET; k++) {
    const r = commonsenseBot(c, botRng(c.seed), k)
    // 재현 전제 검증 — 깨지면 이 시드는 버린다 (거짓 숫자를 내보내느니 후보에서 뺀다)
    for (let i = 0; i < k; i++) if (r.log[i] !== full[i]) return null
    if (r.contradictions > 0) return k
  }
  return null
}

const evLabel = (c: any, id: string) => {
  const e = c.evidence.find((x: any) => x.id === id)
  if (!e) return id
  return \`\${id} [\${e.kind} · \${SLOT_LABEL[e.slot]} · \${PLACE_LABEL[e.place]}]\`
}
const evSubjects = (c: any, id: string) => {
  const e = c.evidence.find((x: any) => x.id === id)
  return e ? e.subjects.map((s: string) => c.suspects[s].name).join(', ') : ''
}

/** 봇 로그 한 줄을 사람이 읽는 시연 지시로 바꾼다 */
function annotate(c: any, line: string): string {
  if (line.startsWith('제출')) return line
  const m = /^(심문|조회|제시)\\s+(\\S+?)(?:\\s+(.*))?$/.exec(line)
  if (!m) return line
  const [, kind, arg, tail = ''] = m
  if (kind === '심문') return \`심문: \${c.suspects[arg].name}(\${c.suspects[arg].job}) \${tail}\`
  if (kind === '조회') return \`조회: \${evLabel(c, arg)} → 확정 인물 \${evSubjects(c, arg)} \${tail}\`
  const [ev, s] = arg.split('→')
  return \`제시: \${evLabel(c, ev)} → \${c.suspects[s].name} \${tail}\`
}

it('scan', () => {
  const rows: any[] = []
  for (const seed of SEEDS) {
    let c: any
    try { c = generateValidCase(seed).case } catch { continue }
    const r = commonsenseBot(c, botRng(seed))
    if (!r.won) continue
    const reactions = r.log.filter((l) => l.includes('★반응')).length
    if (reactions < 1) continue
    const fc = firstContradictionAt(c, r.log)
    if (fc === null || fc > FIRST_CONTRA_MAX) continue
    const last = r.log[r.log.length - 1] ?? ''
    const decisive = last.includes('증거 적중')
    const method = last.includes('수단 적중')
    const scoreM = /점수 (\\d+)/.exec(last)
    /**
     * **시연 길이는 봇의 소모 횟수가 아니다.** 봇은 예산이 남으면 계속 파므로 항상 9회를 쓴다.
     * 사람은 결정적 증거를 손에 쥔 순간 제출하면 된다 — 그 지점까지가 실제 시연 길이다.
     */
    const decisiveAt = r.log.findIndex((l) => l.startsWith(\`조회 \${c.decisiveEvidenceId} \`) || l === \`조회 \${c.decisiveEvidenceId}\`) + 1
    const firstReactionAt = r.log.findIndex((l) => l.includes('★반응')) + 1
    rows.push({
      seed, inPool: POOL.has(seed), reactions, firstContradictionAt: fc, actions: r.actionsUsed,
      demoActions: decisiveAt || r.actionsUsed, firstReactionAt,
      contradictions: r.contradictions, decisive, method,
      score: Number(scoreM?.[1] ?? 0),
      // 시연 적합도: 결정적 증거 완주 > 반응 횟수 > 짧은 시연 > 이른 모순 > 이른 반응
      demoScore: (decisive ? 100 : 0) + reactions * 15 - (decisiveAt || 99) * 8 - fc * 5 - firstReactionAt * 3,
      log: r.log,
    })
  }
  rows.sort((a, b) => b.demoScore - a.demoScore || a.demoActions - b.demoActions || a.seed - b.seed)

  const top = rows.slice(0, TOP).map((x) => {
    const c = generateValidCase(x.seed).case
    return {
      ...x,
      title: c.title,
      venue: \`\${c.venue.name} \${c.venue.room}\`,
      victim: \`\${c.victim.name}(\${c.victim.title})\`,
      culprit: \`\${c.suspects[c.culprit].name} (\${c.culprit})\`,
      motive: c.motive, methodText: c.method,
      crime: \`\${SLOT_LABEL[CRIME_SLOT]} · \${PLACE_LABEL[CRIME_PLACE]}\`,
      decisiveEvidence: evLabel(c, c.decisiveEvidenceId),
      suspects: SUSPECTS.map((s) => {
        const p = c.suspects[s]
        return \`\${s} \${p.name} / \${p.job} / \${p.relation} / "\${SLOT_LABEL[CRIME_SLOT]}엔 \${PLACE_LABEL[p.claim[CRIME_SLOT]]}" / 성향 \${personaById(p.personaId).label}\`
      }),
      menu: availableEvidence(createGame(c)).map((e) => \`\${e.id} \${e.kind} · \${SLOT_LABEL[e.slot]} · \${PLACE_LABEL[e.place]}\`),
      locked: c.evidence.filter((e: any) => e.requires.length).map((e: any) =>
        \`\${e.id} \${e.kind} · \${SLOT_LABEL[e.slot]} · \${PLACE_LABEL[e.place]} ← 선행 \${e.requires.join(', ')}\${e.decisive ? ' ★결정적' : ''}\`),
      steps: x.log.map((l: string) => annotate(c, l)),
    }
  })

  console.log('===JSON===' + JSON.stringify({
    scanned: SEEDS.length, mode: ${RANGE} ? \`범위 \${SEEDS[0]}~\${SEEDS[SEEDS.length - 1]}\` : '사전 검증 시드 풀',
    passed: rows.length,
    budget: INVESTIGATION_BUDGET, firstContraMax: FIRST_CONTRA_MAX,
    shortlist: rows.slice(0, 15).map((x) => ({
      seed: x.seed, pool: x.inPool, act: x.demoActions, fc: x.firstContradictionAt, react: x.reactions,
      ra: x.firstReactionAt, dec: x.decisive, score: x.score, demo: x.demoScore,
    })),
    top,
  }))
})
`

writeFileSync(TMP, src)
let out
try {
  out = execSync(`npx vitest run ${TMP}`, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
} finally {
  execSync(`rm -f ${TMP}`)
}
const line = out.split('\n').find((l) => l.includes('===JSON==='))
if (!line) {
  console.error(out.slice(-4000))
  throw new Error('스캔 출력이 없다 — 위 vitest 출력을 보라')
}
const d = JSON.parse(line.slice(line.indexOf('===JSON===') + 10))

console.log(`\n▶ ${d.mode} · ${d.scanned}개 스캔 · 예산 ${d.budget}회`)
console.log(`  조건: 상식봇 승리 + 첫 모순 ≤${d.firstContraMax}회 + ★반응 ≥1회`)
console.log(`  통과: ${d.passed}개 (${((d.passed / d.scanned) * 100).toFixed(1)}%)\n`)

if (!d.passed) {
  console.log('❌ 조건을 만족하는 시드가 없다. 범위를 넓히거나 FIRST_CONTRA_MAX 를 올려라.')
  process.exit(1)
}

console.log('  상위 후보 — 시연행동 = 결정적 증거를 손에 쥘 때까지의 조사 수 (여기서 제출하면 만점)')
console.log('  seed      풀  시연행동  첫모순  ★반응(회/회차)  결정적증거  점수  demo')
for (const s of d.shortlist) {
  console.log(`  ${String(s.seed).padEnd(9)} ${s.pool ? '●' : '○'} ${String(s.act).padStart(6)}   ${String(s.fc).padStart(5)}   ${String(s.react).padStart(6)}/${String(s.ra).padEnd(6)} ${(s.dec ? '  적중' : '  오답').padEnd(9)} ${String(s.score).padStart(4)}  ${String(s.demo).padStart(4)}`)
}

const w = d.top[0]
console.log(`\n══════ 선정: 시드 ${w.seed} ${w.inPool ? '(사전 검증 풀 ● — 시작 대기 0초)' : '(풀 밖 ○ — 생성 재시도가 붙을 수 있다)'} ══════`)
console.log(`  ${w.title} · ${w.venue} · 피해자 ${w.victim}`)
console.log(`  범행 ${w.crime} · 진범 ${w.culprit} · 동기 ${w.motive} · 수단 ${w.methodText}`)
console.log(`  결정적 증거 ${w.decisiveEvidence}`)
console.log(`  근거: 첫 모순 ${w.firstContradictionAt}회차 · ★반응 ${w.reactions}회(첫 반응 ${w.firstReactionAt}회차) · 결정적 증거 ${w.decisive ? '적중' : '오답'}`)
console.log(`        시연 길이 ${w.demoActions}회에서 결정적 증거 확보 → 여기서 제출하면 만점. 봇은 예산이 남아 ${w.actions}회까지 더 팜(점수 ${w.score})`)
console.log(`\n  [용의자]`)
for (const s of w.suspects) console.log(`    ${s}`)
console.log(`\n  [처음부터 열 수 있는 기록]`)
for (const m of w.menu) console.log(`    ${m}`)
console.log(`\n  [잠긴 기록]`)
for (const l of w.locked) console.log(`    ${l}`)
console.log(`\n  [상식 봇이 실제로 밟은 순서 — 시연 대본의 뼈대]`)
w.steps.forEach((s, i) => console.log(`    ${String(i + 1).padStart(2)}. ${s}`))
console.log(`\n  → docs/DEMO.md 에 이 시드로 대본을 쓴다.\n`)
