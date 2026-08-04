#!/usr/bin/env node
/**
 * 페르소나 감사 — 완료기준 C6.
 *
 * "8종의 페르소나 카드가 실제 출력에 나타나는가" 를 라이브 엔드포인트로 확인한다.
 *
 * CI 에 넣지 않는 이유: 실제 LLM 을 호출하므로 느리고 비용이 들며, 결과가 결정론이 아니다.
 * self-check 의 브라우저 육안 검증과 같은 자리 — 사람이 의도적으로 돌리는 검사다.
 *
 * `dialogue` 스킬의 voice-check.ts 를 쓰지 않는 이유:
 *   그 도구는 영어 전용이다. 한국어에서 contraction·fragment·question 비율이 전부 무의미하고
 *   "22:30" 을 단어로 토큰화한다. 수치가 나오긴 하지만 그 수치가 무엇도 의미하지 않는다.
 *   대신 **각 페르소나의 tic(버릇)이 출력에 실제로 나타나는가** 를 본다 — 이건 한국어에서도 의미가 있다.
 *
 * 사용법:
 *   node scripts/persona-audit.mjs [엔드포인트]
 */

const ENDPOINT = process.argv[2] ?? 'https://nan-alibi.pages.dev/api/interrogate'
const SEED = 9300
const QUESTION = '그 시간에 정말 혼자 계셨습니까?'

/** 각 페르소나가 냈어야 할 흔적 — 하나라도 걸리면 카드가 작동한 것 */
const SIGNATURES = {
  authoritative: ['왜', '묻', '답하지', '없습니다', '그 이상'],
  timid: ['저기', '그러니까', '죄송', '잘 기억', '…'],
  calculating: ['기록', '확인', '없습니까', '증거'],
  emotional: ['!', '탐정님', '왜 ', '그걸'],
  loyal: ['제가 아는 한', '아는 한', '드릴 말씀'],
  egocentric: ['제가 본', '내가 본', '분명'],
  guilty: ['…', '모르', '기억'],
  cynical: ['좋은 질문', '정말로', '글쎄'],
}

const bigrams = (s) => {
  const t = s.replace(/[^가-힣a-zA-Z0-9]/g, '')
  return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)))
}
const jaccard = (a, b) => {
  const A = bigrams(a), B = bigrams(b)
  const inter = [...A].filter((x) => B.has(x)).length
  const uni = new Set([...A, ...B]).size
  return uni ? inter / uni : 0
}

const results = []
for (const persona of Object.keys(SIGNATURES)) {
  const t0 = Date.now()
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: SEED, suspectId: 'S1', personaId: persona, question: QUESTION, pressure: 45 }),
  })
  const d = await res.json()
  const speech = d.reply?.speech ?? ''
  const hit = SIGNATURES[persona].filter((sig) => speech.includes(sig))
  results.push({ persona, speech, hit, fallback: Boolean(d.fallback), ms: Date.now() - t0 })
}

console.log('\n=== 페르소나 감사 (완료기준 C6) ===\n')
let pass = 0
for (const r of results) {
  const mark = r.fallback ? '폴백' : r.hit.length ? ' OK ' : 'FAIL'
  if (!r.fallback && r.hit.length) pass++
  console.log(`[${mark}] ${r.persona.padEnd(14)} ${String(r.ms).padStart(5)}ms  버릇 ${r.hit.length}건 ${r.hit.length ? `(${r.hit.join('/')})` : ''}`)
  console.log(`       ${r.speech}`)
}

// 쌍별 유사도 — 두 인물의 말이 겹치면 페르소나가 하나로 수렴한 것이다
let worst = { pair: '', v: 0 }
for (let i = 0; i < results.length; i++) {
  for (let j = i + 1; j < results.length; j++) {
    const v = jaccard(results[i].speech, results[j].speech)
    if (v > worst.v) worst = { pair: `${results[i].persona} ↔ ${results[j].persona}`, v }
  }
}

console.log(`\n버릇 검출: ${pass}/${results.length}`)
console.log(`최대 문자 2-gram 유사도: ${(worst.v * 100).toFixed(1)}%  (${worst.pair})`)
console.log(`판정: ${pass >= 7 && worst.v < 0.55 ? '✅ 통과' : '❌ 실패 — 페르소나 카드 4요소를 다시 채워라'}\n`)

process.exit(pass >= 7 && worst.v < 0.55 ? 0 : 1)
