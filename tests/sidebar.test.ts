/**
 * 사이드바 상태 배지 — 「지금 이 사람에게 무엇이 생겼는가」를 한 눈에 보여준다.
 *
 * ## 계약
 * - 배지는 **판정이 아니라 표시다.** 범인을 가리키거나 용의자를 소거하지 않는다.
 * - 배지에 truth·isCulprit·lieSlots 가 노출되지 않는다.
 * - 배지는 data-badge 속성과 .on 클래스로 드러나 테스트가 잡을 수 있다.
 * - 상태 라벨에 '범인'·'거짓'·'무죄'·'유죄' 라는 낱말이 없다.
 */
import { describe, expect, it } from 'vitest'
import { computeBadge, renderSidebar, updateSidebar, type SidebarSuspect, type SuspectBadge } from '../src/ui/sidebar'
import { TALK_CAP } from '../src/data/config'

/* ────────────────────────────── 헬퍼 ────────────────────────────── */

function person(id: string, overrides: Partial<SidebarSuspect> = {}): SidebarSuspect {
  return {
    id,
    name: `사람${id}`,
    age: 30,
    job: '직업',
    portrait: null,
    active: false,
    talked: 0,
    talkCap: TALK_CAP,
    badge: null,
    ...overrides,
  }
}

const handlers = () => ({ pick: () => {}, openProfile: () => {} })

function draw(people: SidebarSuspect[]) {
  return renderSidebar(people, handlers())
}

function badgesFrom(root: HTMLElement): (string | undefined)[] {
  return Array.from(root.querySelectorAll('.fa-sb-badge')).map(
    (el) => (el as HTMLElement).dataset.badge,
  )
}

/* ────────────────────────────── computeBadge 단위 ────────────────────────────── */

describe('computeBadge — 엔진 신호에서 배지를 파생한다', () => {
  it('아무 일도 없으면 null', () => {
    expect(computeBadge(0, TALK_CAP, false, false, false)).toBeNull()
  })

  it('심문 후 새 진술이 있으면 "new"', () => {
    expect(computeBadge(1, TALK_CAP, true, false, false)).toBe('new')
  })

  it('어긋남이 있으면 "conflict" — 가장 높은 우선순위', () => {
    expect(computeBadge(2, TALK_CAP, true, true, true)).toBe('conflict')
  })

  it('말을 고쳤으면 "updated" — conflict 보다 낮다', () => {
    expect(computeBadge(3, TALK_CAP, true, false, true)).toBe('updated')
  })

  it('대화를 모두 소진하면 "exhausted"', () => {
    expect(computeBadge(TALK_CAP, TALK_CAP, false, false, false)).toBe('exhausted')
  })

  it('new 와 exhausted 가 동시면 exhausted 가 아닌 new 를 보여준다', () => {
    // hasAnyClaim 이 true 이면서 대화 소진이면 new 가 우선
    expect(computeBadge(TALK_CAP, TALK_CAP, true, false, false)).toBe('new')
  })
})

/* ────────────────────────────── DOM 렌더 — 상태 칩 ────────────────────────────── */

