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
import { prosodyOf } from './tts/emotion'
import * as supertone from './tts/supertone'
import { setStage } from './pipeline'
import { settings } from './settings'
import type { PersonaReply } from '../engine/prompt'

/** 이 순서로 찾는다. macOS=Yuna, Windows=Heami, Chrome 내장=Google 한국의 */
const PREFERRED = ['Yuna', 'Microsoft Heami', 'Google 한국의']

let voice: SpeechSynthesisVoice | null = null
let ready = false
/** 발화 세대 — 늦게 도착한 오디오가 다음 인물 위에 겹치는 걸 막는다 */
let speakGen = 0

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

// tell → 연기 지시는 `tts/emotion.ts` 가 소유한다 (공급자별로 번역이 다르므로).

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
  if (isMuted()) return
  stop()

  // 플레이어가 끈 것은 끈 것이다. 설정은 규칙이 아니라 편의라 여기서만 본다.
  const mode = settings().voice
  if (mode === 'off') return

  /**
   * **자막이 소리를 기다리지 않는다.**
   *
   * 실측 합성이 2.3~2.6초라 소리를 기다리면 대사가 그만큼 늦게 뜬다.
   * 그래서 타이핑 연출(`onBoundary`)은 **즉시** 시작하고, 서버 음성은
   * 준비되는 대로 얹는다. 늦거나 실패하면 내장 합성이 받는다.
   *
   * 처음엔 예산을 1.5초로 잡아 매번 잘렸는데, 내장 합성이 대신 소리를 내서
   * **겉보기에는 동작하는 것처럼 보였다.** 조용한 실패가 제일 위험하다.
   */
  if (mode === 'auto' && !supertone.isDisabled()) {
    setStage('synthesizing')
    approximateBoundary(reply.speech, onBoundary)   // 자막은 지금 간다

    // 이 발화의 세대 번호. 도중에 다른 인물로 넘어가면(`stop()`) 늦게 온 오디오를 버린다 —
    // 안 버리면 이미 떠난 사람의 목소리가 뒤늦게 들린다.
    const gen = ++speakGen
    /**
     * **문장이 완성되기를 기다리지 않고 청크로 쏜다** (사용자 지시).
     *
     * 합성 시간은 글자 수에 비례하므로, 앞의 몇 단어만 먼저 보내면 그 조각이
     * 훨씬 먼저 돌아온다. 조각 전부를 **동시에** 요청해 두고(서로 독립된 호출이다)
     * **순서대로 재생**한다 — 첫 조각이 울리는 동안 뒤 조각은 이미 합성 중이라,
     * 총 대기는 "가장 긴 조각" 이 아니라 "첫 조각" 으로 줄어든다.
     *
     * 첫 조각이 실패하면 전체를 내장 합성으로 넘긴다. 중간 조각이 비면 그 조각만
     * 건너뛴다 — 말이 조금 끊기는 것이 통째로 침묵하는 것보다 낫다.
     */
    const chunks = supertone.chunkSpeech(reply.speech)
    const pressure = pressureOf(reply)
    const pending = chunks.map((c) => supertone.synthesize(c, reply.tell, pressure, personaId))
    void (async () => {
      for (let i = 0; i < pending.length; i++) {
        const r = await pending[i]!
        if (isMuted() || gen !== speakGen) return
        if (!r) {
          // 첫 조각부터 못 냈으면 서버가 죽은 것이다 — 내장이 통째로 받는다
          if (i === 0) speakLocal(reply, personaId)
          continue
        }
        setStage('speaking')
        await new Promise<void>((done) => supertone.play(r.audio, done))
        if (gen !== speakGen) return
      }
      if (gen === speakGen) setStage('idle')
    })()
    return
  }

  speakLocal(reply, personaId, onBoundary)
}

/** 브라우저 내장 합성 — 원래의 경로이자 최종 폴백 */
function speakLocal(
  reply: PersonaReply,
  personaId: string,
  onBoundary?: (charIndex: number) => void,
): void {
  if (!voice) return setStage('idle')
  speechSynthesis.cancel()
  setStage('speaking')

  const t = TIMBRE[personaId] ?? { rate: 1, pitch: 1 }
  const e = prosodyOf(reply.tell)
  let offset = 0

  const parts = sentences(reply.speech)
  parts.forEach((s, i) => {
    const u = new SpeechSynthesisUtterance(s)
    const base = offset
    u.voice = voice
    u.lang = 'ko-KR'
    u.rate = clamp(t.rate * e.rate)
    u.pitch = clamp(t.pitch * e.pitch)
    if (onBoundary) u.onboundary = (ev) => onBoundary(base + ev.charIndex)
    if (i === parts.length - 1) u.onend = () => setStage('idle')
    speechSynthesis.speak(u) // 큐가 순서를 보장한다
    offset += s.length + 1
  })
}

/**
 * 서버 음성은 글자 경계를 알려주지 않는다. 한국어 발화 속도 실측(약 7.26자/초)으로
 * 타이핑 연출을 근사한다 — 정확하지 않지만, 자막이 멈춰 있는 것보다 낫다.
 */
function approximateBoundary(text: string, onBoundary?: (i: number) => void): void {
  if (!onBoundary) return
  const perChar = 1000 / 7.26
  for (let i = 0; i < text.length; i++) {
    setTimeout(() => onBoundary(i), i * perChar)
  }
}

/** `pressureDelta` 는 검증기를 통과하지만 소비처가 없다. 연기 강도에만 쓴다. */
const pressureOf = (r: PersonaReply): number =>
  typeof r.pressureDelta === 'number' ? Math.abs(r.pressureDelta) : 0

export function stop(): void {
  speakGen++                    // 진행 중인 합성 결과를 무효화한다
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  supertone.stop()
  setStage('idle')
}
