import { describe, it, expect } from 'vitest'
import { generateValidCase } from '../src/engine/validate'
import { newTrace, record, type Trace, type TraceEvent } from '../src/engine/journey'
import { journalLines, tally } from '../src/ui/journal'
import { SUSPECTS } from '../src/types'

const CASE = generateValidCase(4242).case
const T0 = 1_000_000
const tr = (...es: TraceEvent[]): Trace => es.reduce((a, e) => record(a, e), newTrace(4242, T0))
const EV = CASE.evidence[0]!.id
const S1 = 'S1' as const

describe('일지 — 여정을 형사가 받아 적은 문장으로', () => {
  it('빈 여정은 빈 일지다', () => {
    expect(journalLines(CASE, newTrace(1, T0))).toEqual([])
  })

  it('내부 id 가 문장에 새지 않는다 — 사람은 "CCTV · 22:20 복도" 로 기억한다', () => {
    const [l] = journalLines(CASE, tr({ t: 1, k: 'lookup', ev: EV }))
    expect(l!.text).not.toContain(EV)
    expect(l!.text).toMatch(/CCTV|카드키|통화|영수증/)
  })

  it('인물은 이름으로 적힌다 — S1 이 아니라', () => {
    const [l] = journalLines(CASE, tr({ t: 1, k: 'ask', who: S1, preset: true, fallback: false }))
    expect(l!.text).toContain(CASE.suspects.S1.name)
    expect(l!.text).not.toContain('S1')
  })
})

describe('여백 눈금 — 조사 1회는 정확히 한 줄이다', () => {
  it('조회·심문·제시만 눈금을 긋는다', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'lookup', ev: EV },
      { t: 2, k: 'ask', who: S1, preset: true, fallback: false },
      { t: 3, k: 'present', ev: EV, who: S1, opened: false },
    ))
    expect(tally(lines, 9)).toEqual({ spent: 3, left: 6 })
  })

  /** 연결은 무료다. 눈금이 그어지면 플레이어가 자원을 잘못 센다. */
  it('연결과 지목은 눈금을 긋지 않는다', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'connect', hit: true },
      { t: 2, k: 'connect', hit: false },
      { t: 3, k: 'submit', who: S1, correct: false, score: 40 },
    ))
    expect(tally(lines, 9).spent).toBe(0)
    expect(lines).toHaveLength(3)
  })

  /** 폴백이면 조사가 환불된다. 눈금을 그으면 일지가 예산을 틀리게 말한다. */
  it('폴백 심문은 눈금을 긋지 않고 그 사실을 적는다', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'ask', who: S1, preset: true, fallback: true },
    ))
    expect(lines[0]!.spent).toBe(false)
    expect(lines[0]!.text).toContain('돌려받았다')
  })

  it('각도 전환과 인물 열람은 일지에 안 적힌다 — 지출이 아니다', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'view', to: 'place' },
      { t: 2, k: 'open', who: S1 },
    ))
    expect(lines).toEqual([])
  })

  it('예산을 넘겨도 음수가 되지 않는다', () => {
    const many = Array.from({ length: 12 }, (_, i): TraceEvent => ({ t: i, k: 'lookup', ev: EV }))
    expect(tally(journalLines(CASE, tr(...many)), 9).left).toBe(0)
  })
})

describe('인장 — 모순은 별도 목록이 아니라 일지 안의 표시다', () => {
  it('어긋난 연결에 인장이 찍힌다', () => {
    const [l] = journalLines(CASE, tr({ t: 1, k: 'connect', hit: true }))
    expect(l!.stamp).toBe('hit')
  })

  it('어긋나지 않은 연결은 다른 표시다 — 실패가 아니라 소거다', () => {
    const [l] = journalLines(CASE, tr({ t: 1, k: 'connect', hit: false }))
    expect(l!.stamp).toBe('miss')
  })

  it('해금된 제시는 열림 표시가 붙는다', () => {
    const [l] = journalLines(CASE, tr({ t: 1, k: 'present', ev: EV, who: S1, opened: true }))
    expect(l!.stamp).toBe('open')
  })
})

