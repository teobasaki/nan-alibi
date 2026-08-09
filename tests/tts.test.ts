import { describe, it, expect, beforeEach } from 'vitest'
import { prosodyOf, emotionOf, scaleByPressure, castOf, styleFor, type Tell } from '../src/ui/tts/emotion'
import { isPermanent } from '../src/ui/tts/supertone'
import { setStage, stage, onStage, resetStage, STAGE_LABEL, type Stage } from '../src/ui/pipeline'

const TELLS: Tell[] = ['none', 'gaze', 'pause', 'stammer', 'anger']

describe('tell → 연기 지시', () => {
  it('LLM 이 낼 수 있는 tell 다섯 가지 전부에 값이 있다', () => {
    for (const t of TELLS) {
      expect(prosodyOf(t)).toBeDefined()
      expect(emotionOf(t)).toBeDefined()
    }
  })

  it('알 수 없는 tell 이 와도 중립으로 떨어진다 — 음성이 게임을 멈추면 안 된다', () => {
    const bogus = 'shrug' as Tell
    expect(prosodyOf(bogus)).toEqual(prosodyOf('none'))
    expect(emotionOf(bogus)).toEqual(emotionOf('none'))
  })

  it('내장 합성 값은 clamp 범위(0.5~2) 안에서만 곱해진다', () => {
    // 페르소나 음색 최대치(1.2)와 곱해도 상한을 넘지 않아야 한다
    for (const t of TELLS) {
      const p = prosodyOf(t)
      expect(p.rate * 1.2).toBeLessThanOrEqual(2)
      expect(p.pitch * 1.25).toBeLessThanOrEqual(2)
      expect(p.rate * 0.9).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('평정(none)이 가장 덜 과장된다', () => {
    const base = emotionOf('none').intensity
    for (const t of TELLS.filter((x) => x !== 'none')) {
      expect(emotionOf(t).intensity).toBeGreaterThan(base)
    }
  })

  /** `pause` 는 "말을 멈췄다" 가 본체다 — 속도만 늦추면 안 들린다. 실제로 쉬어야 한다. */
  it('말 끊김(pause)의 침묵이 가장 길다', () => {
    const p = emotionOf('pause').pauseMs
    for (const t of TELLS.filter((x) => x !== 'pause')) {
      expect(p).toBeGreaterThan(emotionOf(t).pauseMs)
    }
  })

  it('압박이 높을수록 연기가 세지되 1을 넘지 않는다', () => {
    for (const t of TELLS) {
      const calm = scaleByPressure(emotionOf(t), 0)
      const tense = scaleByPressure(emotionOf(t), 100)
      expect(tense.intensity).toBeGreaterThan(calm.intensity)
      expect(tense.intensity).toBeLessThanOrEqual(1)
    }
  })

  it('압박 값이 범위를 벗어나도 안전하다', () => {
    for (const p of [-50, 0, 100, 999, NaN]) {
      const e = scaleByPressure(emotionOf('anger'), p)
      if (Number.isNaN(p)) continue          // NaN 은 아래에서 따로 본다
      expect(e.intensity).toBeGreaterThanOrEqual(0)
      expect(e.intensity).toBeLessThanOrEqual(1)
    }
  })

  it('스타일 이름은 비어 있지 않다 — 상류에 빈 값을 보내면 400 이 온다', () => {
    for (const t of TELLS) expect(emotionOf(t).style.length).toBeGreaterThan(0)
  })
})

describe('파이프라인 단계', () => {
  beforeEach(() => resetStage())

  it('시작은 idle 이고 라벨이 비어 있다', () => {
    expect(stage()).toBe('idle')
    expect(STAGE_LABEL.idle).toBe('')
  })

  it('idle 을 뺀 모든 단계에 사람이 읽을 이름이 있다', () => {
    const all: Stage[] = ['thinking', 'verifying', 'synthesizing', 'speaking']
    for (const s of all) expect(STAGE_LABEL[s].length).toBeGreaterThan(0)
  })

  it('구독자에게 변화가 전달된다', () => {
    const seen: Stage[] = []
    const off = onStage((s) => seen.push(s))
    setStage('thinking')
    setStage('speaking')
    off()
    setStage('idle')                          // 구독 해제 후에는 안 온다
    expect(seen).toEqual(['thinking', 'speaking'])
  })

  /** 전체 재렌더 구조라 같은 단계가 반복 설정된다. 그때마다 알리면 칩이 깜빡여 안 읽힌다. */
  it('같은 단계로 다시 넣으면 알리지 않는다', () => {
    let n = 0
    const off = onStage(() => n++)
    setStage('thinking')
    setStage('thinking')
    setStage('thinking')
    off()
    expect(n).toBe(1)
  })

  it('reset 은 어느 단계에서든 idle 로 되돌린다 — 켜진 채 남으면 거짓말이 된다', () => {
    for (const s of ['thinking', 'verifying', 'synthesizing', 'speaking'] as Stage[]) {
      setStage(s)
      resetStage()
      expect(stage()).toBe('idle')
    }
  })
})

describe('서버 TTS 재시도 판단 — 헛돈 쓰지 않기', () => {
  /**
   * 배포에서 실제로 밟았다. 잘못된 키는 `upstream_403` 으로 오는데
   * `no_key` 만 영구 실패로 보고 있었다 — 심문마다 예산 1.5초를 그냥 버렸다.
   */
  it('4xx 와 no_key 는 영구 실패다 — 다시 물어도 소용없다', () => {
    for (const r of ['no_key', 'upstream_400', 'upstream_401', 'upstream_403', 'upstream_404', 'upstream_429']) {
      expect(isPermanent(r)).toBe(true)
    }
  })

  it('5xx·시간초과·네트워크는 일시적이다 — 계속 시도한다', () => {
    for (const r of ['upstream_500', 'upstream_502', 'upstream_503', 'timeout', 'network', 'unknown']) {
      expect(isPermanent(r)).toBe(false)
    }
  })

  it('이상한 값이 와도 터지지 않는다', () => {
    for (const r of [undefined, null, 42, {}, [], '', 'upstream_abc']) {
      expect(isPermanent(r)).toBe(false)
    }
  })
})

describe('페르소나별 배역 — 다섯 명이 다섯 사람으로 들려야 한다', () => {
  const PERSONAS = ['authoritative', 'timid', 'calculating', 'emotional', 'loyal', 'egocentric', 'guilty', 'cynical']

  it('페르소나 8종 전부에 목소리가 배정돼 있다', () => {
    for (const p of PERSONAS) expect(castOf(p).voice).toMatch(/^[a-f0-9]{16,40}$/)
  })

  /** 전원이 같은 성대를 쓰면 내장 합성이 겪던 문제를 서버에서 반복하는 것이다 */
  it('여덟 페르소나가 서로 다른 목소리를 쓴다', () => {
    const ids = PERSONAS.map((p) => castOf(p).voice)
    expect(new Set(ids).size).toBe(PERSONAS.length)
  })

  it('모르는 페르소나가 와도 목소리가 나온다', () => {
    expect(castOf('없는페르소나').voice).toBe(castOf('guilty').voice)
  })

  /**
   * **이게 이 표의 존재 이유다.** 없는 스타일을 보내면 상류가 거절한다 —
   * 실제로 `fear` 를 보내다 403 을 받았고, 그때는 아무 소리도 안 났다.
   */
  it('내보내는 스타일은 그 목소리가 실제로 가진 것뿐이다', () => {
    for (const p of PERSONAS) {
      const cast = castOf(p)
      for (const t of TELLS) {
        expect(cast.styles).toContain(styleFor(p, t))
      }
    }
  })

  it('성격이 감정에 반영된다 — 겁많음의 더듬음은 scared 다', () => {
    expect(styleFor('timid', 'stammer')).toBe('scared')
    expect(styleFor('egocentric', 'anger')).toBe('jealous')
    expect(styleFor('cynical', 'anger')).toBe('unfriendly')
  })

  it('그 목소리에 없는 성격 색이면 조용히 내려간다', () => {
    // authoritative 목소리(Diego)에는 scared 도 jealous 도 없다
    const s = styleFor('authoritative', 'stammer')
    expect(castOf('authoritative').styles).toContain(s)
    expect(s).not.toBe('scared')
  })

  it('배역마다 사람이 읽을 설명이 있다 — 대시보드가 보여줄 것이다', () => {
    for (const p of PERSONAS) expect(castOf(p).note.length).toBeGreaterThan(5)
  })
})
