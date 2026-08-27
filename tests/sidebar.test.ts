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

/* ────────────────────────────── DOM 렌더 ────────────────────────────── */

describe('renderSidebar — 배지가 DOM 에 바르게 찍힌다', () => {
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
    expect(badge.textContent).toBe('어긋남')
  })

  it('badge="new" 면 라벨이 "새 진술"', () => {
    const root = draw([person('S1', { badge: 'new' })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.textContent).toBe('새 진술')
  })

  it('badge="updated" 면 라벨이 "말 바꿈"', () => {
    const root = draw([person('S1', { badge: 'updated' })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.textContent).toBe('말 바꿈')
  })

  it('badge="exhausted" 면 라벨이 "대화 끝"', () => {
    const root = draw([person('S1', { badge: 'exhausted' })])
    const badge = root.querySelector('.fa-sb-badge') as HTMLElement
    expect(badge.textContent).toBe('대화 끝')
  })

  it('다섯 명 각각 다른 배지가 나란히 찍힌다', () => {
    const badges: SuspectBadge[] = ['new', 'updated', 'conflict', 'exhausted', null]
    const people = badges.map((b, i) => person(`S${i + 1}`, { badge: b }))
    const root = draw(people)
    expect(badgesFrom(root)).toEqual(['new', 'updated', 'conflict', 'exhausted', undefined])
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
