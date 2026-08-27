/**
 * 수사일지 조사 면 — **판단하지 않고 보여준다** (명세 V0.2 §36 · AC-12).
 *
 * 가장 중요한 계약: 시스템이 "거짓말했다"·"범인이 아니다" 라고 쓰지 않는다.
 * 상태 이름은 관찰이어야 한다 — 어긋남은 관찰이고 거짓말은 판단이다.
 */
import { describe, expect, it, vi } from 'vitest'
import { CLAIM_STATE_LABEL, inquiryView, renderInquiry, type InquirySource, type InquiryTab } from '../src/ui/inquiryPanel'
import {
  challenge, createInquiry, discover, hear, learnFact, question, revise, setMemo, setSuspect,
  shakyClaims, understand,
} from '../src/engine/inquiry'
import { gc001Claim, gc001Fact } from '../src/data/gc001-inquiry'
import { SUSPECTS, type SuspectId } from '../src/types'

const NAMES: Record<SuspectId, string> = {
  S1: '류나린', S2: '배지호', S3: '문소라', S4: '도율', S5: '김하늘',
}

const src: InquirySource = {
  claim: (id) => {
    const c = gc001Claim(id)
    return c ? { speaker: c.speaker, text: c.text, at: c.at, revisedTo: c.revisedTo } : undefined
  },
  fact: (id) => {
    const f = gc001Fact(id)
    return f ? { text: f.text, source: f.source } : undefined
  },
  suspectName: (id) => NAMES[id],
  evidenceLabel: (id) => `기록 ${id}`,
  people: SUSPECTS.map((s) => ({ id: s, name: NAMES[s] })),
}

const view = (s = createInquiry(), tab: InquiryTab = 'overview') => inquiryView(s, src, shakyClaims(s), tab)
const handlers = (pickSuspect: (id: SuspectId | null) => void = () => {}) => ({
  changeTab: () => {}, pickSuspect, setMemo: () => {}, saveHypothesis: () => {},
  removeHypothesis: () => {}, addLink: () => {}, removeLink: () => {}, openProof: () => {},
})
const draw = (s = createInquiry(), tab: InquiryTab = 'overview') => renderInquiry(view(s, tab), handlers())

describe('상태 이름 — 관찰만 적는다 (AC-12)', () => {
  it('어떤 상태 이름에도 "거짓" 이라는 낱말이 없다', () => {
    for (const label of Object.values(CLAIM_STATE_LABEL)) {
      expect(label).not.toContain('거짓')
      expect(label).not.toContain('범인')
    }
  })

  it('DISPROVED 는 "기록과 어긋난다" 로 적는다', () => {
    expect(CLAIM_STATE_LABEL.DISPROVED).toBe('기록과 어긋난다')
  })

  it('화면 전체에도 판단하는 문구가 없다', () => {
    let s = hear(createInquiry(), 'CLM-GC001-MUN-NO-MOVE')
    s = revise(challenge(s, 'CLM-GC001-MUN-NO-MOVE'), 'CLM-GC001-MUN-NO-MOVE', 'CLM-GC001-MUN-MOVED').state
    s = setSuspect(s, 'S1')
    const text = draw(s, 'testimony').textContent ?? ''
    for (const banned of ['거짓말', '범인은', '무죄', '유죄']) expect(text).not.toContain(banned)
  })
})

describe('바뀐 말은 원본과 나란히 (명세 §15)', () => {
  it('원본 아래에 고친 말이 붙고, 둘 다 화면에 있다', () => {
    let s = hear(createInquiry(), 'CLM-GC001-GIM-BLOCKED')
    s = revise(s, 'CLM-GC001-GIM-BLOCKED', 'CLM-GC001-GIM-MISSED-FRAME').state
    const root = draw(s, 'testimony')
    const rows = Array.from(root.querySelectorAll('.iq-claim'))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.className).toContain('s-disproved')
    expect(rows[1]!.className).toContain('rev')
    expect(root.textContent).toContain(gc001Claim('CLM-GC001-GIM-BLOCKED')!.text)
    expect(root.textContent).toContain(gc001Claim('CLM-GC001-GIM-MISSED-FRAME')!.text)
  })

  it('아직 못 들은 수정 진술은 화면에 없다 — 앞질러 보여주지 않는다', () => {
    const s = hear(createInquiry(), 'CLM-GC001-GIM-BLOCKED')
    expect(view(s, 'testimony').claims[0]!.revisedById).toBeUndefined()
    expect(draw(s, 'testimony').textContent).not.toContain(gc001Claim('CLM-GC001-GIM-MISSED-FRAME')!.text)
  })
})

