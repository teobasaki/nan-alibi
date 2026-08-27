/**
 * 프로파일링 문서 테스트 (팀 3.2.5).
 *
 * - 탭 4개의 이름·순서
 * - 진상(truth·isCulprit)이 새지 않는다
 * - 데이터 없는 칸은 그리지 않는다
 */
import { describe, expect, it, vi } from 'vitest'
import {
  PROFILE_TABS, profileView, renderProfile,
  type ProfileHandlers, type ProfileSource, type ProfileView,
} from '../src/ui/profile'

/* ── 테스트 픽스처 ── */

const baseSource: ProfileSource = {
  suspect: { id: 'S1', name: '류나린', age: 41, job: '전시 운영 책임자', relation: '반입 기록과 폐관 운영을 관장에게 보고해 왔다' },
  portraitUrl: '/img/s1.png',
  background: [
    '라음 사립 갤러리의 전시 운영 책임자',
    '반입 기록과 폐관 운영을 피해자에게 보고하는 위치',
    '피해자와 8년 이상 협력해 온 운영 담당자',
  ],
  personality: '묻는 말에만 정확히 답하고 한 마디도 더 붙이지 않는다. 종이를 내밀면 그제야 문장이 길어진다.',
  knownFacts: ['피해자는 성인 관장 한라온이다.', '발견 시각은 21:21이다.'],
  relations: [
    { name: '한라온(피해자)', description: '피해자와 8년 이상 협력해 온 운영 책임자' },
    { name: '배지호', description: '업무 협력 / 상사' },
  ],
  evidenceCount: { count: 4 },
  timeline: [
    { time: '21:00', text: '전시홀 입장', warned: false },
    { time: '21:04', text: '반입문으로 나갔다고 주장', warned: true },
    { time: '21:22', text: '호출을 받고 복귀', warned: false },
  ],
  testimonies: [
    { text: '해임 통지의 수신자는 류나린이었다.', from: '배지호' },
  ],
  memo: ['예산 갈등?', '21:10 공백이 핵심!'],
}

const emptySource: ProfileSource = {
  suspect: { id: 'S4', name: '도율', age: 52, job: '작품 보존 담당', relation: '전시 받침대의 상태 점검을 맡아 왔다' },
  portraitUrl: null,
  background: [],
  personality: null,
  knownFacts: [],
  relations: [],
  evidenceCount: null,
  timeline: [],
  testimonies: [],
  memo: [],
}

const handlers: ProfileHandlers = {
  changeTab: vi.fn(),
  close: vi.fn(),
  interrogate: vi.fn(),
  openEvidence: vi.fn(),
  setMemo: vi.fn(),
}

const view = (src: ProfileSource = baseSource, tab: 'profile' | 'timeline' | 'testimony' | 'notes' = 'profile') =>
  profileView(src, tab)
