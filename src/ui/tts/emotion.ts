/**
 * `tell` → 연기 지시. **순수 함수만 둔다 — 그래서 브라우저 없이 테스트된다.**
 *
 * ## 왜 새 신호를 만들지 않았나
 * LLM 은 이미 매 응답에 `tell`(동요 신호: 시선 회피·말 끊김·더듬음·언성)을 뱉는다.
 * 화면은 그걸 자막 밑 한 줄로만 쓰고 있었다. **있는 신호를 음성으로 흘려보내면**
 * 새 모델도 새 프롬프트도 필요 없이 연기가 붙는다.
 *
 * ## 왜 두 벌인가
 * 내장 합성(`SpeechSynthesis`)은 `rate`/`pitch` 두 손잡이뿐이고,
 * Supertone 은 감정 이름과 강도를 받는다. **같은 `tell` 을 각자의 언어로 번역**한다.
 * 공급자가 늘어도 이 파일만 늘고 호출부는 그대로다.
 */

import type { PersonaReply } from '../../engine/prompt'

export type Tell = PersonaReply['tell']

/** 내장 합성용 — 곱해서 쓴다 (페르소나 음색 × 이 값) */
export interface Prosody {
  rate: number
  pitch: number
}

/** Supertone 용 — 감정 이름과 세기 */
export interface Emotion {
  /** Supertone 이 받는 스타일 이름 */
  style: string
  /** 그 목소리가 주 스타일을 못 쓸 때 내려갈 곳 */
  fallback: string
  /** 0~1. 클수록 과장된다 */
  intensity: number
  /** 문장 사이 쉼(ms). 말이 끊기는 연기는 값보다 침묵이 만든다 */
  pauseMs: number
}

const PROSODY: Record<Tell, Prosody> = {
  none: { rate: 1.0, pitch: 1.0 },
  gaze: { rate: 0.92, pitch: 0.98 },
  pause: { rate: 0.85, pitch: 0.95 },
  stammer: { rate: 1.18, pitch: 1.08 },
  anger: { rate: 1.12, pitch: 0.88 },
}

/**
 * `pause` 의 침묵이 가장 길다 — 이 tell 은 "말을 멈췄다" 가 본체라서
 * 속도를 늦추는 것만으로는 안 들린다. 실제로 쉬어야 들린다.
 *
 * ## 스타일 이름을 지어내지 않는다
 * 처음에 `stammer` 를 `fear` 로 보냈다가 403 을 받았다 — **Supertone 에 `fear`
 * 라는 스타일은 없다.** 계정이 쓸 수 있는 20개 목소리를 전부 조회해 실제 어휘를
 * 세어보니 neutral(20) · happy(14) · angry(13) · sad(13) 이 주축이고,
 * `anxious` 는 Alphonse 한 목소리에만 있다.
 *
 * 그래서 **주 스타일과 대체 스타일을 함께 적는다.** 고른 목소리가 주 스타일을
 * 못 쓰면 대체로 내려가고, 그것도 없으면 `neutral` 이다 — 목소리를 바꿔도 안 깨진다.
 */
const EMOTION: Record<Tell, Emotion> = {
  none: { style: 'neutral', fallback: 'neutral', intensity: 0.2, pauseMs: 90 },
  gaze: { style: 'sad', fallback: 'neutral', intensity: 0.35, pauseMs: 160 },
  pause: { style: 'neutral', fallback: 'neutral', intensity: 0.25, pauseMs: 420 },
  // 더듬음 = 불안. `anxious` 가 있는 목소리면 그것, 없으면 슬픔으로 내려간다.
  stammer: { style: 'anxious', fallback: 'sad', intensity: 0.6, pauseMs: 120 },
  anger: { style: 'angry', fallback: 'neutral', intensity: 0.7, pauseMs: 70 },
}

/** 목소리가 실제로 지원하는 스타일로 낮춘다. 없는 이름을 보내면 상류가 거절한다. */
export function resolveStyle(e: Emotion, supported: readonly string[]): string {
  if (supported.length === 0) return e.style           // 목록을 못 받았으면 그대로 시도
  if (supported.includes(e.style)) return e.style
  if (supported.includes(e.fallback)) return e.fallback
  return supported.includes('neutral') ? 'neutral' : supported[0]!
}

export const prosodyOf = (tell: Tell): Prosody => PROSODY[tell] ?? PROSODY.none
export const emotionOf = (tell: Tell): Emotion => EMOTION[tell] ?? EMOTION.none

/**
 * 압박이 높으면 연기를 키운다. 같은 `tell` 이라도 3회차 심문의 더듬음이 더 심해야 한다.
 * 상한을 두는 이유는, 1.0 을 넘기면 어느 공급자에서든 연기가 아니라 소음이 되기 때문이다.
 */
export function scaleByPressure(e: Emotion, pressure: number, gain = 1): Emotion {
  const p = Math.min(100, Math.max(0, pressure)) / 100
  const g = Number.isFinite(gain) ? Math.min(1.5, Math.max(0, gain)) : 1
  return { ...e, intensity: Math.min(1, (e.intensity + p * 0.3) * g) }
}
