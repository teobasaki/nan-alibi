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
import { verifyReply, fallbackReply, extractTimes } from '../../src/engine/verify'
import { applyWorld } from '../../src/data/worlds'
import { gc001Case } from '../../src/data/gc001'
import { classify } from '../../src/engine/intent'
import { allowedResponse, renderAllowedBlock, ruleFallbackSpeech } from '../../src/engine/knowledge'
import { GC001_KNOWLEDGE } from '../../src/data/gc001-knowledge'
import { gc001Claim, gc001Fact } from '../../src/data/gc001-inquiry'
import type { ClaimState } from '../../src/engine/inquiry'
import { slotLabel, SLOTS, type SuspectId } from '../../src/types'

interface Env {
  OPENAI_API_KEY?: string
  /** 모델을 코드 배포 없이 갈아끼우기 위한 스위치. 없으면 아래 기본값. */
  OPENAI_MODEL?: string
}

interface Body {
  seed: number
  /** 월드 스킨 id — 시드만으로는 옷을 모른다. 없으면 호텔 */
  world?: string
  /** 고정 사건 id — 'gc001' 이면 생성기를 우회한다 (클라이언트와 같은 규칙) */
  caseId?: string
  suspectId: SuspectId
  personaId: string
  question: string
  presentedEvidence?: string
  pressure?: number
  history?: { q: string; a: string }[]
  /**
   * ── 조사 계층 (V0.2, gc001 전용) ──
   * **진실이 아니라 플레이어의 지식이다.** 손에 쥔 Clue id 와 진술 상태를 받아
   * 서버가 규칙 엔진을 돌려 *이 턴에 말해도 되는 범위*를 정한다 (명세 §35).
   *
   * 허용 범위를 클라이언트가 계산해 보내지 않는 이유: 그러면 무엇을 말할 수 있는지를
   * 클라이언트가 정하게 된다. 규칙은 서버(코드)가 소유한다.
   */
  heldClueIds?: string[]
  claimStates?: Record<string, ClaimState>
  presentedClueIds?: string[]
}

/**
 * **모델은 한 곳에서만 정한다.** 환경변수로 덮을 수 있어 배포 없이 갈아끼운다.
 *
 * 이력: `gpt-5.6-terra` → `gpt-4o`(비용) → `gpt-5.4-mini` 시도 → **`gpt-4o` 복귀(실측)**.
 *
 * 지연을 줄이려고 5.4-mini 로 바꿨다가 **같은 조건 실측에서 오히려 느려** 되돌렸다
 * (2026-08-10, 프로덕션 3회씩): mini 2051·3185·2624ms(중앙값 2624) vs
 * 4o 1869·2705·2066ms(중앙값 2066). 모델은 병목이 아니었다.
 *
 * 진짜 지연은 **LLM 2.0초 + 서버 TTS 2.3~2.6초**의 직렬 합이다. 자막은 이미
 * 소리를 기다리지 않으므로(`voice.ts`), 남은 레버는 출력 길이와 TTS 선택이다.
 *
 * **모델명과 `reasoning` 파라미터는 함께 움직인다** — `supportsReasoning` 이
 * `gpt-5` 접두를 보고 자동으로 붙인다. 4o 에는 안 붙는다(붙이면 400).
 */
const MODEL = 'gpt-4o'
/**
 * 대사 상한은 120자·3문장이고(프롬프트 규칙 4) 조서는 짧은 필드 다섯 개다.
 * 250 토큰은 그보다 한참 넉넉했다 — 생성 토큰 수가 곧 지연이므로 160 으로 줄인다.
 * 잘릴 위험은 검증기가 잡는다(`too-long` 은 재요청 → 폴백).
 */
const MAX_OUTPUT = 160
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


/* ─────────── 남용 방어 — **공개 URL 이고 크레딧은 유한하다** ───────────
 *
 * 이 엔드포인트는 인증이 없다. 붙이면 안 되기 때문이다 —
 * 대회·심사 규정이 "별도 로그인 없이 플레이 가능" 을 요구하고, 로그인은 실격 사유다.
 * 그래서 **사람의 플레이는 막지 않으면서 스크립트만 걸러내는** 두 겹을 둔다.
 *
 * ① Origin — 우리 페이지에서 온 요청만 받는다. 헤더 위조가 가능하므로 완벽하지 않지만,
 *    URL 을 복사해 curl 로 때리는 가장 흔한 경로를 막는다.
 * ② 토큰 버킷 — IP 당 분당 상한. Worker 아이솔레이트 메모리라 전역 정확도는 없다.
 *    그래도 한 아이솔레이트에 몰리는 연타는 잡힌다. KV 없이 오늘 넣을 수 있는 최선이다.
 *
 * **막았을 때 조용히 폴백하지 않는다.** `reason` 을 실어 보내 화면이 정직하게 말하게 한다 —
 * 크레딧이 죽었는데 페르소나가 회피 대사만 하면 플레이어는 "AI 가 형편없다" 고 읽는다.
 */