const draw = (src: ProfileSource = baseSource, tab: 'profile' | 'timeline' | 'testimony' | 'notes' = 'profile') =>
  renderProfile(view(src, tab), handlers)

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 탭 4개의 이름·순서
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('탭 4개의 이름·순서', () => {
  it('PROFILE_TABS 배열의 순서는 PROFILE → TIMELINE → TESTIMONY → NOTES', () => {
    expect(PROFILE_TABS.map((t) => t.id)).toEqual([
      'profile', 'timeline', 'testimony', 'notes',
    ])
  })

  it('탭 라벨은 영문 대문자 PROFILE · TIMELINE · TESTIMONY · NOTES', () => {
    expect(PROFILE_TABS.map((t) => t.label)).toEqual([
      'PROFILE', 'TIMELINE', 'TESTIMONY', 'NOTES',
    ])
  })

  it('북마크는 01 프로파일 · 02 타임라인 · 03 증언 · 04 메모', () => {
    expect(PROFILE_TABS.map((t) => t.bookmark)).toEqual([
      '01 프로파일', '02 타임라인', '03 증언', '04 메모',
    ])
  })

  it('DOM 에 렌더된 탭 버튼도 같은 순서다', () => {
    const root = draw()
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    expect(tabs.map((b) => b.getAttribute('data-tab'))).toEqual([
      'profile', 'timeline', 'testimony', 'notes',
    ])
  })

  it('DOM 에 렌더된 탭 라벨이 시안과 같다', () => {
    const root = draw()
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    expect(tabs.map((b) => b.textContent)).toEqual([
      'PROFILE', 'TIMELINE', 'TESTIMONY', 'NOTES',
    ])
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 진상이 새지 않는다
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('진상이 새지 않는다 (불변식 1)', () => {
  it('DOM 텍스트에 truth 단어가 없다', () => {
    const root = draw()
    const text = root.textContent ?? ''
    expect(text).not.toContain('truth')
    expect(text).not.toContain('Truth')
  })

  it('DOM 텍스트에 범인 여부가 노출되지 않는다', () => {
    const root = draw()
    const text = root.textContent ?? ''
    expect(text).not.toContain('범인')
    expect(text).not.toContain('isCulprit')
    expect(text).not.toContain('culprit')
    expect(text).not.toContain('거짓말')
    expect(text).not.toContain('lieSlots')
  })

  it('ProfileView 에 truth·isCulprit·lieSlots 필드가 없다', () => {
    const v = view()
    const keys = Object.keys(v)
    expect(keys).not.toContain('truth')
    expect(keys).not.toContain('isCulprit')
    expect(keys).not.toContain('lieSlots')
    expect(keys).not.toContain('culprit')
  })

  it('타임라인 ⚠ 표시는 warned 플래그로만 결정된다 (진상 아님)', () => {
    const root = draw()
    const warns = Array.from(root.querySelectorAll('.pf-tl-warn'))
    // baseSource 에 warned:true 인 항목 1개
    expect(warns.length).toBe(1)
    expect(warns[0]!.textContent).toContain('⚠')
    expect(warns[0]!.textContent).toContain('21:04')
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 데이터 없는 칸은 그리지 않는다
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('데이터 없는 칸은 그리지 않는다', () => {
  it('portraitUrl 이 null 이면 이미지를 그리지 않는다', () => {
    const root = draw(emptySource)
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('.pf-portrait-clip')).toBeNull()
  })

  it('relations 가 빈 배열이면 관계 표를 그리지 않는다', () => {
    const root = draw(emptySource)
    expect(root.querySelector('.pf-relations')).toBeNull()
  })

  it('evidenceCount 가 null 이면 관련 증거 버튼이 없다', () => {
    const root = draw(emptySource)
    expect(root.querySelector('.pf-evidence-btn')).toBeNull()
  })

  it('timeline 이 비어 있으면 "아직 확인된 시각이 없다" 안내문만 있다', () => {
    const root = draw(emptySource)
    const tlSection = root.querySelectorAll('.pf-bottom-section')[0]
    expect(tlSection?.textContent).toContain('아직 확인된 시각이 없다')
    expect(root.querySelectorAll('.pf-timeline-item').length).toBe(0)
  })

  it('testimonies 가 비어 있으면 "아직 확보된 증언이 없다" 안내문만 있다', () => {
    const root = draw(emptySource)
    const sections = root.querySelectorAll('.pf-bottom-section')
    const testSec = sections[1]
    expect(testSec?.textContent).toContain('아직 확보된 증언이 없다')
    expect(root.querySelectorAll('.pf-testimony-quote').length).toBe(0)
  })

  it('memo 가 비어 있으면 "아직 메모가 없다" 안내문만 있다', () => {
    const root = draw(emptySource)
    const sections = root.querySelectorAll('.pf-bottom-section')
    const memoSec = sections[2]
    expect(memoSec?.textContent).toContain('아직 메모가 없다')
    expect(root.querySelectorAll('.pf-memo-item').length).toBe(0)
  })

  it('TIMELINE 탭도 비어 있으면 안내문만', () => {
    const root = draw(emptySource, 'timeline')
    expect(root.textContent).toContain('아직 확인된 시각이 없다')
    expect(root.querySelector('.pf-full-timeline')).toBeNull()
  })

  it('TESTIMONY 탭도 비어 있으면 안내문만', () => {
    const root = draw(emptySource, 'testimony')
    expect(root.textContent).toContain('아직 확보된 증언이 없다')
  })

  it('background 가 빈 배열이면 배경 섹션을 그리지 않는다', () => {
    const root = draw(emptySource)
    expect(root.querySelector('.pf-background')).toBeNull()
  })

  it('personality 가 null 이면 성격 섹션을 그리지 않는다', () => {
    const root = draw(emptySource)
    expect(root.querySelector('.pf-personality')).toBeNull()
  })

  it('knownFacts 가 빈 배열이면 알려진 사실 섹션을 그리지 않는다', () => {
    const root = draw(emptySource)
    expect(root.querySelector('.pf-known-facts')).toBeNull()
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 핸들러 동작
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('핸들러 동작', () => {
  it('닫기 버튼 클릭 시 close() 호출', () => {
    const close = vi.fn()
    const root = renderProfile(view(), { ...handlers, close })
    const btn = root.querySelector('.pf-close') as HTMLButtonElement
    btn.click()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('심문하기 버튼 클릭 시 interrogate(id) 호출', () => {
    const interrogate = vi.fn()
    const root = renderProfile(view(), { ...handlers, interrogate })
    const btn = root.querySelector('.pf-interrogate') as HTMLButtonElement
    btn.click()
    expect(interrogate).toHaveBeenCalledWith('S1')
  })

  it('탭 클릭 시 changeTab(id) 호출', () => {
    const changeTab = vi.fn()
    const root = renderProfile(view(), { ...handlers, changeTab })
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    ;(tabs[1] as HTMLButtonElement).click()
    expect(changeTab).toHaveBeenCalledWith('timeline')
  })

  it('관련 증거 버튼 클릭 시 openEvidence(id) 호출', () => {
    const openEvidence = vi.fn()
    const root = renderProfile(view(), { ...handlers, openEvidence })
    const btn = root.querySelector('.pf-evidence-btn') as HTMLButtonElement
    btn.click()
    expect(openEvidence).toHaveBeenCalledWith('S1')
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 데이터가 있을 때 올바르게 렌더
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('데이터가 있을 때 올바르게 렌더', () => {
  it('이름·나이·직책이 정의목록에 있다', () => {
    const root = draw()
    const text = root.textContent ?? ''
    expect(text).toContain('류나린')
    expect(text).toContain('41세')
    expect(text).toContain('전시 운영 책임자')
  })

  it('초상이 있으면 img 와 클립이 있다', () => {
    const root = draw()
    const img = root.querySelector('img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toContain('/img/s1.png')
    expect(root.querySelector('.pf-portrait-clip')).not.toBeNull()
  })

  it('관계 표에 행이 렌더된다', () => {
    const root = draw()
    const rows = root.querySelectorAll('.pf-relation-row')
    expect(rows.length).toBe(2)
    expect(rows[0]!.textContent).toContain('한라온')
  })

  it('배경이 있으면 배경 섹션이 그려진다', () => {
    const root = draw()
    const bgBox = root.querySelector('.pf-background')
    expect(bgBox).not.toBeNull()
    expect(bgBox!.textContent).toContain('배경')
    const items = bgBox!.querySelectorAll('.pf-background-item')
    expect(items.length).toBe(3)
    expect(items[0]!.textContent).toContain('라음 사립 갤러리의 전시 운영 책임자')
  })

  it('성격이 있으면 성격 섹션이 그려진다', () => {
    const root = draw()
    const perBox = root.querySelector('.pf-personality')
    expect(perBox).not.toBeNull()
    expect(perBox!.textContent).toContain('성격')
    expect(perBox!.textContent).toContain('묻는 말에만 정확히 답하고')
  })

  it('알려진 사실이 있으면 섹션이 그려진다', () => {
    const root = draw()
    const factsBox = root.querySelector('.pf-known-facts')
    expect(factsBox).not.toBeNull()
    expect(factsBox!.textContent).toContain('알려진 사실')
    const items = factsBox!.querySelectorAll('.pf-fact-item')
    expect(items.length).toBe(2)
    expect(items[0]!.textContent).toContain('피해자는 성인 관장 한라온이다.')
  })

  it('타임라인에 시각·텍스트가 있다', () => {
    const root = draw()
    const items = root.querySelectorAll('.pf-timeline-item')
    expect(items.length).toBe(3)
    expect(items[0]!.textContent).toContain('21:00')
    expect(items[0]!.textContent).toContain('전시홀 입장')
  })

  it('증언에 인용문과 출처가 있다', () => {
    const root = draw()
    expect(root.textContent).toContain('해임 통지의 수신자는 류나린이었다.')
    expect(root.textContent).toContain('배지호')
  })

  it('메모 항목이 있다', () => {
    const root = draw()
    const memos = root.querySelectorAll('.pf-memo-item')
    expect(memos.length).toBe(2)
    expect(memos[0]!.textContent).toContain('예산 갈등?')
  })

  it('프로파일링 문서 제목이 있다', () => {
    const root = draw()
    expect(root.querySelector('.pf-title')?.textContent).toBe('프로파일링 문서')
  })
})

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 배경·성격·알려진 사실 칸의 불변식
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
describe('배경·성격·알려진 사실 — 진상이 새지 않는다', () => {
  const TRUTH_WORDS = ['범인', 'culprit', 'isCulprit', '거짓말', 'lie', 'lieSlots', '동기', 'motive'] as const

  it('배경·성격 DOM 텍스트에 진상 낙말이 없다', () => {
    const root = draw()
    const bgText = root.querySelector('.pf-background')?.textContent ?? ''
    const perText = root.querySelector('.pf-personality')?.textContent ?? ''
    const factsText = root.querySelector('.pf-known-facts')?.textContent ?? ''
    const all = bgText + perText + factsText
    for (const w of TRUTH_WORDS) {
      expect(all, `DOM 에 '${w}' 노출`).not.toContain(w)
    }
  })

  it('ProfileView 에 배경·성격·알려진 사실 필드가 있다', () => {
    const v = view()
    expect(v).toHaveProperty('background')
    expect(v).toHaveProperty('personality')
    expect(v).toHaveProperty('knownFacts')
  })
})