describe('다음 질문거리', () => {
  it('흔들리는 진술이 「확인이 필요한 진술」로 뜬다', () => {
    let s = hear(createInquiry(), 'CLM-GC001-RYU-LEFT')
    s = question(s, 'CLM-GC001-RYU-LEFT', ['F-GC001-DOOR-OPEN-NOT-PASSAGE'])
    const root = draw(s)
    expect(root.querySelector('.iq-next')).not.toBeNull()
    expect(root.querySelector('.iq-shaky')!.textContent).toContain('류나린')
  })

  it('흔들리는 것이 없으면 그 칸이 아예 없다 — 빈 상자를 두지 않는다', () => {
    expect(draw(hear(createInquiry(), 'CLM-GC001-DO-EXITED')).querySelector('.iq-next')).toBeNull()
  })
})

describe('사실·기록·메모', () => {
  it('확인된 사실은 출처와 함께 뜬다', () => {
    const s = learnFact(createInquiry(), 'F-GC001-MAIN-LOADING-TRAVEL-TIME')
    const root = draw(s)
    expect(root.textContent).toContain('최소 이동 시간은 2분')
    expect(root.textContent).toContain('출처 · 갤러리 도면 · 동선 실측')
  })

  it('발견한 기록만 목록에 오른다 — 세계에 있는 것을 미리 보여주지 않는다', () => {
    const s = understand(discover(createInquiry(), 'E3'), 'E3')
    const v = view(s)
    expect(v.evidence).toEqual([{ id: 'E3', label: '기록 E3', state: 'UNDERSTOOD' }])
  })

  it('메모는 그대로 담긴다', () => {
    const root = draw(setMemo(createInquiry(), '류나린 · 21:04 확인 필요'))
    expect(root.querySelector<HTMLTextAreaElement>('.iq-memo')!.value).toBe('류나린 · 21:04 확인 필요')
  })
})

