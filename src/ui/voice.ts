/**
 * 용의자 음성 — 브라우저 내장 `SpeechSynthesis`.
 *
 * ## 왜 서버 TTS 가 아닌가
 * `api.ts` 는 비스트리밍(`await res.json()`)이라 대사 전문이 도착한 **뒤에야** 텍스트가 생긴다.
 * 여기에 서버 TTS 를 직렬로 붙이면 `LLM 완료(p95 3.5s) + TTS 첫소리(0.8~3.8s)` 가 되어
 * "응답 2초" 선이 바로 무너진다. 내장 합성은 그 추가분이 **1~17ms**(실측)다.
 * 덤으로 신규 키·엔드포인트가 0이고, 시연 중 API 장애 리스크가 통째로 사라진다.
 *
 * ## ⚠️ 실측으로 밟은 지뢰 둘
 * ① **macOS 의 ko-KR 음성 9개 중 실제로 말하는 건 `Yuna` 하나뿐이다.**
 *    나머지 8개(Eddy/Flo/Grandma/Grandpa/Reed/Rocko/Sandy/Shelley)는 목록에는 뜨지만
 *    `boundary` 이벤트 1회 후 무음이다. `lang` 으로 필터해 아무거나 고르면 8/9 확률로 무음이다.
 * ② **Chrome 은 발화 15초를 넘기면 조용히 끊는다.** 7.26자/초 × 120자 = 16.5초로 정확히 걸린다.
 *    그래서 문장 단위로 쪼개 큐에 넣는다.
 *
 * 목소리가 하나뿐이라 다섯 명이 같은 성대를 쓴다. 페르소나별 `rate`/`pitch` 오프셋으로
 * 최대한 갈라 놓지만 완전히 해결되지는 않는다 — 그건 이 선택의 대가다.
 */

import { isMuted } from './sound'
import type { PersonaReply } from '../engine/prompt'

/** 이 순서로 찾는다. macOS=Yuna, Windows=Heami, Chrome 내장=Google 한국의 */
const PREFERRED = ['Yuna', 'Microsoft Heami', 'Google 한국의']

let voice: SpeechSynthesisVoice | null = null
let ready = false

export const canSpeak = (): boolean => ready && voice !== null

/**
 * 브리핑에서 1회 호출한다. 음성 목록을 확보하고 엔진을 예열한다.
 * 콜드스타트가 ~800ms 라 예열하지 않으면 **첫 심문에서만** 소리가 늦게 나온다.
 */
export async function initVoice(): Promise<boolean> {
  if (typeof speechSynthesis === 'undefined') return false

  // 음성 목록은 비동기다 — 첫 호출은 빈 배열일 수 있다
  const list = await new Promise<SpeechSynthesisVoice[]>((res) => {
    const now = speechSynthesis.getVoices()
    if (now.length) return res(now)
    const t = setTimeout(() => res(speechSynthesis.getVoices()), 2000)
    speechSynthesis.onvoiceschanged = () => {
      clearTimeout(t)
      res(speechSynthesis.getVoices())
    }
  })

  const ko = list.filter((v) => v.lang?.toLowerCase().startsWith('ko'))
  voice = PREFERRED.map((n) => ko.find((v) => v.name.startsWith(n))).find(Boolean) ?? null
  // 윈도우에 한국어 언어팩이 없으면 ko 가 0개다. 조용히 포기하고 게임은 그대로 간다.
  if (!voice) return false

  const warm = new SpeechSynthesisUtterance(' ')
  warm.voice = voice
  warm.volume = 0
  speechSynthesis.speak(warm)
  ready = true
  return true
}

/** 페르소나별 음색 — 목소리가 하나뿐이라 이걸로 다섯 명을 구분한다. */
const TIMBRE: Record<string, { rate: number; pitch: number }> = {
  authoritative: { rate: 0.95, pitch: 0.85 },
  timid: { rate: 1.15, pitch: 1.25 },
  calculating: { rate: 1.0, pitch: 0.95 },
  emotional: { rate: 1.2, pitch: 1.15 },
  loyal: { rate: 1.05, pitch: 1.0 },
  egocentric: { rate: 1.1, pitch: 0.9 },
  guilty: { rate: 0.9, pitch: 1.05 },
  cynical: { rate: 1.0, pitch: 0.8 },
}

/** tell → 연기. 긴장·회피가 속도와 높이로 드러난다. */
const TELL: Record<PersonaReply['tell'], { rate: number; pitch: number }> = {
  none: { rate: 1.0, pitch: 1.0 },
  gaze: { rate: 0.92, pitch: 0.98 },
  pause: { rate: 0.85, pitch: 0.95 },
  stammer: { rate: 1.18, pitch: 1.08 },
  anger: { rate: 1.12, pitch: 0.88 },
}

const clamp = (n: number): number => Math.min(2, Math.max(0.5, n))

/** Chrome 15초 컷오프를 피한다. 문장 경계로 쪼개면 각 발화가 짧아진다. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s*/)
    .flatMap((s) => (s.length > 60 ? s.split(/(?<=[,、·])\s*/) : [s]))
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 대사를 읽는다.
 * @param onBoundary 글자 인덱스를 준다 — 타이핑 연출을 목소리에 물릴 수 있다.
 */
export function speak(
  reply: PersonaReply,
  personaId: string,
  onBoundary?: (charIndex: number) => void,
): void {
  if (isMuted() || !voice) return
  speechSynthesis.cancel() // 이전 용의자 대사를 끊는다

  const t = TIMBRE[personaId] ?? { rate: 1, pitch: 1 }
  const e = TELL[reply.tell] ?? TELL.none
  let offset = 0

  for (const s of sentences(reply.speech)) {
    const u = new SpeechSynthesisUtterance(s)
    const base = offset
    u.voice = voice
    u.lang = 'ko-KR'
    u.rate = clamp(t.rate * e.rate)
    u.pitch = clamp(t.pitch * e.pitch)
    if (onBoundary) u.onboundary = (ev) => onBoundary(base + ev.charIndex)
    speechSynthesis.speak(u) // 큐가 순서를 보장한다
    offset += s.length + 1
  }
}

export function stop(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}
