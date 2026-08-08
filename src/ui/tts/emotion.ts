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
 */
const EMOTION: Record<Tell, Emotion> = {
  none: { style: 'neutral', intensity: 0.2, pauseMs: 90 },
  gaze: { style: 'sad', intensity: 0.35, pauseMs: 160 },
  pause: { style: 'neutral', intensity: 0.25, pauseMs: 420 },
  stammer: { style: 'fear', intensity: 0.6, pauseMs: 120 },
  anger: { style: 'angry', intensity: 0.7, pauseMs: 70 },
}

export const prosodyOf = (tell: Tell): Prosody => PROSODY[tell] ?? PROSODY.none
export const emotionOf = (tell: Tell): Emotion => EMOTION[tell] ?? EMOTION.none

/**
 * 압박이 높으면 연기를 키운다. 같은 `tell` 이라도 3회차 심문의 더듬음이 더 심해야 한다.
 * 상한을 두는 이유는, 1.0 을 넘기면 어느 공급자에서든 연기가 아니라 소음이 되기 때문이다.
 */
export function scaleByPressure(e: Emotion, pressure: number): Emotion {
  const p = Math.min(100, Math.max(0, pressure)) / 100
  return { ...e, intensity: Math.min(1, e.intensity + p * 0.3) }
}