describe('renderSidebar — 상태 칩이 DOM 에 바르게 찍힌다', () => {
  it('badge=null 이면 .fa-sb-badge 는 .on 이 없고 data-badge 도 없다', () => {
    const root = draw([person('S1', { badge: null })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.classList.contains('on')).toBe(false)
    expect(badge.dataset.badge).toBeUndefined()
    expect(badge.textContent).toBe('')
  })

  it('badge="conflict" 면 data-badge="conflict" 와 .on 이 붙는다', () => {
    const root = draw([person('S1', { badge: 'conflict' })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.classList.contains('on')).toBe(true)
    expect(badge.dataset.badge).toBe('conflict')
    expect(badge.textContent).toContain('진술 충돌')
    expect(badge.textContent).toContain('⚠')
  })

  it('badge="new" 면 라벨이 "정보 갱신" 아이콘 "●"', () => {
    const root = draw([person('S1', { badge: 'new' })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.textContent).toContain('정보 갱신')
    expect(badge.textContent).toContain('●')
  })

  it('badge="updated" 면 라벨이 "정보 갱신" 아이콘 "●"', () => {
    const root = draw([person('S1', { badge: 'updated' })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.textContent).toContain('정보 갱신')
    expect(badge.textContent).toContain('●')
  })

  it('badge="exhausted" 면 라벨이 "심문 완료" 아이콘 "✓"', () => {
    const root = draw([person('S1', { badge: 'exhausted' })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.textContent).toContain('심문 완료')
    expect(badge.textContent).toContain('✓')
  })

  it('다섯 명 각각 다른 배지가 나란히 찍힌다', () => {
    const badges: SuspectBadge[] = ['new', 'updated', 'conflict', 'exhausted', null]
    const people = badges.map((b, i) => person(`S${i + 1}`, { badge: b }))
    const root = draw(people)
    expect(badgesFrom(root)).toEqual(['new', 'updated', 'conflict', 'exhausted', undefined])
  })
})

/* ────────────────────────────── DOM 렌더 — 번호 배지 01~05 ────────────────────────────── */

describe('renderSidebar — 번호 배지가 순서대로 01~05 로 붙는다', () => {
  it('5명이면 01, 02, 03, 04, 05 순서', () => {
    const people = Array.from({ length: 5 }, (_, i) => person(`S${i + 1}`))
    const root = draw(people)
    const nums = Array.from(root.querySelectorAll('.fa-sb-num')).map(
      (el) => (el as HTMLElement).textContent,
    )
    expect(nums).toEqual(['01', '02', '03', '04', '05'])
  })

  it('번호 배지에 data-num 속성이 올바르게 붙는다', () => {
    const people = Array.from({ length: 5 }, (_, i) => person(`S${i + 1}`))
    const root = draw(people)
    const dataAttrs = Array.from(root.querySelectorAll('.fa-sb-num')).map(
      (el) => (el as HTMLElement).dataset.num,
    )
    expect(dataAttrs).toEqual(['01', '02', '03', '04', '05'])
  })

  it('3명이면 01, 02, 03 (인원 수에 구애되지 않는다)', () => {
    const people = Array.from({ length: 3 }, (_, i) => person(`S${i + 1}`))
    const root = draw(people)
    const nums = Array.from(root.querySelectorAll('.fa-sb-num')).map(
      (el) => (el as HTMLElement).textContent,
    )
    expect(nums).toEqual(['01', '02', '03'])
  })

  it('번호 배지는 aria-hidden 이다 (정보 누출 방지)', () => {
    const people = [person('S1')]
    const root = draw(people)
    const numEl = root.querySelector('.fa-sb-num') as HTMLElement
    expect(numEl.getAttribute('aria-hidden')).toBe('true')
  })
})

/* ────────────────────────────── updateSidebar — 배지 갱신 ────────────────────────────── */

describe('updateSidebar — 배지가 갱신 시에도 올바르게 반영된다', () => {
  it('badge 가 null→conflict 로 바뀌면 DOM 에 반영된다', () => {
    const p = [person('S1', { badge: null }), person('S2')]
    const root = draw(p)
    const updated = [person('S1', { badge: 'conflict' }), person('S2')]
    expect(updateSidebar(root, updated)).toBe(true)
    const badge = root.querySelector('[data-id="S1"] .fa-sb-badge') as HTMLElement
    expect(badge.dataset.badge).toBe('conflict')
    expect(badge.classList.contains('on')).toBe(true)
  })

  it('badge 가 conflict→null 로 내려가면 DOM 에서 배지가 사라진다', () => {
    const p = [person('S1', { badge: 'conflict' })]
    const root = draw(p)
    expect(updateSidebar(root, [person('S1', { badge: null })])).toBe(true)
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.classList.contains('on')).toBe(false)
    expect(badge.dataset.badge).toBeUndefined()
  })

  it('updateSidebar 후에도 번호 배지가 유지된다', () => {
    const people = [person('S1'), person('S2')]
    const root = draw(people)
    updateSidebar(root, [person('S1', { talked: 3 }), person('S2', { badge: 'new' })])
    const nums = Array.from(root.querySelectorAll('.fa-sb-num')).map(
      (el) => (el as HTMLElement).textContent,
    )
    expect(nums).toEqual(['01', '02'])
  })
})

/* ────────────────────────────── 불변식: 진상이 새지 않는다 ────────────────────────────── */

describe('배지에 진상(truth)이 새지 않는다 (불변식 1·4)', () => {
  it('어떤 배지 라벨에도 "범인" "거짓" "무죄" "유죄" 가 없다', () => {
    const allBadges: SuspectBadge[] = ['new', 'updated', 'conflict', 'exhausted']
    const people = allBadges.map((b, i) => person(`S${i + 1}`, { badge: b }))
    const root = draw(people)
    const text = root.textContent ?? ''
    for (const banned of ['범인', '거짓', '무죄', '유죄', 'culprit', 'truth', 'liar']) {
      expect(text.toLowerCase()).not.toContain(banned)
    }
  })

  it('SidebarSuspect 인터페이스에 truth·isCulprit·lieSlots 필드가 없다', () => {
    // 컴파일 타임 보장이지만 런타임에서도 확인 — person 에 없는 키를 넘겨도 무시된다
    const p = person('S1', { badge: 'conflict' })
    expect('truth' in p).toBe(false)
    expect('isCulprit' in p).toBe(false)
    expect('lieSlots' in p).toBe(false)
  })

  it('computeBadge 는 truth 를 인자로 받지 않는다 — 시그니처에 없다', () => {
    // computeBadge 의 인자는 5개: talked, talkCap, hasAnyClaim, hasShakyClaim, hasRevisedClaim
    expect(computeBadge.length).toBe(5)
  })
})

/* ────────────────────────────── 파일철 머리글 ────────────────────────────── */

describe('파일철 — 시안 대조', () => {
  it('파일철 캡션에 "용의자 목록" 이 있다', () => {
    const root = draw([person('S1')])
    const title = root.querySelector('.fa-sb-fold-t') as HTMLElement
    expect(title.textContent).toBe('용의자 목록')
  })

  it('CONFIDENTIAL 도장 요소가 있다', () => {
    const root = draw([person('S1')])
    const stamp = root.querySelector('.fa-sb-fold-stamp') as HTMLElement
    expect(stamp).not.toBeNull()
    expect(stamp.textContent).toBe('CONFIDENTIAL')
    expect(stamp.getAttribute('aria-hidden')).toBe('true')
  })
})

/* ────────────────────────────── 수치 배지: 관련 단서 수 · 진술 변화 수 (3.2.16 2단계) ── */

describe('수치 배지 — 관련 단서 수 (relatedClueCount)', () => {
  it('relatedClueCount 가 0 이면 .fa-sb-stat-clue 는 비어 있고 aria-label 이 없다', () => {
    const root = draw([person('S1', { relatedClueCount: 0 })])
    const clue = root.querySelector('.fa-sb-stat-clue') as HTMLElement
    expect(clue.textContent).toBe('')
    expect(clue.classList.contains('on')).toBe(false)
    expect(clue.getAttribute('aria-label')).toBeNull()
  })

  it('relatedClueCount 를 생략해도(기본값 0) 그리지 않는다', () => {
    const root = draw([person('S1')])
    const clue = root.querySelector('.fa-sb-stat-clue') as HTMLElement
    expect(clue.textContent).toBe('')
    expect(clue.classList.contains('on')).toBe(false)
  })

  it('relatedClueCount=3 이면 「단서 3」이 보이고 aria-label 에 수치가 있다', () => {
    const root = draw([person('S1', { relatedClueCount: 3 })])
    const clue = root.querySelector('.fa-sb-stat-clue') as HTMLElement
    expect(clue.textContent).toBe('단서 3')
    expect(clue.classList.contains('on')).toBe(true)
    expect(clue.getAttribute('aria-label')).toBe('관련 단서 3건')
  })

  it('relatedClueCount=1 최소값에서도 표시된다', () => {
    const root = draw([person('S1', { relatedClueCount: 1 })])
    const clue = root.querySelector('.fa-sb-stat-clue') as HTMLElement
    expect(clue.textContent).toBe('단서 1')
    expect(clue.getAttribute('aria-label')).toBe('관련 단서 1건')
  })
})

describe('수치 배지 — 진술 변화 수 (statementChangeCount)', () => {
  it('statementChangeCount 가 0 이면 .fa-sb-stat-change 는 비어 있다', () => {
    const root = draw([person('S1', { statementChangeCount: 0 })])
    const change = root.querySelector('.fa-sb-stat-change') as HTMLElement
    expect(change.textContent).toBe('')
    expect(change.classList.contains('on')).toBe(false)
    expect(change.getAttribute('aria-label')).toBeNull()
  })

  it('statementChangeCount 를 생략해도(기본값 0) 그리지 않는다', () => {
    const root = draw([person('S1')])
    const change = root.querySelector('.fa-sb-stat-change') as HTMLElement
    expect(change.textContent).toBe('')
    expect(change.classList.contains('on')).toBe(false)
  })

  it('statementChangeCount=1 이면 「말 바뀜 1」이 보이고 aria-label 에 수치가 있다', () => {
    const root = draw([person('S1', { statementChangeCount: 1 })])
    const change = root.querySelector('.fa-sb-stat-change') as HTMLElement
    expect(change.textContent).toBe('말 바뀜 1')
    expect(change.classList.contains('on')).toBe(true)
    expect(change.getAttribute('aria-label')).toBe('진술 변화 1건')
  })

  it('statementChangeCount=5 큰 값에서도 수치가 올바르다', () => {
    const root = draw([person('S1', { statementChangeCount: 5 })])
    const change = root.querySelector('.fa-sb-stat-change') as HTMLElement
    expect(change.textContent).toBe('말 바뀜 5')
    expect(change.getAttribute('aria-label')).toBe('진술 변화 5건')
  })
})

describe('수치 배지 — updateSidebar 에서도 갱신된다', () => {
  it('relatedClueCount 가 0→2 로 바뀌면 DOM 에 반영된다', () => {
    const root = draw([person('S1', { relatedClueCount: 0 })])
    updateSidebar(root, [person('S1', { relatedClueCount: 2 })])
    const clue = root.querySelector('.fa-sb-stat-clue') as HTMLElement
    expect(clue.textContent).toBe('단서 2')
    expect(clue.classList.contains('on')).toBe(true)
    expect(clue.getAttribute('aria-label')).toBe('관련 단서 2건')
  })

  it('statementChangeCount 가 3→0 으로 내려가면 DOM 에서 사라진다', () => {
    const root = draw([person('S1', { statementChangeCount: 3 })])
    updateSidebar(root, [person('S1', { statementChangeCount: 0 })])
    const change = root.querySelector('.fa-sb-stat-change') as HTMLElement
    expect(change.textContent).toBe('')
    expect(change.classList.contains('on')).toBe(false)
    expect(change.getAttribute('aria-label')).toBeNull()
  })
})

describe('수치 배지에 진상이 새지 않는다 (불변식 1·4)', () => {
  it('수치 배지에 "범인" "거짓" "무죄" "유죄" 가 없다', () => {
    const root = draw([
      person('S1', { relatedClueCount: 5, statementChangeCount: 3, badge: 'conflict' }),
    ])
    const text = root.textContent ?? ''
    for (const banned of ['범인', '거짓', '무죄', '유죄', 'culprit', 'truth', 'liar']) {
      expect(text.toLowerCase()).not.toContain(banned)
    }
  })
})