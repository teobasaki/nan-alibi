/**
 * 프로파일링 문서 — 용의자 한 명의 인물 분석 화면 (팀 3.2.5).
 *
 * ## 모듈 경계
 * - **그림만 소유한다.** 데이터는 인자로 받고 순수 변환 + render 구조다.
 * - inquiryPanel.ts 의 inquiryView/renderInquiry 관례를 따른다.
 * - truth·isCulprit·lieSlots 를 보지 않는다 (불변식 1).
 * - 새 이미지 에셋 없음. 초상은 portrait URL 로 외부에서 받는다.
 * - headless 테스트 접근 가능 (DOM 반환).
 */
import '../styles/profile.css'

import type { SuspectId } from '../types'

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 뷰 모델 — 순수 데이터 (진상을 담지 않는다)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export type ProfileTab = 'profile' | 'timeline' | 'testimony' | 'notes'

export const PROFILE_TABS: { id: ProfileTab; label: string; bookmark: string }[] = [
  { id: 'profile', label: 'PROFILE', bookmark: '01 프로파일' },
  { id: 'timeline', label: 'TIMELINE', bookmark: '02 타임라인' },
  { id: 'testimony', label: 'TESTIMONY', bookmark: '03 증언' },
  { id: 'notes', label: 'NOTES', bookmark: '04 메모' },
]

/** 타임라인 항목 하나 — claim 에서 시각이 있는 것만 뽑는다 */
export interface ProfileTimelineItem {
  time: string
  text: string
  /** 플레이어가 이미 알아낸 어긋남 — QUESTIONABLE·CHALLENGED·DISPROVED */
  warned: boolean
}

/** 관계 표의 한 행 */
export interface ProfileRelationRow {
  name: string
  description: string
}

/** 증언 하나 */
export interface ProfileTestimonyRow {
  text: string
  from: string
}

/** 관련 증거 수 */
export interface ProfileEvidenceCount {
  count: number
}

export interface ProfileView {
  id: SuspectId
  name: string
  age: number | null
  job: string | null
  relation: string | null
  /** portrait URL — 밖에서 받는다 (없으면 그리지 않는다) */
  portraitUrl: string | null

  /** 관계 표 (피해자·다른 용의자와의 관계) */
  relations: ProfileRelationRow[]
  /** 관련 증거 수 */
  evidenceCount: ProfileEvidenceCount | null

  /** 인물 타임라인 (시각 있는 claim 에서 뽑음) */
  timeline: ProfileTimelineItem[]
  /** 주요 증언 (최대 2개) */
  testimonies: ProfileTestimonyRow[]
  /** 플레이어 메모 */
  memo: string[]

  activeTab: ProfileTab
}

