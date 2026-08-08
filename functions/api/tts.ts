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

/** 상류가 느리면 게임이 그만큼 멈춘다. 여기서 끊고 클라이언트가 내장 합성으로 넘어가게 한다. */
const UPSTREAM_TIMEOUT_MS = 3000

const fallback = (reason: string, status = 200): Response =>
  Response.json({ fallback: true, reason }, { status })

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

    if (!up.ok) return fallback(`upstream_${up.status}`)

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
