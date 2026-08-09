/**
 * Supertone TTS 프록시 — **키는 서버에만 있다.**
 *
 * ## 왜 프록시인가
 * 브라우저에서 직접 호출하면 키가 네트워크 탭에 그대로 뜬다.
 * `interrogate.ts` 와 같은 이유·같은 구조다.
 *
 * ## 키가 없으면 게임이 멈추지 않는다
 * `interrogate` 와 같은 폴백 규약을 쓴다 — 키가 없거나 상류가 죽으면
 * `{ fallback: true, reason }` 을 주고, 클라이언트는 브라우저 내장 합성으로 돌아간다.
 * **음성은 편의 기능이므로 실패가 게임을 막아선 안 된다.**
 */

interface Env {
  SUPERTONE_API_KEY?: string
  /** 목소리 id 는 계정마다 다르므로 환경변수로 뺀다 */
  SUPERTONE_VOICE_ID?: string
}

interface Body {
  text: string
  /** emotion.ts 가 만든 값 */
  style?: string
  intensity?: number
}

const UPSTREAM = 'https://supertoneapi.com/v1/text-to-speech'

/**
 * 상류 상한. **실측 2.3~2.6초** (배포본 3회: 2.62 / 2.32 / 2.30).
 * 3초로 두면 여유가 0.4초뿐이라 조금만 느려도 잘린다 — 클라이언트 예산(4초)보다
 * 안쪽에 두되 실측 위로 넉넉히 잡는다. 자막은 이미 떠 있으므로 이 대기는 화면을 안 멈춘다.
 */
const UPSTREAM_TIMEOUT_MS = 3800

const fallback = (reason: string, status = 200): Response =>
  Response.json({ fallback: true, reason }, { status })

/**
 * 이 계정이 **실제로 쓸 수 있는** 한국어 목소리 목록.
 *
 * 왜 필요했나: `voice_id` 를 'default' 로 박아두고 403 을 받았다. 상류 메시지가
 * *"Insufficient permissions to use this voice"* 였다 — 키는 멀쩡했고 목소리가 없는
 * 이름이었다. **쓸 수 있는 것을 물어보지 않고 이름을 지어낸 것**이 원인이다.
 * 목록을 받아 고르게 하면 그 실수가 구조적으로 불가능해진다.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.SUPERTONE_API_KEY) return Response.json({ voices: [], reason: 'no_key' })
  try {
    const r = await fetch('https://supertoneapi.com/v1/voices/search?language=ko&page_size=20', {
      headers: { 'x-sup-api-key': env.SUPERTONE_API_KEY },
    })
    const body = await r.text()
    if (!r.ok) return Response.json({ voices: [], reason: `upstream_${r.status}`, detail: body.slice(0, 300) })
    const j = JSON.parse(body)
    const items = (j.items ?? j.voices ?? j.data ?? []) as Record<string, unknown>[]
    return Response.json({
      voices: items.map((v) => ({
        id: v.voice_id ?? v.id,
        name: v.name,
        // 감정 스타일은 목소리마다 다르다 — 없는 스타일을 보내면 또 400 이 온다
        styles: v.styles ?? v.available_styles ?? [],
      })),
    })
  } catch (e) {
    return Response.json({ voices: [], reason: 'network', detail: String(e).slice(0, 200) })
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPERTONE_API_KEY) return fallback('no_key')

  let body: Body
  try {
    body = await request.json()
  } catch {
    return fallback('bad_json', 400)
  }

  const text = (body.text ?? '').trim()
  if (!text) return fallback('empty', 400)
  // 대사는 길어야 두어 문장이다. 상한을 두지 않으면 요금이 입력에 비례해 샌다.
  if (text.length > 400) return fallback('too_long', 400)

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const voice = env.SUPERTONE_VOICE_ID ?? 'default'
    const up = await fetch(`${UPSTREAM}/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: {
        'x-sup-api-key': env.SUPERTONE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        language: 'ko',
        style: body.style ?? 'neutral',
        model: 'sona_speech_1',
        voice_settings: {
          // 0~1 범위를 벗어난 값이 오면 상류가 400 을 준다. 여기서 잘라 둔다.
          pitch_shift: 0,
          pitch_variance: Math.min(1, Math.max(0, body.intensity ?? 0.2)),
          speed: 1,
        },
      }),
      signal: ctl.signal,
    })

    if (!up.ok) {
      /**
       * **상류가 왜 거절했는지를 버리지 않는다.**
       * 처음엔 상태 코드만 돌려줬는데, 그러면 403 이 "키가 틀렸다" 인지
       * "요청 형식이 틀렸다" 인지 알 수 없어 고칠 수가 없었다.
       * 본문 앞부분만 싣는다 — 키는 요청에만 있고 응답에는 없다.
       */
      const detail = (await up.text().catch(() => '')).slice(0, 300)
      return Response.json({ fallback: true, reason: `upstream_${up.status}`, detail })
    }

    const audio = await up.arrayBuffer()
    if (audio.byteLength === 0) return fallback('empty_audio')

    return new Response(audio, {
      headers: {
        'Content-Type': up.headers.get('Content-Type') ?? 'audio/wav',
        // 같은 대사를 다시 들을 일이 있다 (되감기·재시청). 짧게 캐시한다.
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (e) {
    return fallback(e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
}