/**
 * 계약이 지목한 불변식. `main.ts` 의 `doAsk`·`doPresent` 는 `mark()` 를 먼저 하고
 * `ui.chats[s]` 에 나중에 동기 append 한다. 그 정렬이 깨지면 일지는 **엉뚱한 이벤트에
 * 엉뚱한 대사를 붙여** 그럴듯하게 렌더한다 — 화면에 오류가 아니라 거짓말이 남는다.
 */
describe('대사 정렬 불변식 — 우연히 맞는 상태로 두지 않는다', () => {
  it('인물별 n 번째 심문에 n 번째 조서가 붙는다', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'ask', who: 'S1', preset: true, fallback: false },
      { t: 2, k: 'ask', who: 'S2', preset: true, fallback: false },
      { t: 3, k: 'ask', who: 'S1', preset: false, fallback: false },
    ), { S1: ['가1', '가2'], S2: ['나1'] })
    expect(lines.map((l) => l.note)).toEqual(['가1', '나1', '가2'])
  })

  it('심문과 제시가 같은 인물 순번을 공유한다 — 둘 다 chats 에 쌓이므로', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'ask', who: 'S1', preset: true, fallback: false },
      { t: 2, k: 'present', ev: EV, who: 'S1', opened: false },
      { t: 3, k: 'ask', who: 'S1', preset: true, fallback: false },
    ), { S1: ['첫째', '둘째', '셋째'] })
    expect(lines.map((l) => l.note)).toEqual(['첫째', '둘째', '셋째'])
  })

  /** 폴백도 chats 에 쌓인다(main.ts 가 실패 대사를 넣는다) — 순번을 소비해야 정렬이 안 밀린다 */
  it('폴백 심문도 순번을 소비한다', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'ask', who: 'S1', preset: true, fallback: true },
      { t: 2, k: 'ask', who: 'S1', preset: true, fallback: false },
    ), { S1: ['실패대사', '진짜대사'] })
    expect(lines[0]!.note).toBeUndefined()        // 폴백 줄에는 조서를 안 붙인다
    expect(lines[1]!.note).toBe('진짜대사')       // 그러나 순번은 밀리지 않았다
  })

  it('조서가 없어도 일지는 성립한다 — 편의 기능이 본체를 막으면 안 된다', () => {
    const lines = journalLines(CASE, tr(
      { t: 1, k: 'ask', who: 'S1', preset: true, fallback: false },
    ))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.note).toBeUndefined()
  })
})

describe('규칙을 계산하지 않는다', () => {
  /**
   * 일지가 "남은 후보 3명" 같은 현재 상태를 쓰면, 그 시점 g.cards 를 복원해야 하고
   * 그건 engine 의 카드 획득 규칙을 ui/ 에서 두 번째로 구현하는 일이다.
   * 그 복제는 타입 에러 없이 조용히 썩는다.
   */
  it('일지 문장에 후보 수·점수 같은 계산 결과가 없다', () => {
    let t = newTrace(4242, T0)
    for (const s of SUSPECTS) t = record(t, { t: 1, k: 'ask', who: s, preset: true, fallback: false })
    t = record(t, { t: 9, k: 'submit', who: 'S1', correct: true, score: 88 })
    const all = journalLines(CASE, t).map((l) => l.text).join(' ')
    expect(all).not.toMatch(/후보|남은|점수|88/)
  })

  it('engine 을 import 하지 않는다 — 타입만 가져온다', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/ui/journal.ts', 'utf8'))
    const runtimeEngineImports = src
      .split('\n')
      .filter((l) => l.includes("from '../engine/") && !l.trimStart().startsWith('import type'))
    expect(runtimeEngineImports).toEqual([])
  })
})
