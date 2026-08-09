/**
 * 모델을 **바꾸기 전에 재본다.**
 *
 * 이 게임에서 모델 교체의 위험은 속도가 아니라 **검증 통과율**이다.
 * `verifyReply()` 가 떨어뜨린 대사는 폴백으로 나가고, 폴백은 조사 횟수를 소모하지
 * 않지만 **그 판의 재미를 깎는다.** 그래서 지연과 통과율을 같이 잰다.
 *
 * 진짜 프롬프트(`buildPersonaPrefix`/`buildTurn`)와 진짜 검증기(`verifyReply`)를 쓴다 —
 * 흉내낸 프롬프트로 재면 아무것도 알 수 없다.
 *
 * 네트워크를 타고 크레딧을 쓴다. 빌드·테스트에 걸지 않고 손으로만 돌린다.
 *
 *   npx vite-node scripts/bench-model.ts
 *   MODELS=gpt-4o,gpt-4o-mini npx vite-node scripts/bench-model.ts
 *
 * 실측 (2026-08-09, 시드 36·77 × 용의자 3명 × 질문 5개 = 30턴, 2회 반복):
 *
 * | 모델 | 1회차 | 2회차 | 중앙값 |
 * |---|---|---|---|
 * | **gpt-4o** | 30/30 | **30/30** | 1341~1399ms |
 * | gpt-4o-mini | 30/30 | **28/30** (unknown-fact 2) | 1484~1660ms |
 * | gpt-5.6-terra | 30/30 | 30/30 | 1708~1756ms |
 *
 * **한 번 돌려서는 안 갈린다.** mini 는 1회차에 100% 였다가 2회차에 없는 사실을 두 번 지어냈다.
 * 이 게임에서 그건 폴백 두 번이고, 폴백은 그 판의 재미를 깎는다.
 * 모델을 고를 때 **한 번의 통과를 근거로 삼지 마라** — 이 프로젝트가 여기서 배운 것이다.
 */
import { readFileSync } from 'node:fs'
import { generateValidCase } from '../src/engine/validate'
import { buildPersonaPrefix, buildTurn, RESPONSE_SCHEMA } from '../src/engine/prompt'
import { verifyReply } from '../src/engine/verify'
import { SUSPECTS } from '../src/types'

const key = readFileSync('.dev.vars','utf8').match(/^OPENAI_API_KEY=(.+)$/m)![1].trim()
const reasoning = (m: string) => /^(gpt-5|o[134])/.test(m)

const QUESTIONS = [
  '사건 시간에 어디 계셨습니까?',
  '피해자와 어떤 관계였습니까?',
  '그 시간에 본 사람이 있습니까?',
  '1204호에 가신 적 있습니까?',
  '카드키를 가지고 계셨습니까?',
]

async function run(model: string) {
  let ok = 0, fail = 0
  const times: number[] = []
  const reasons: string[] = []
  for (const seed of [36, 77]) {
    const c = generateValidCase(seed).case
    for (const s of SUSPECTS.slice(0, 3)) {
      const prefix = buildPersonaPrefix(c, s, c.suspects[s].personaId)
      for (const q of QUESTIONS) {
        const turn = buildTurn({ question: q, pressure: 0, history: [] })
        const t = Date.now()
        const r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, max_output_tokens: 250,
            ...(reasoning(model) ? { reasoning: { effort: 'none' } } : {}),
            prompt_cache_key: `bench-${seed}-${s}`,
            input: [{ role: 'developer', content: prefix }, { role: 'user', content: turn }],
            text: { format: { type: 'json_schema', name: 'persona_reply', strict: true, schema: RESPONSE_SCHEMA } },
          }),
        })
        times.push(Date.now() - t)
        const j: any = await r.json().catch(() => null)
        const txt = j?.output?.flatMap((o: any) => o.content || []).map((cc: any) => cc.text).filter(Boolean)[0]
        if (!txt) { fail++; reasons.push(`http ${r.status} ${j?.error?.message?.slice(0,60) ?? ''}`); continue }
        let parsed: unknown
        try { parsed = JSON.parse(txt) } catch { fail++; reasons.push('json 파싱 실패'); continue }
        const v = verifyReply(parsed, c, s)
        if (v.ok) ok++
        else { fail++; reasons.push(`${(v as any).reason}`) }
      }
    }
  }
  times.sort((a, b) => a - b)
  const cnt: Record<string, number> = {}
  for (const r of reasons) cnt[r] = (cnt[r] ?? 0) + 1
  console.log(JSON.stringify({
    model, 통과: ok, 실패: fail, 통과율: `${Math.round(ok / (ok + fail) * 100)}%`,
    중앙값ms: times[Math.floor(times.length / 2)], 최대ms: times[times.length - 1],
    실패사유: cnt,
  }))
}

for (const m of (process.env.MODELS ?? 'gpt-4o-mini,gpt-4o,gpt-5.6-terra').split(',')) await run(m)