describe('현재 의심 인물 — 정답 제출이 아니다 (명세 §22)', () => {
  it('다섯 명이 다 있고, 고른 사람에게 표시가 붙는다', () => {
    const root = draw(setSuspect(createInquiry(), 'S3'))
    const people = Array.from(root.querySelectorAll('.iq-person'))
    expect(people).toHaveLength(5)
    const on = people.filter((n) => n.classList.contains('on'))
    expect(on).toHaveLength(1)
    expect(on[0]!.textContent).toContain('문소라')
    expect(on[0]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('같은 사람을 다시 누르면 표시를 거둔다 — 의심을 거두는 것도 수사다', () => {
    const pickSuspect = vi.fn()
    const root = renderInquiry(view(setSuspect(createInquiry(), 'S1')), handlers(pickSuspect))
    const first = root.querySelector<HTMLButtonElement>('.iq-person.on')!
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pickSuspect).toHaveBeenCalledWith(null)
  })

  it('안내 문구가 "정답 제출이 아니다" 를 말한다', () => {
    expect(draw().textContent).toContain('정답 제출이 아니다')
  })
})

describe('정렬 — 한 사람의 말이 모여 있어야 변화가 읽힌다', () => {
  it('사람 순서 → 시각 순서', () => {
    let s = createInquiry()
    s = hear(s, 'CLM-GC001-GIM-PANEL')      // S5 21:16
    s = hear(s, 'CLM-GC001-RYU-REENTERED')  // S1 21:22
    s = hear(s, 'CLM-GC001-RYU-LEFT')       // S1 21:04
    s = hear(s, 'CLM-GC001-MUN-LOADING')    // S3 21:18
    expect(view(s).claims.map((c) => c.id)).toEqual([
      'CLM-GC001-RYU-LEFT', 'CLM-GC001-RYU-REENTERED', 'CLM-GC001-MUN-LOADING', 'CLM-GC001-GIM-PANEL',
    ])
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 사건 개요 탭 — 시안 카드 구성 (핵심 사실 · 의심 인물 · 메모 · 관련 증거/증언 · 타임라인 바)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('사건 개요 탭 — 카드 구성', () => {
  it('핵심 사실이 있으면 체크리스트 항목이 뜬다', () => {
    const s = learnFact(createInquiry(), 'F-GC001-CRIME-WINDOW')
    const root = draw(s)
    expect(root.querySelector('.iq-checklist')).not.toBeNull()
    expect(root.querySelector('.iq-checklist')!.textContent).toContain('21:15')
  })

  it('핵심 사실이 4건을 넘으면 [더 보기] 단추가 나타난다', () => {
    let s = createInquiry()
    s = learnFact(s, 'F-GC001-CRIME-WINDOW')
    s = learnFact(s, 'F-GC001-MAIN-LOADING-TRAVEL-TIME')
    s = learnFact(s, 'F-GC001-DOOR-OPEN-NOT-PASSAGE')
    s = learnFact(s, 'F-GC001-PLINTH-OK-2040')
    s = learnFact(s, 'F-GC001-LABEL-CHANGED-2118')
    const root = draw(s)
    expect(root.querySelector('.iq-more')).not.toBeNull()
    expect(root.querySelectorAll('.iq-checklist li')).toHaveLength(4)
  })

  it('폴라로이드 자리(placeholder)가 항상 있다', () => {
    const root = draw()
    expect(root.querySelector('.iq-photo-card')).not.toBeNull()
    expect(root.querySelector('.iq-photo-placeholder')).not.toBeNull()
  })

  it('관련 증거/증언 섹션은 데이터가 있을 때만 나타난다', () => {
    // 빈 상태에서는 없다
    const empty = draw()
    expect(empty.querySelector('.iq-related')).toBeNull()

    // 증거가 있으면 나온다
    const s = discover(createInquiry(), 'E3')
    const root = draw(s)
    expect(root.querySelector('.iq-related')).not.toBeNull()
  })

  it('타임라인 바는 시각이 있는 진술이 있을 때만 나타난다', () => {
    expect(draw().querySelector('.iq-timeline-bar')).toBeNull()
    let s = hear(createInquiry(), 'CLM-GC001-RYU-LEFT')
    s = hear(s, 'CLM-GC001-RYU-REENTERED')
    expect(draw(s).querySelector('.iq-timeline-bar')).not.toBeNull()
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 심문 인라인 위젯 DOM 테스트 (3-3-(5) 3단계 · §22 · §36)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
import { renderShakyHint, renderSuspectIndicator, renderMemoPreview } from '../src/ui/inquiryPanel'
import { TABS, tabItemCounts, computeTabBadges, type TabBadges } from '../src/ui/inquiryPanel'

describe('심문 인라인 힌트 — 흔들리는 진술 (3-3-(5) 3단계)', () => {
  it('흔들리는 행이 있으면 DOM 을 돌려준다', () => {
    const el = renderShakyHint([
      { id: 'CLM-1', speakerName: '류나린', text: '21:04에 나갔다', at: '21:04' },
    ])
    expect(el).not.toBeNull()
    expect(el!.className).toContain('iq-stage-shaky')
    expect(el!.textContent).toContain('류나린')
    expect(el!.textContent).toContain('21:04에 나갔다')
    expect(el!.textContent).toContain('확인이 필요한 진술')
  })

  it('비어 있으면 null — DOM 에 아무것도 넣지 않는다', () => {
    expect(renderShakyHint([])).toBeNull()
  })

  it('aria-live 가 polite 이다 — 스크린리더에 자동 통보', () => {
    const el = renderShakyHint([{ id: 'X', speakerName: 'A', text: 'B' }])
    expect(el!.getAttribute('aria-live')).toBe('polite')
  })

  it('시각이 없는 진술은 시각 없이 표시', () => {
    const el = renderShakyHint([{ id: 'X', speakerName: '배지호', text: '나는 몰랐다' }])
    expect(el!.textContent).toContain('배지호')
    expect(el!.textContent).toContain('나는 몰랐다')
    expect(el!.textContent).not.toContain('·')
  })
})

describe('의심 인물 인라인 표시 (§22)', () => {
  it('이름이 있으면 표시한다', () => {
    const el = renderSuspectIndicator('류나린')
    expect(el.className).toContain('iq-stage-suspect')
    expect(el.textContent).toContain('류나린')
    expect(el.textContent).toContain('의심 인물')
  })

  it('이름이 null 이면 "아직 없다"', () => {
    const el = renderSuspectIndicator(null)
    expect(el.textContent).toContain('아직 없다')
    expect(el.querySelector('.empty')).not.toBeNull()
  })

  it('클릭 핸들러가 있으면 role=button 이 붙는다', () => {
    const fn = vi.fn()
    const el = renderSuspectIndicator('문소라', fn)
    expect(el.getAttribute('role')).toBe('button')
    el.click()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('클릭 핸들러가 없으면 role=button 이 없다', () => {
    const el = renderSuspectIndicator('배지호')
    expect(el.getAttribute('role')).toBeNull()
  })

  it('aria-label 이 있다', () => {
    const el = renderSuspectIndicator('도율')
    expect(el.getAttribute('aria-label')).toBe('현재 의심 인물')
  })
})

describe('메모 미리보기 (§36)', () => {
  it('메모가 있으면 첫 줄 미리보기를 보여준다', () => {
    const el = renderMemoPreview('류나린 21:04 확인 필요\n두 번째 줄')
    expect(el).not.toBeNull()
    expect(el!.className).toContain('iq-stage-memo')
    expect(el!.textContent).toContain('류나린 21:04 확인 필요')
    expect(el!.textContent).not.toContain('두 번째 줄')
  })

  it('메모가 비어 있으면 null', () => {
    expect(renderMemoPreview('')).toBeNull()
    expect(renderMemoPreview('   ')).toBeNull()
  })

  it('60자 넘으면 말줄임표', () => {
    const long = 'A'.repeat(80)
    const el = renderMemoPreview(long)!
    expect(el.textContent).toContain('…')
  })

  it('클릭 핸들러가 있으면 role=button', () => {
    const fn = vi.fn()
    const el = renderMemoPreview('test', fn)!
    expect(el.getAttribute('role')).toBe('button')
    el.click()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('aria-label 이 있다', () => {
    const el = renderMemoPreview('뭔가 적음')!
    expect(el.getAttribute('aria-label')).toBe('내 메모')
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 탭 순서·라벨 정합 (정본 3.2.4·3.2.13)
 * 「사건 개요 · 용의자 증언 · 증거 · 타임라인 · 추론」
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('탭 순서·라벨 — 정본 3.2.4·3.2.13 에 맞춘다', () => {
  it('TABS 배열의 순서는 사건 개요 → 용의자 증언 → 증거 → 타임라인 → 추론', () => {
    expect(TABS.map((t) => t.id)).toEqual([
      'overview', 'testimony', 'evidence', 'timeline', 'deduction',
    ])
  })

  it('라벨은 문서 문자열과 일치한다', () => {
    expect(TABS.map((t) => t.label)).toEqual([
      '사건 개요', '용의자 증언', '증거', '타임라인', '추론',
    ])
  })

  it('번호는 순서에 따라 01~05 다', () => {
    expect(TABS.map((t) => t.no)).toEqual(['01', '02', '03', '04', '05'])
  })

  it('DOM 에 렌더된 탭 버튼도 같은 순서다', () => {
    const root = draw()
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    expect(tabs.map((b) => b.getAttribute('data-tab'))).toEqual([
      'overview', 'testimony', 'evidence', 'timeline', 'deduction',
    ])
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 탭 알림 배지 (3.2.13 「새로운 정보가 들어온 탭에는 NEW, 숫자, 알림 표시」)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('탭 알림 배지 (3.2.13)', () => {
  it('새 항목이 들어오면 배지에 숫자가 뜬다', () => {
    let s = createInquiry()
    s = hear(s, 'CLM-GC001-RYU-LEFT')
    s = hear(s, 'CLM-GC001-MUN-LOADING')

    const counts = tabItemCounts(s)
    const seen = { overview: 0, testimony: 0, evidence: 0, timeline: 0, deduction: 0 }
    const badges = computeTabBadges(counts, seen)

    expect(badges.testimony).toBe(2)
    expect(badges.timeline).toBe(2)
  })

  it('그 탭을 보면 알림이 사라진다 (seen 갱신 후 badge 0)', () => {
    let s = createInquiry()
    s = hear(s, 'CLM-GC001-RYU-LEFT')

    const counts = tabItemCounts(s)
    // 탭을 본다 — seen 을 현재 수치로 갱신
    const seen = { overview: 0, testimony: counts.testimony, evidence: 0, timeline: 0, deduction: 0 }
    const badges = computeTabBadges(counts, seen)

    expect(badges.testimony).toBeUndefined()
  })

  it('탭을 본 뒤 다시 항목이 들어오면 다시 알림이 뜬다', () => {
    let s = createInquiry()
    s = hear(s, 'CLM-GC001-RYU-LEFT')
    const counts1 = tabItemCounts(s)
    // 탭을 봤다
    const seen = { overview: 0, testimony: counts1.testimony, evidence: 0, timeline: 0, deduction: 0 }

    // 새 항목 추가
    s = hear(s, 'CLM-GC001-MUN-LOADING')
    const counts2 = tabItemCounts(s)
    const badges = computeTabBadges(counts2, seen)

    expect(badges.testimony).toBe(1)
  })

  it('항목이 0 이면 알림이 없다', () => {
    const s = createInquiry()
    const counts = tabItemCounts(s)
    const seen = { overview: 0, testimony: 0, evidence: 0, timeline: 0, deduction: 0 }
    const badges = computeTabBadges(counts, seen)

    expect(Object.keys(badges)).toHaveLength(0)
  })

  it('DOM 에 data-badge 속성이 붙고 aria-label 에 새 항목 수가 있다', () => {
    let s = createInquiry()
    s = hear(s, 'CLM-GC001-RYU-LEFT')
    s = hear(s, 'CLM-GC001-MUN-LOADING')

    const counts = tabItemCounts(s)
    const badges: TabBadges = { testimony: 2, timeline: 2 }
    const v = inquiryView(s, src, shakyClaims(s), 'overview', badges)
    const root = renderInquiry(v, handlers())

    const testimonyTab = root.querySelector('[data-tab="testimony"]')!
    expect(testimonyTab.getAttribute('data-badge')).toBe('2')
    expect(testimonyTab.getAttribute('aria-label')).toContain('새 항목 2건')
    expect(testimonyTab.classList.contains('has-new')).toBe(true)
    expect(testimonyTab.querySelector('.iq-tab-badge')!.textContent).toBe('2')
  })

  it('배지가 0 이면 data-badge 도 .iq-tab-badge 도 없다', () => {
    const s = createInquiry()
    const v = inquiryView(s, src, shakyClaims(s), 'overview', {})
    const root = renderInquiry(v, handlers())

    const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    for (const tab of tabs) {
      expect(tab.getAttribute('data-badge')).toBeNull()
      expect(tab.querySelector('.iq-tab-badge')).toBeNull()
      expect(tab.classList.contains('has-new')).toBe(false)
    }
  })
})
