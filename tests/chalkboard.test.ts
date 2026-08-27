/**
 * 칠판 계약 — **축과 `cell()` 호출 횟수.**
 *
 * 팀 명세 3-2-(5)-(2) 1단계로 표를 전치했다(세로=사람, 가로=시각). 그 과정에서
 * 깨지기 쉬운 계약이 둘 있어서 여기서 잠근다.
 *
 * ① **`cell()` 은 칸당 정확히 한 번.** `fresh`(처음 그어지는 ✕) 를 소모하므로 두 번 부르면
 *    획 애니메이션이 조용히 사라진다. 화면에서는 "가끔 연출이 안 돈다" 로만 보여서 못 찾는다.
 * ② **축.** 되돌아가면 팀 지적("한 인물의 흐름을 따라가기 어렵다")이 그대로 되살아난다.
 *
 * 이 파일은 `renderChalkboard` 를 진짜 DOM 에 그린다 — happy-dom 이라 3D 없이 돈다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { chalkData, renderChalkboard, type ChalkBoardData } from '../src/ui/chalkboard'
import { gc001Case } from '../src/data/gc001'
import { createGame, interview, availableEvidence, lookupEvidence } from '../src/engine/game'
import { CRIME_SLOT, slotLabel, SLOTS, SUSPECTS } from '../src/types'

const SLOT_LABELS = ['21:00', '21:10', '21:16', '21:18', '21:21']

/** 최소 데이터 — 부품은 게임을 모른다 (인자만으로 선다) */
function fixture(spy?: (who: string, ti: number) => void): ChalkBoardData {
  return {
    slots: SLOT_LABELS.map((label, i) => ({ label, isCrime: i === 2 })),
    suspects: SUSPECTS.map((id, i) => ({ id, name: `사람${i + 1}`, job: '직업' })),
    cell(who, ti) {
      spy?.(who, ti)
      return { place: `장소${ti}`, contradicted: false, selected: false }
    },
  }
}

describe('칠판 — 축 (팀 3-2-(5)-(2) 1단계)', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = renderChalkboard(fixture(), { pickCell: () => {} })
  })

  it('행머리는 **사람**이다', () => {
    const rows = Array.from(root.querySelectorAll('[role=rowheader]')).map((n) => n.textContent ?? '')
    expect(rows).toHaveLength(SUSPECTS.length)
    expect(rows.every((t, i) => t.includes(`사람${i + 1}`))).toBe(true)
  })

  it('열머리는 **시각**이다 (모서리 칸 + 시각 5개)', () => {
    const cols = Array.from(root.querySelectorAll('[role=columnheader]')).map((n) => n.textContent ?? '')
    expect(cols).toHaveLength(SLOT_LABELS.length + 1)
    for (const [i, label] of SLOT_LABELS.entries()) expect(cols[i + 1]).toContain(label)
  })

  it('한 사람의 행이 시각 순으로 왼쪽에서 오른쪽으로 놓인다', () => {
    // 행 = 머리행 1 + 사람 5. 각 사람 행은 행머리 1 + 칸 5.
    const rows = Array.from(root.querySelectorAll('[role=row]'))
    expect(rows).toHaveLength(SUSPECTS.length + 1)
    const first = rows[1]!
    const cells = Array.from(first.querySelectorAll('[role=cell]'))
    expect(cells).toHaveLength(SLOT_LABELS.length)
    // 칸에 적히는 것은 **장소뿐**이다 (3-2-(5)-(2) 2단계). 나머지는 호버 쪽지(.cb-tip)로 간다
    expect(cells.map((c) => c.querySelector('.cb-place')?.textContent))
      .toEqual(SLOT_LABELS.map((_, i) => `장소${i}`))
    expect(cells.every((c) => c.querySelector('.cb-tip')?.getAttribute('aria-hidden') === 'true'))
      .toBe(true)
  })

  it('범행 시각 열에만 붉은 분필 표(범행 추정)가 붙는다 — 색 하나로 말하지 않는다', () => {
    const marked = Array.from(root.querySelectorAll('.cb-tag-crime'))
    expect(marked).toHaveLength(1)
    expect(root.querySelector('.cb-slot.crime')?.textContent).toContain(SLOT_LABELS[2])
    // 그 열의 칸 5개(사람 수)도 함께 표시된다
    expect(root.querySelectorAll('.cb-cell.crime')).toHaveLength(SUSPECTS.length)
  })
})

describe('칠판 — cell() 은 칸당 정확히 한 번 (fresh 소모)', () => {
  it('5×5 = 25회, 중복 0', () => {
    const calls: string[] = []
    renderChalkboard(fixture((who, ti) => calls.push(`${who}:${ti}`)), { pickCell: () => {} })
    expect(calls).toHaveLength(SUSPECTS.length * SLOT_LABELS.length)
    expect(new Set(calls).size).toBe(calls.length)
  })

  it('처음 그어지는 ✕ 는 한 번만 fresh 다 — 두 번째 렌더에는 획 연출이 없다', () => {
    const c = gc001Case()
    let g = createGame(c)
    g = interview(g, 'S1')
    const ev = c.evidence[0]!
    g = { ...g, cards: [...g.cards, ev.id], foundContradictions: [`${ev.id}|S1|2`] }
    const seen = new Set<string>()

    const one = renderChalkboard(chalkData(c, g, { selected: [], stampedSeen: seen }), { pickCell: () => {} })
    expect(one.querySelectorAll('.cb-x.fresh')).toHaveLength(1)

    const two = renderChalkboard(chalkData(c, g, { selected: [], stampedSeen: seen }), { pickCell: () => {} })
    expect(two.querySelectorAll('.cb-x')).toHaveLength(1)
    expect(two.querySelectorAll('.cb-x.fresh')).toHaveLength(0)
  })
})