export interface ProfileHandlers {
  changeTab(tab: ProfileTab): void
  close(): void
  interrogate(id: SuspectId): void
  openEvidence(id: SuspectId): void
  setMemo(memo: string[]): void
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 뷰 모델 조립 (순수 변환 함수)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface ProfileSource {
  suspect: {
    id: SuspectId
    name: string
    age: number
    job: string
    relation: string
  }
  portraitUrl: string | null
  /** 관계 표에 넣을 행들 (피해자 + 다른 용의자) — 데이터가 없으면 빈 배열 */
  relations: ProfileRelationRow[]
  /** 관련 증거 수 (없으면 null) */
  evidenceCount: ProfileEvidenceCount | null
  /** 이 인물의 claim 중 시각이 있는 것들 + 어긋남 여부 */
  timeline: ProfileTimelineItem[]
  /** 이 인물에 대한 / 이 인물이 한 증언 (최대 2개) */
  testimonies: ProfileTestimonyRow[]
  /** 플레이어가 남긴 메모 */
  memo: string[]
}

export function profileView(
  src: ProfileSource,
  activeTab: ProfileTab = 'profile',
): ProfileView {
  return {
    id: src.suspect.id,
    name: src.suspect.name,
    age: src.suspect.age,
    job: src.suspect.job,
    relation: src.suspect.relation,
    portraitUrl: src.portraitUrl,
    relations: src.relations,
    evidenceCount: src.evidenceCount,
    timeline: src.timeline,
    testimonies: src.testimonies,
    memo: src.memo,
    activeTab,
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * DOM 생성 헬퍼
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * PROFILE 탭
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function renderProfileTab(v: ProfileView, on: ProfileHandlers): HTMLElement {
  const page = el('div', 'pf-page')
  page.setAttribute('role', 'tabpanel')

  /* 상단: 사진 + 인적사항 */
  const top = el('div', 'pf-profile-top')

  // 초상 (없으면 안 그린다)
  if (v.portraitUrl) {
    const clipWrap = el('div', 'pf-portrait-clip')
    const img = document.createElement('img')
    img.className = 'pf-portrait'
    img.src = v.portraitUrl
    img.alt = `${v.name} 초상`
    clipWrap.appendChild(img)
    top.appendChild(clipWrap)
  }

  // 인적사항 정의목록
  const info = el('div', 'pf-info')
  const dl = document.createElement('dl')

  const addField = (label: string, value: string | null) => {
    if (value === null || value === undefined) return
    const dt = el('dt', undefined, label)
    const dd = el('dd', undefined, value)
    dl.appendChild(dt)
    dl.appendChild(dd)
  }

  addField('이름', v.name)
  if (v.age !== null) addField('나이', `${v.age}세`)
  if (v.job !== null) addField('직책', v.job)
  if (v.relation !== null) addField('피해자와의 관계', v.relation)

  info.appendChild(dl)
  top.appendChild(info)
  page.appendChild(top)

  /* 관계 표 */
  if (v.relations.length > 0) {
    const relBox = el('div', 'pf-relations')
    relBox.appendChild(el('div', 'pf-relations-title', '관계'))
    for (const r of v.relations) {
      const row = el('div', 'pf-relation-row')
      row.appendChild(el('span', 'pf-relation-name', r.name))
      row.appendChild(el('span', 'pf-relation-desc', r.description))
      relBox.appendChild(row)
    }
    /* 관련 증거 버튼 */
    if (v.evidenceCount && v.evidenceCount.count > 0) {
      const btn = el('button', 'pf-evidence-btn', `관련 증거 ${v.evidenceCount.count}`) as HTMLButtonElement
      btn.type = 'button'
      btn.onclick = () => on.openEvidence(v.id)
      relBox.appendChild(btn)
    }
    page.appendChild(relBox)
  }

  /* 하단 3단: 타임라인 · 증언 · 메모 */
  const grid = el('div', 'pf-bottom-grid')

  // 1) 인물 타임라인
  const tlSec = el('div', 'pf-bottom-section')
  tlSec.appendChild(el('div', 'pf-bottom-title', '인물 타임라인'))
  if (v.timeline.length === 0) {
    tlSec.appendChild(el('div', 'pf-empty', '아직 확인된 시각이 없다.'))
  } else {
    for (const item of v.timeline) {
      const row = el('div', `pf-timeline-item${item.warned ? ' pf-tl-warn' : ''}`)
      row.appendChild(el('span', 'pf-tl-time', item.warned ? `⚠ ${item.time}` : item.time))
      row.appendChild(el('span', 'pf-tl-text', item.text))
      tlSec.appendChild(row)
    }
  }
  grid.appendChild(tlSec)

  // 2) 주요 증언
  const testSec = el('div', 'pf-bottom-section')
  testSec.appendChild(el('div', 'pf-bottom-title', '주요 증언'))
  if (v.testimonies.length === 0) {
    testSec.appendChild(el('div', 'pf-empty', '아직 확보된 증언이 없다.'))
  } else {
    for (const t of v.testimonies) {
      const q = el('div', 'pf-testimony-quote', `"${t.text}"`)
      testSec.appendChild(q)
      testSec.appendChild(el('div', 'pf-testimony-from', `— ${t.from}`))
    }
  }
  grid.appendChild(testSec)

  // 3) 메모
  const memoSec = el('div', 'pf-bottom-section')
  memoSec.appendChild(el('div', 'pf-bottom-title', '메모'))
  if (v.memo.length === 0) {
    memoSec.appendChild(el('div', 'pf-empty', '아직 메모가 없다.'))
  } else {
    for (const m of v.memo) {
      memoSec.appendChild(el('div', 'pf-memo-item', m))
    }
  }
  grid.appendChild(memoSec)

  page.appendChild(grid)

  /* 심문하기 버튼 */
  const btn = el('button', 'pf-interrogate', '심문하기') as HTMLButtonElement
  btn.type = 'button'
  btn.onclick = () => on.interrogate(v.id)
  page.appendChild(btn)

  return page
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * TIMELINE 탭
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function renderTimelineTab(v: ProfileView): HTMLElement {
  const page = el('div', 'pf-page')
  page.setAttribute('role', 'tabpanel')

  if (v.timeline.length === 0) {
    page.appendChild(el('div', 'pf-empty', '아직 확인된 시각이 없다.'))
    return page
  }

  const ul = el('ul', 'pf-full-timeline')
  for (const item of v.timeline) {
    const li = el('li', item.warned ? 'pf-tl-warn' : undefined)
    li.appendChild(el('span', 'pf-tl-time', item.warned ? `⚠ ${item.time}` : item.time))
    li.appendChild(el('span', 'pf-tl-text', item.text))
    ul.appendChild(li)
  }
  page.appendChild(ul)
  return page
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * TESTIMONY 탭
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function renderTestimonyTab(v: ProfileView): HTMLElement {
  const page = el('div', 'pf-page')
  page.setAttribute('role', 'tabpanel')

  if (v.testimonies.length === 0) {
    page.appendChild(el('div', 'pf-empty', '아직 확보된 증언이 없다.'))
    return page
  }

  const wrap = el('div', 'pf-testimony-full')
  for (const t of v.testimonies) {
    const q = el('div', 'pf-testimony-quote', `"${t.text}"`)
    wrap.appendChild(q)
    wrap.appendChild(el('div', 'pf-testimony-from', `— ${t.from}`))
  }
  page.appendChild(wrap)
  return page
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * NOTES 탭
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function renderNotesTab(v: ProfileView, on: ProfileHandlers): HTMLElement {
  const page = el('div', 'pf-page')
  page.setAttribute('role', 'tabpanel')

  const ta = document.createElement('textarea')
  ta.className = 'pf-notes-area'
  ta.value = v.memo.join('\n')
  ta.rows = 8
  ta.placeholder = '이 인물에 대해 떠오른 것을 적어 둔다.'
  ta.setAttribute('aria-label', `${v.name} 메모`)
  ta.onchange = ta.onblur = () => {
    const lines = ta.value.split('\n').filter((l) => l.trim())
    on.setMemo(lines)
  }
  page.appendChild(ta)
  return page
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 메인 렌더
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function renderProfile(v: ProfileView, on: ProfileHandlers): HTMLElement {
  const root = el('div', 'pf')

  /* 헤더: 제목 + 닫기 */
  const header = el('div', 'pf-header')
  header.appendChild(el('span', 'pf-title', '프로파일링 문서'))
  const closeBtn = el('button', 'pf-close', '닫기') as HTMLButtonElement
  closeBtn.type = 'button'
  closeBtn.setAttribute('aria-label', '프로파일링 문서 닫기')
  closeBtn.onclick = () => on.close()
  header.appendChild(closeBtn)
  root.appendChild(header)

  /* 상단 가로 탭 4개 */
  const nav = el('div', 'pf-tabs')
  nav.setAttribute('role', 'tablist')
  for (const t of PROFILE_TABS) {
    const active = v.activeTab === t.id
    const b = el('button', `pf-tab${active ? ' on' : ''}`) as HTMLButtonElement
    b.type = 'button'
    b.dataset.tab = t.id
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-selected', String(active))
    b.textContent = t.label
    b.onclick = () => on.changeTab(t.id)
    nav.appendChild(b)
  }
  root.appendChild(nav)

  /* 오른쪽 세로 북마크 */
  const bookmarks = el('div', 'pf-bookmarks')
  for (const t of PROFILE_TABS) {
    const active = v.activeTab === t.id
    const bm = el('button', `pf-bookmark${active ? ' on' : ''}`) as HTMLButtonElement
    bm.type = 'button'
    bm.textContent = t.bookmark
    bm.onclick = () => on.changeTab(t.id)
    bookmarks.appendChild(bm)
  }
  root.appendChild(bookmarks)

  /* 탭 페이지 */
  let page: HTMLElement
  switch (v.activeTab) {
    case 'profile': page = renderProfileTab(v, on); break
    case 'timeline': page = renderTimelineTab(v); break
    case 'testimony': page = renderTestimonyTab(v); break
    case 'notes': page = renderNotesTab(v, on); break
  }
  root.appendChild(page)

  return root
}
