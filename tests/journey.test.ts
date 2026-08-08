import { describe, it, expect } from 'vitest'
import {
  newTrace, record, profile, tendency,
  type Trace, type TraceEvent,
} from '../src/engine/journey'
import { saveTrace, loadTraces } from '../src/ui/journeyStore'

const T0 = 1_000_000
const tr = (...es: TraceEvent[]): Trace =>
  es.reduce((a, e) => record(a, e), newTrace(4242, T0))

const lookup = (t: number, ev: string): TraceEvent => ({ t, k: 'lookup', ev })
const ask = (t: number, who: 'S1' | 'S2' | 'S3' | 'S4' | 'S5'): TraceEvent =>
  ({ t, k: 'ask', who, preset: true, fallback: false })

describe('여정 기록', () => {
  it('빈 여정은 성향을 단정하지 않는다', () => {
    expect(profile(newTrace(1, T0)).style).toBe('미상')
  })

  /** 한 판이 아무리 길어도 무한히 쌓이면 그건 기록이 아니라 누수다 */
  it('이벤트 상한을 넘으면 더 쌓이지 않는다', () => {
    let t = newTrace(1, T0)
    for (let i = 0; i < 600; i++) t = record(t, lookup(i, `E${i}`))
    expect(t.events.length).toBe(500)
  })

  it('기록은 불변이다 — 원본이 바뀌지 않는다', () => {
    const a = newTrace(1, T0)
    const b = record(a, lookup(1, 'E1'))
    expect(a.events).toHaveLength(0)
    expect(b.events).toHaveLength(1)
  })
})

describe('성향 분류', () => {
  it('조회 위주면 기록파다', () => {
    const p = profile(tr(lookup(1, 'E1'), lookup(2, 'E2'), lookup(3, 'E3'), ask(4, 'S1')))
    expect(p.style).toBe('기록파')
    expect(p.lookupRatio).toBeGreaterThan(0.6)
  })

  it('여러 명을 심문하면 심문파다', () => {
    const p = profile(tr(ask(1, 'S1'), ask(2, 'S2'), ask(3, 'S3'), ask(4, 'S4')))
    expect(p.style).toBe('심문파')
    expect(p.peopleAsked).toBe(4)
  })

  /** 한두 명만 파는 것은 QA 가 지적한 실제 실패 양상이다 */
  it('한두 명만 반복해 파면 집중형이다', () => {
    const p = profile(tr(ask(1, 'S1'), ask(2, 'S1'), ask(3, 'S1'), ask(4, 'S2')))
    expect(p.style).toBe('집중형')
    expect(p.peopleAsked).toBe(2)
  })

  it('행동이 적으면 성급히 분류하지 않는다', () => {
    expect(profile(tr(lookup(1, 'E1'), lookup(2, 'E2'))).style).toBe('미상')
  })
})

describe('진단 한 줄 — 오답 피드백에 붙일 재료', () => {
  it('연결을 한 번도 안 했으면 그걸 짚는다', () => {
    const p = profile(tr(lookup(1, 'E1'), lookup(2, 'E2'), lookup(3, 'E3'), ask(4, 'S1')))
    expect(p.connects).toBe(0)
    expect(p.note).toContain('연결')
  })

  it('연결을 했으면 그 지적은 안 나온다', () => {
    const p = profile(tr(
      lookup(1, 'E1'), lookup(2, 'E2'), lookup(3, 'E3'), ask(4, 'S1'),
      { t: 5, k: 'connect', hit: true },
      { t: 6, k: 'view', to: 'place' }, { t: 7, k: 'view', to: 'person' },
    ))
    expect(p.note).not.toContain('연결')
  })

  it('한 각도로만 봤으면 뒤집어 보라고 한다', () => {
    const p = profile(tr(
      lookup(1, 'E1'), lookup(2, 'E2'), lookup(3, 'E3'), lookup(4, 'E4'),
      { t: 5, k: 'connect', hit: false },
      { t: 6, k: 'view', to: 'time' },
    ))
    expect(p.viewsUsed).toBe(1)
    expect(p.note).toContain('장소별')
  })
})

describe('여러 판에 걸친 경향 — 개인화가 딛고 설 자리', () => {
  const done = (t: Trace): Trace =>
    record(t, { t: 99, k: 'submit', who: 'S1', correct: false, score: 40 })

  it('끝내지 않은 판은 세지 않는다', () => {
    expect(tendency([tr(ask(1, 'S1'), ask(2, 'S2'), ask(3, 'S3'))])).toEqual({ style: '미상', games: 0 })
  })

  it('여러 판에서 반복된 성향을 집어낸다', () => {
    const games = [
      done(tr(ask(1, 'S1'), ask(2, 'S2'), ask(3, 'S3'), ask(4, 'S4'))),
      done(tr(ask(1, 'S1'), ask(2, 'S2'), ask(3, 'S3'), ask(4, 'S5'))),
      done(tr(lookup(1, 'E1'), lookup(2, 'E2'), lookup(3, 'E3'), ask(4, 'S1'))),
    ]
    const t = tendency(games)
    expect(t.games).toBe(3)
    expect(t.style).toBe('심문파')
  })
})

describe('저장 — 로컬에만, 최근 것만', () => {
  const mem = (init = '[]'): Storage => {
    let v = init
    return { getItem: () => v, setItem: (_: string, n: string) => { v = n } } as unknown as Storage
  }

  it('저장한 판이 돌아온다', () => {
    const s = mem()
    saveTrace(tr(lookup(1, 'E1')), s)
    expect(loadTraces(s)).toHaveLength(1)
  })

  it('최근 10판만 남는다 — 무한히 쌓지 않는다', () => {
    const s = mem()
    for (let i = 0; i < 15; i++) saveTrace(newTrace(i, T0), s)
    const list = loadTraces(s)
    expect(list).toHaveLength(10)
    expect(list[0]!.seed).toBe(5)          // 앞의 5판은 밀려났다
  })

  it('망가진 저장값이 있어도 빈 목록으로 뜬다', () => {
    expect(loadTraces(mem('{{{'))).toEqual([])
    expect(loadTraces(mem('{"not":"array"}'))).toEqual([])
  })

  it('모양이 다른 항목은 걸러진다', () => {
    expect(loadTraces(mem('[{"seed":1,"events":[]},{"bogus":true},null]'))).toHaveLength(1)
  })

  /** 질문 원문은 남기지 않는다 — 개인 식별 가능한 문장이 섞일 수 있다 */
  it('심문 기록에 질문 원문이 없다', () => {
    const e = tr(ask(1, 'S1')).events[0]!
    expect(JSON.stringify(e)).not.toContain('question')
    expect(Object.keys(e).sort()).toEqual(['fallback', 'k', 'preset', 't', 'who'])
  })
})
