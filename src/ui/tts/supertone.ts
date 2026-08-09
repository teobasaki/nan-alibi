/**
 * Supertone 음성 — **예산 안에 못 오면 포기한다.**
 *
 * ## 기존 결정을 뒤집지 않는다
 * `voice.ts` 머리말은 서버 TTS 를 이미 한 번 기각했다. 이유는 지연이었다 —
 * 비스트리밍 LLM(p95 3.5초) 뒤에 TTS 를 **직렬로** 붙이면 "응답 2초" 선이 무너진다.
 * 그 판단은 지금도 옳다. 그래서 여기서는 규칙을 하나 더 얹는다:
 *
 * > **예산(`BUDGET_MS`) 안에 첫 오디오가 오지 않으면 즉시 내장 합성으로 넘긴다.**
 *
 * 이러면 좋을 때는 좋은 목소리를 쓰고, 나쁠 때도 지연 상한은 예산으로 고정된다.
 * LLM 이 쓰는 폴백 3층과 같은 문법이다 — 품질은 최선을, 실패는 조용히.
 *
 * ## 왜 시도조차 안 할 때가 있나
 * `no_key` 를 한 번 받으면 그 세션 내내 다시 묻지 않는다. 키가 없는 배포에서
 * 심문마다 실패 요청을 보내면 매번 예산만큼 늦어질 뿐 얻는 게 없다.
 */

import { castOf, emotionOf, scaleByPressure, styleFor, type Tell } from './emotion'
import { settings } from '../settings'

/**
 * 합성 상한. **실측 2.3~2.6초** (배포본 3회: 2.62 / 2.32 / 2.30).
 *
 * 처음에 1.5초로 잡았다가 **매번 잘렸다** — 그런데 내장 합성이 대신 소리를 내니까
 * 겉보기에는 동작하는 것처럼 보였다. "소리가 난다" 와 "의도한 소리가 난다" 는 다르다.
 * 이런 실패는 조용해서 더 위험하다.
 *
 * 예산을 늘리되, **기다리는 동안 화면을 멈추지 않는다** — 자막은 즉시 뜨고
 * 소리만 나중에 얹힌다(아래 `speak` 의 두 단계 구조). 그래서 "응답 2초" 선은
 * 여전히 지켜진다. 지연되는 것은 음성뿐이고, 음성은 편의 기능이다.
 */
const BUDGET_MS = 4000

/** 이 세션에서 서버 TTS 를 아예 쓸 수 없다고 판명됐는가 */
let disabled = false

/**
 * 배포에 키가 있는지만 확인한다. **스타일은 이제 배역표(`emotion.ts`)가 안다** —
 * 목소리마다 쓸 수 있는 감정을 코드에 박아뒀으므로 매번 물어볼 이유가 없다.
 * 여기서 확인하는 것은 "쓸 수 있는가" 하나뿐이다.
 */
export async function probeKey(): Promise<void> {
  try {
    const r = await fetch('/api/tts')
    const j = await r.json()
    if (j?.reason === 'no_key' || (Array.isArray(j?.voices) && j.voices.length === 0)) disable()
  } catch {
    // 못 물어봐도 합성은 시도한다 — 실패하면 그때 폴백한다
  }
}

export const isDisabled = (): boolean => disabled

/** 배포에 키가 없으면 조용히 꺼진다 — 화면에는 아무 일도 일어나지 않는다 */
export function disable(): void {
  disabled = true
}

/**
 * **다시 시도해도 소용없는 실패인가.**
 *
 * 처음엔 `no_key` 만 영구 실패로 봤는데, 배포에서 실제로 돌려보니 잘못된 키는
 * `upstream_403` 으로 온다 — 영구 실패인데 매 심문마다 다시 물었다.
 * 예산이 1.5초라 **심문할 때마다 1.5초씩 그냥 버리고 있었다.**
 *
 * 4xx 는 우리가 뭔가 잘못 보낸 것이라 재시도로 풀리지 않는다(설정·인증·요청 형식).
 * 5xx·timeout·network 는 상류의 일시적 문제일 수 있으므로 계속 시도한다.
 */
export function isPermanent(reason: unknown): boolean {
  if (reason === 'no_key') return true
  if (typeof reason !== 'string') return false
  const m = /^upstream_(\d{3})$/.exec(reason)
  return m ? Number(m[1]) >= 400 && Number(m[1]) < 500 : false
}

export interface SynthResult {
  audio: ArrayBuffer
}

/**
 * 대사 한 덩어리를 합성한다.
 * 실패·지연·키 없음은 전부 `null` 이다 — 호출부는 한 가지만 처리하면 된다.
 */
export async function synthesize(
  text: string,
  tell: Tell,
  pressure: number,
  personaId: string,
): Promise<SynthResult | null> {
  if (disabled || !text.trim()) return null

  const e = scaleByPressure(emotionOf(tell), pressure, settings().intensity)
  // **인물마다 다른 목소리, 그 목소리가 실제로 가진 감정.**
  // 배역표가 각 목소리의 스타일을 들고 있으므로 없는 이름이 나갈 수 없다.
  const cast = castOf(personaId)
  const style = styleFor(personaId, tell)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), BUDGET_MS)

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style, intensity: e.intensity, voice: cast.voice }),
      signal: ctl.signal,
    })

    // 프록시가 JSON 을 주면 그건 오디오가 아니라 폴백 통보다
    const type = res.headers.get('Content-Type') ?? ''
    if (!res.ok || type.includes('application/json')) {
      const body = await res.json().catch(() => ({ reason: 'unknown' }))
      if (isPermanent(body?.reason)) disable()
      return null
    }

    const audio = await res.arrayBuffer()
    return audio.byteLength ? { audio } : null
  } catch {
    // 예산 초과(AbortError) 도 여기로 온다. 한 번 늦었다고 끄지는 않는다 —
    // 일시적 지연과 영구적 부재는 다르게 다뤄야 한다.
    return null
  } finally {
    clearTimeout(timer)
  }
}

let el: HTMLAudioElement | null = null

/** 합성된 오디오를 재생한다. 이전 대사는 끊는다 — 두 용의자가 겹쳐 말하면 안 된다. */
export function play(audio: ArrayBuffer, onEnd?: () => void): void {
  stop()
  const url = URL.createObjectURL(new Blob([audio]))
  el = new Audio(url)
  const done = (): void => {
    URL.revokeObjectURL(url)   // 안 풀면 심문마다 blob 이 쌓인다
    onEnd?.()
  }
  el.onended = done
  el.onerror = done
  void el.play().catch(done)
}

export function stop(): void {
  if (!el) return
  el.pause()
  el.onended = null
  el.onerror = null
  el = null
}
