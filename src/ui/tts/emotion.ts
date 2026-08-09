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


/* ── 페르소나별 배역 ─────────────────────────────────────────────
 * **용의자가 아니라 페르소나에 목소리를 붙인다.**
 *
 * 용의자는 시드마다 새로 생기지만 페르소나 8종은 고정이다. 페르소나에 붙이면
 * 어느 시드에서든 "겁 많은 사람은 이렇게 들린다" 가 일정해지고, 내장 합성의
 * `TIMBRE`(voice.ts)와 같은 구조가 된다 — 두 공급자가 같은 축을 쓴다.
 *
 * 고른 근거: 계정의 game 용도 목소리 36개를 성별·나이·감정으로 훑어
 * **그 페르소나가 실제로 낼 감정을 가진 것**으로 배정했다.
 * 예) 겁많음 → `scared` 를 가진 유일한 축(Dohyun), 죄책감 → `anxious` 를 가진 노년(Alphonse).
 */

export interface Cast {
  /** Supertone voice_id */
  voice: string
  /** 이 목소리가 실제로 쓸 수 있는 스타일 — 없는 걸 보내면 상류가 거절한다 */
  styles: readonly string[]
  /** 사람이 읽을 배역 설명 (대시보드용) */
  note: string
}

const CAST: Record<string, Cast> = {
  authoritative: {
    voice: '58662d5bd86d1b7837f197', note: 'Diego · 중년 남성 · 지휘하는 목소리',
    styles: ['angry', 'command', 'courageous', 'happy', 'neutral', 'sad'],
  },
  timid: {
    // 20개 중 `scared` 를 가진 유일한 축이다. 겁많음에 이보다 맞는 게 없다.
    voice: 'ab7cd18e645b54d7536e0f', note: 'Dohyun · 청년 남성 · 겁먹은 소리를 낼 수 있다',
    styles: ['angry', 'annoyed', 'embarrassed', 'excited', 'firm', 'happy', 'neutral', 'sad', 'scared', 'surprised'],
  },
  calculating: {
    voice: '18139042935bc2849cb6ca', note: 'Desphara · 중년 여성 · 의심하고 내려다본다',
    styles: ['angry', 'disgusted', 'dominating', 'happy', 'neutral', 'sad', 'suspicious'],
  },
  emotional: {
    voice: '87f8e92bda3f7997715795', note: 'Elsie · 노년 여성 · 불안이 크게 흔들린다',
    styles: ['angry', 'angry +', 'anxious', 'anxious +', 'happy', 'happy +', 'neutral', 'neutral +', 'sad', 'teasing', 'teasing +'],
  },
  loyal: {
    voice: 'fa1880d5d3846077811a76', note: 'Gloria · 중년 여성 · 다정하지만 의심한다',
    styles: ['angry', 'happy', 'kind', 'neutral', 'sad', 'suspicious'],
  },
  egocentric: {
    voice: '816bc977b4111a3034146a', note: 'Bert · 노년 남성 · 질투가 드러난다',
    styles: ['angry', 'angry +', 'happy', 'happy +', 'jealous', 'jealous +', 'neutral', 'neutral +', 'sad', 'sad +'],
  },
  guilty: {
    voice: 'c3c0898fd41489a8e8919c', note: 'Alphonse · 노년 남성 · 불안이 깊게 깔린다',
    styles: ['admiring', 'admiring +', 'angry', 'angry +', 'anxious', 'anxious +', 'happy', 'happy +', 'neutral', 'sad', 'sad +'],
  },
  cynical: {
    voice: 'a77c5cbc7a34c484060f02', note: 'Isamu · 청년 남성 · 불친절하다',
    styles: ['angry', 'courageous', 'happy', 'neutral', 'sad', 'unfriendly'],
  },
}

/** 모르는 페르소나가 와도 소리는 나야 한다 — 죄책감 축으로 떨어진다 */
export const castOf = (personaId: string): Cast => CAST[personaId] ?? CAST.guilty!

/**
 * 페르소나의 성격을 감정에 반영한다.
 * 같은 `tell` 이라도 냉소적인 사람의 분노와 겁 많은 사람의 분노는 다른 소리다 —
 * 그 목소리가 가진 고유 스타일이 있으면 그쪽을 쓴다.
 */
const FLAVOR: Record<string, Partial<Record<Tell, string>>> = {
  timid: { stammer: 'scared', gaze: 'embarrassed' },
  calculating: { gaze: 'suspicious', none: 'dominating' },
  egocentric: { anger: 'jealous' },
  cynical: { anger: 'unfriendly' },
  loyal: { gaze: 'kind' },
}

/** 이 인물·이 tell 에 실제로 쓸 스타일. 없는 이름은 절대 내보내지 않는다. */
export function styleFor(personaId: string, tell: Tell): string {
  const cast = castOf(personaId)
  const flavored = FLAVOR[personaId]?.[tell]
  const e = emotionOf(tell)
  for (const cand of [flavored, e.style, e.fallback, 'neutral']) {
    if (cand && cast.styles.includes(cand)) return cand
  }
  return cast.styles[0]!
}
