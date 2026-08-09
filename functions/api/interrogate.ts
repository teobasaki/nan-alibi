/**
 * FIVE ALIBIS — 심문 프록시 (Cloudflare Pages Function)
 *
 * 존재 이유: API 키는 정적 자산에 절대 못 넣는다.
 * 키는 Pages Secret 에만 있고, 클라이언트는 이 엔드포인트만 본다.
 * 게임과 **같은 오리진**이므로 CORS 헤더가 필요 없다 (ADR 002).
 *
 * 사건은 **시드로부터 서버에서 재생성**한다. 클라이언트가 사건 전체를 보내지 않는 이유:
 *   보내면 진실(범인·실제 궤적)이 네트워크와 브라우저 메모리에 올라가고,
 *   개발자도구를 연 심사위원에게 정답이 그대로 노출된다.
 *   시드만 오가면 서버는 같은 사건을 결정론적으로 재현하고, 클라이언트는 볼 자격이 있는 것만 갖는다.
 *
 * 검증 실패 시 1회 재요청 → 그래도 실패하면 폴백 대사 (llm-persona-game §3 폴백 3층).
 * **폴백일 때 조사 횟수는 소모되지 않는다** — 클라이언트가 `fallback` 플래그를 보고 판정한다.
 */

import { generateValidCase } from '../../src/engine/validate'
import { buildPersonaPrefix, buildTurn, RESPONSE_SCHEMA } from '../../src/engine/prompt'
import { verifyReply, fallbackReply } from '../../src/engine/verify'
import type { SuspectId } from '../../src/types'

interface Env {
  OPENAI_API_KEY?: string
  /** 모델을 코드 배포 없이 갈아끼우기 위한 스위치. 없으면 아래 기본값. */
  OPENAI_MODEL?: string
}

interface Body {
  seed: number
  suspectId: SuspectId
  personaId: string
  question: string
  presentedEvidence?: string
  pressure?: number
  history?: { q: string; a: string }[]
}

/**
 * **모델은 한 곳에서만 정한다.** 환경변수로 덮을 수 있어 배포 없이 갈아끼운다.
 *
 * `gpt-5.6-terra` → `gpt-4o` 로 내렸다. 이유는 비용이다 —
 * 이 게임은 판당 40~50회를 호출하는데, 대사 생성에 추론이 필요 없다는 것은
 * ADR 005 가 이미 확인했다(effort=none 이 기본보다 **빠르고** 품질이 같았다).
 * 추론을 안 쓰는 작업이면 추론 모델을 쓸 이유도 없다.
 */
const MODEL = 'gpt-4o'
const MAX_OUTPUT = 250
/**
 * **`reasoning` 은 추론 모델에만 보낸다.**
 * 4o 계열에 이 필드를 보내면 400 이 난다 — 모델만 바꾸고 이 줄을 안 지우면
 * 전 판이 폴백 대사로 떨어진다. 모델명과 파라미터가 **함께** 움직여야 한다.
 *
 * 실측 (2026-08-05, terra): effort=none 1.74s · low 2.12s · 기본 2.95s (ADR 005).
 */
const REASONING_EFFORT = 'none'
const supportsReasoning = (model: string): boolean => /^(gpt-5|o[134])/.test(model)

const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status })

type CallOk = { parsed: unknown; usage: unknown }
type CallFail = { failure: string }

async function callOpenAI(
  key: string, prefix: string, turn: string, cacheKey: string, model: string,
): Promise<CallOk | CallFail> {
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_output_tokens: MAX_OUTPUT,
        ...(supportsReasoning(model) ? { reasoning: { effort: REASONING_EFFORT } } : {}),
        // 같은 인물의 프리픽스를 같은 캐시 그룹으로 묶는다.
        // 프리픽스는 판 내내 바이트 단위 고정이라 2회차부터 cached_tokens 가 붙는다.
        prompt_cache_key: cacheKey,
        input: [
          { role: 'developer', content: prefix },
          { role: 'user', content: turn },
        ],
        text: {
          format: { type: 'json_schema', name: 'persona_reply', strict: true, schema: RESPONSE_SCHEMA },
        },
      }),
    })
  } catch (e) {
    return { failure: `network: ${String(e)}` }
  }

  if (!res.ok) return { failure: `openai ${res.status}` }

  const data = (await res.json().catch(() => null)) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[]
    usage?: unknown
  } | null
  if (!data) return { failure: 'response not json' }

  const text = data.output?.find((o) => o.type === 'message')?.content?.find((c) => c.type === 'output_text')?.text
  if (!text) return { failure: 'no output_text' }

  try {
    return { parsed: JSON.parse(text), usage: data.usage }
  } catch {
    return { failure: 'json parse' }
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || typeof body.seed !== 'number' || !body.suspectId || !body.personaId || !body.question) {
    return bad('seed / suspectId / personaId / question 이 필요하다')
  }
  if (body.question.length > 200) return bad('질문이 너무 길다 (200자 상한)')

  if (!env.OPENAI_API_KEY) {
    // 폴백 3층: 키 없음 → 게임은 멈추지 않고 계속 진행되어야 한다
    return Response.json({ reply: fallbackReply(body.personaId), fallback: true, reason: 'no_key' })
  }

  const c = generateValidCase(body.seed).case
  const prefix = buildPersonaPrefix(c, body.suspectId, body.personaId)
  const turn = buildTurn({
    question: body.question,
    presentedEvidence: body.presentedEvidence,
    pressure: body.pressure ?? 0,
    history: body.history ?? [],
  })
  const cacheKey = `alibi-${body.seed}-${body.suspectId}`

  // 1층: 검증 실패 시 1회 재요청
  const model = env.OPENAI_MODEL || MODEL
  const failures: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callOpenAI(env.OPENAI_API_KEY, prefix, turn, cacheKey, model)
    if ('failure' in r) {
      failures.push(r.failure)
      continue
    }
    const v = verifyReply(r.parsed, c, body.suspectId)
    if (v.ok) {
      return Response.json({ reply: v.reply, fallback: false, attempt, usage: r.usage })
    }
    failures.push(`${v.reason}: ${v.detail}`)
  }

  // 2층: 사전 작성 회피 대사. 조사 횟수는 소모되지 않는다.
  return Response.json({
    reply: fallbackReply(body.personaId),
    fallback: true,
    reason: 'verification_failed',
    failures,
  })
}