const ALLOW_HOSTS = [/\.nan-alibi\.pages\.dev$/, /^nan-alibi\.pages\.dev$/, /^localhost(:\d+)?$/, /^127\.0\.0\.1(:\d+)?$/]

function originOk(request: Request): boolean {
  const o = request.headers.get('Origin') ?? request.headers.get('Referer')
  if (!o) return false                       // 브라우저는 항상 붙인다. 없으면 브라우저가 아니다
  try {
    const h = new URL(o).host
    return ALLOW_HOSTS.some((re) => re.test(h))
  } catch { return false }
}

/** IP 당 분당 상한 — 한 판이 40~50턴이므로 사람은 절대 안 걸린다 */
const RATE_PER_MIN = 20
const buckets = new Map<string, { n: number; at: number }>()

function rateOk(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || now - b.at > 60_000) { buckets.set(ip, { n: 1, at: now }); return true }
  if (b.n >= RATE_PER_MIN) return false
  b.n += 1
  return true
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || typeof body.seed !== 'number' || !body.suspectId || !body.personaId || !body.question) {
    return bad('seed / suspectId / personaId / question 이 필요하다')
  }
  if (body.question.length > 200) return bad('질문이 너무 길다 (200자 상한)')

  // ⚠️ 키 없음 판정은 사건을 재구성한 **뒤**로 내렸다 — 규칙 기반 폴백(AC-13)이
  // 조사 계층을 필요로 하기 때문이다. 로컬 `npm run dev` 가 항상 이 경로를 탄다.

  /**
   * 사건 재구성 — **클라이언트가 보는 사건과 같은 옷**이어야 한다.
   * 시드만 재생성하면 프롬프트가 호텔 어휘(로비·1204호)로 만들어져, 갤러리·경매장
   * 화면 앞에서 페르소나가 다른 세계의 말을 한다. 고정 사건(gc001)은 생성기를 우회한다.
   * applyWorld 는 모르는 id 를 무시하므로 임의 문자열이 와도 호텔로 안전하게 떨어진다.
   */
  const c = body.caseId === 'gc001'
    ? gc001Case()
    : applyWorld(generateValidCase(body.seed).case, body.world)
  const prefix = buildPersonaPrefix(c, body.suspectId, body.personaId)

  /**
   * ── 조사 계층: **질문을 읽고, 말할 수 있는 범위를 먼저 정한다** (V0.2 §35).
   *
   * `PLAYER QUESTION → INTENT → RULE ENGINE → 허용 Claim/Fact → PERSONA AI`
   *
   * gc001 에만 적용한다 — 시드 사건에는 손으로 쓴 규칙 표가 없다(ADR 031).
   * 결과 블록은 **프리픽스가 아니라 턴**에 붙는다: 프리픽스는 판 내내 바이트 고정이어야
   * 프롬프트 캐시가 살아 있고, 이 블록은 매 턴 달라진다.
   */
  const inquiry = body.caseId === 'gc001'
    ? (() => {
      const names = Object.fromEntries(Object.values(c.suspects).map((s) => [s.name, s.id]))
      const intent = classify(body.question, {
        speaker: body.suspectId,
        names,
        slotLabels: SLOTS.map((t) => slotLabel(c, t)),
        presentedClueIds: body.presentedClueIds,
      })
      const allowed = allowedResponse({
        suspectId: body.suspectId,
        intent: intent.intent,
        held: body.heldClueIds ?? [],
        claimStates: body.claimStates ?? {},
        presentedClueIds: body.presentedClueIds,
        confidence: intent.confidence,
        rules: GC001_KNOWLEDGE,
      })
      return { intent, allowed }
    })()
    : null

  const look = { claim: (id: string) => gc001Claim(id)?.text, fact: (id: string) => gc001Fact(id)?.text }
  /**
   * **이 턴에 허용된 문장에 있는 시각만** 검증기에 함께 넘긴다 (V0.2).
   * 조사 계층의 사실에는 칸 밖 시각(20:40·21:04·21:11·21:15·21:30)이 있고, 그것을 말하는 것은
   * 정당하다. 그러나 목록을 통째로 열어 주지는 않는다 — 허용된 문장에 없는 시각은 여전히 유령이다.
   */
  const extraTimes = inquiry
    ? [...new Set([...inquiry.allowed.claimIds, ...inquiry.allowed.factIds]
      .map((id) => look.claim(id) ?? look.fact(id) ?? '')
      .flatMap((text) => extractTimes(text)))]
    : undefined
  const turn = [
    buildTurn({
      question: body.question,
      presentedEvidence: body.presentedEvidence,
      pressure: body.pressure ?? 0,
      history: body.history ?? [],
    }),
    inquiry ? renderAllowedBlock(inquiry.allowed, look) : '',
  ].filter(Boolean).join('\n\n')

  /**
   * 폴백 응답 — **규칙이 있으면 규칙이 말한다** (AC-13).
   * 회피 대사만 돌려주면 AI 장애 중에는 사건이 한 발도 못 나간다. 허용된 진술·사실이 있으면
   * 그 문장을 그대로 말한다 — 투박하지만 사건은 진행된다. 문장은 사건 데이터의 것이라
   * 여기서 새 사실이 생기지 않는다.
   */
  const fallback = (): ReturnType<typeof fallbackReply> => {
    const base = fallbackReply(body.personaId)
    if (!inquiry) return base
    const speech = ruleFallbackSpeech(inquiry.allowed, look)
    return speech ? { ...base, speech } : base
  }
  /** 클라이언트가 상태기계를 돌리기 위해 받아 가는 것 — 진실은 없다 */
  const inquiryOut = inquiry
    ? {
      intent: inquiry.intent.intent,
      confidence: inquiry.intent.confidence,
      time: inquiry.intent.time,
      subjectId: inquiry.intent.subjectId,
      mode: inquiry.allowed.mode,
      claimIds: inquiry.allowed.claimIds,
      factIds: inquiry.allowed.factIds,
      reaction: inquiry.allowed.reaction,
      revisionOf: inquiry.allowed.revisionOf,
    }
    : undefined

  /**
   * ── 남용 방어와 키 확인은 **사건을 재구성한 뒤**에 한다 ──
   *
   * 순서를 뒤집은 이유: 막힌 요청에도 **규칙 기반 폴백**(AC-13)과 조사 계층 결과를 실어 보내야
   * 사건이 진행된다. 예전에는 이 검사들이 맨 앞에 있어서 `fallbackReply()`(회피 대사)만 나갔고,
   * 로컬 개발에서는 그 경로가 100%였다(브리지가 Origin 헤더를 안 넘겨 전부 403 이었다).
   * 재구성 비용은 결정론 생성 1회(수 ms)다 — 정보가 나오지 않는 것보다 싸다.
   */
  if (!originOk(request)) {
    return Response.json({ reply: fallback(), fallback: true, reason: 'bad_origin', inquiry: inquiryOut }, { status: 403 })
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!rateOk(ip)) {
    return Response.json({ reply: fallback(), fallback: true, reason: 'rate_limited', inquiry: inquiryOut }, { status: 429 })
  }

  if (!env.OPENAI_API_KEY) {
    // 폴백 3층: 키 없음 → 게임은 멈추지 않는다. 규칙이 대신 말한다 (AC-13).
    return Response.json({ reply: fallback(), fallback: true, reason: 'no_key', inquiry: inquiryOut })
  }

  // 옷이 다르면 프리픽스가 다르다 — 캐시 그룹도 옷까지 포함해야 히트가 산다
  const cacheKey = `alibi-${body.caseId ?? body.world ?? 'hotel'}-${body.seed}-${body.suspectId}`

  // 1층: 검증 실패 시 1회 재요청
  const model = env.OPENAI_MODEL || MODEL
  const failures: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callOpenAI(env.OPENAI_API_KEY, prefix, turn, cacheKey, model)
    if ('failure' in r) {
      failures.push(r.failure)
      continue
    }
    const v = verifyReply(r.parsed, c, body.suspectId, extraTimes)
    if (v.ok) {
      return Response.json({ reply: v.reply, fallback: false, attempt, usage: r.usage, inquiry: inquiryOut })
    }
    failures.push(`${v.reason}: ${v.detail}`)
  }

  /**
   * 2층: 규칙이 말한다 (AC-13). **`fallback: true` 의 뜻이 바뀌었다** —
   * 예전에는 "조사 횟수를 환불한다" 는 신호였지만, 명세 §5 는 *정상 응답이면 항상 차감*,
   * *시스템 오류면 차감하지 않음* 으로 정책을 통일했다. 검증 실패 뒤의 규칙 응답은
   * **정상 응답**이므로 비용을 받는다 (AC-02). 환불 판정은 클라이언트가 `reason` 으로 한다.
   */
  return Response.json({
    reply: fallback(),
    fallback: true,
    reason: 'verification_failed',
    failures,
    inquiry: inquiryOut,
  })
}