describe('칠판 — 조명 (팀 3-2-(5)-(2) 3단계)', () => {
  it('litSuspect 가 표의 data-lit 이 되고, 칸마다 data-who 가 붙는다', () => {
    const c = gc001Case()
    const g = interview(createGame(c), 'S3')
    const root = renderChalkboard(
      chalkData(c, g, { selected: [], litSuspect: 'S3' }),
      { pickCell: () => {} },
    )
    const table = root.querySelector<HTMLElement>('.cb-table')!
    expect(table.dataset.lit).toBe('S3')
    // 그 사람의 행 = 행머리 1 + 칸 5
    expect(root.querySelectorAll('[data-who="S3"]')).toHaveLength(SLOTS.length + 1)
  })

  it('litSuspect 가 없으면 아무 행도 밝지 않다', () => {
    const c = gc001Case()
    const root = renderChalkboard(
      chalkData(c, createGame(c), { selected: [] }),
      { pickCell: () => {} },
    )
    expect(root.querySelector<HTMLElement>('.cb-table')!.dataset.lit).toBeUndefined()
  })
})

describe('칠판 — 라벨은 사건이 소유한다 (불변식 6)', () => {
  it('열머리 시각은 slotLabel 이 준 문자열 그대로다 — 하드코딩이 없다', () => {
    const c = gc001Case()
    const root = renderChalkboard(
      chalkData(c, createGame(c), { selected: [] }),
      { pickCell: () => {} },
    )
    const cols = Array.from(root.querySelectorAll('[role=columnheader]')).slice(1)
    expect(cols.map((n) => n.querySelector('.cb-slot-t')?.textContent))
      .toEqual(SLOTS.map((t) => slotLabel(c, t)))
    // 범행 시각에만 표가 하나 더 붙는다
    expect(root.querySelector('.cb-slot.crime .cb-slot-t')?.textContent)
      .toBe(slotLabel(c, CRIME_SLOT))
  })
})

describe('칠판 — MIG-003 소거 정책 (showClearing)', () => {
  it('showClearing=false 일 때 candidatesFrom 이 사람을 좁혀도 cleared 가 거짓이다', () => {
    const c = gc001Case()
    // 기록을 모두 조회해 소거를 유발한다
    let g = createGame(c)
    for (const e of availableEvidence(g)) {
      if (g.investigationsLeft <= 0) break
      g = lookupEvidence(g, e.id)
    }
    const d = chalkData(c, g, { selected: [], showClearing: false })
    // 모든 사람이 cleared=false
    expect(d.suspects.every((s) => !s.cleared)).toBe(true)
  })

  it('showClearing=false 일 때 분필 줄·「기록으로 소거」태그·소거 aria-label 이 DOM 에 없다', () => {
    const c = gc001Case()
    let g = createGame(c)
    for (const e of availableEvidence(g)) {
      if (g.investigationsLeft <= 0) break
      g = lookupEvidence(g, e.id)
    }
    const d = chalkData(c, g, { selected: [], showClearing: false })
    const root = renderChalkboard(d, { pickCell: () => {} })
    // 분필 소거선 없음
    expect(root.querySelectorAll('.cb-strike')).toHaveLength(0)
    // '기록으로 소거' 태그 없음
    expect(root.querySelectorAll('.cb-tag-out')).toHaveLength(0)
    // .out 클래스 행머리 없음
    expect(root.querySelectorAll('.cb-name.out')).toHaveLength(0)
    // aria-label 에 '소거' 문구 없음
    const labels = Array.from(root.querySelectorAll('[aria-label]'))
      .map((el) => el.getAttribute('aria-label')!)
    expect(labels.every((l) => !l.includes('소거'))).toBe(true)
  })

  it('showClearing 을 생략하면(기본값) 기존과 동일하게 소거 표시된다', () => {
    const c = gc001Case()
    // 범행 시각 기록을 모두 조회해 소거를 만든다
    let g = createGame(c)
    for (const e of availableEvidence(g)) {
      if (g.investigationsLeft <= 0) break
      g = lookupEvidence(g, e.id)
    }
    const d = chalkData(c, g, { selected: [] })
    // 기존 동작: 후보가 아닌 사람은 cleared=true
    expect(d.suspects.some((s) => s.cleared)).toBe(true)
    const root = renderChalkboard(d, { pickCell: () => {} })
    expect(root.querySelectorAll('.cb-tag-out').length).toBeGreaterThan(0)
  })

  it('showClearing=true 는 명시적으로도 기존 동작이다', () => {
    const c = gc001Case()
    let g = createGame(c)
    for (const e of availableEvidence(g)) {
      if (g.investigationsLeft <= 0) break
      g = lookupEvidence(g, e.id)
    }
    const d = chalkData(c, g, { selected: [], showClearing: true })
    expect(d.suspects.some((s) => s.cleared)).toBe(true)
  })
})