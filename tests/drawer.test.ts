/**
 * 드로어(수첩) — **껍데기의 계약만** 잠근다.
 *
 * 그림(세 상태의 위치·반짝임·표지 젖힘)은 CSS 가 소유하므로 헤드리스가 못 본다.
 * 여기서 지키는 것은 **틀리면 조용히 새는 것들**이다:
 *   ① 열림/닫힘이 콜백과 한 번씩만 짝지어지는가
 *   ② `Esc` 와 막(바깥) 클릭이 닫는가
 *   ③ **`dispose()` 뒤에 리스너가 하나도 안 남는가** — 이 저장소의 누수 이력이 이 파일의 이유다
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNotebookDrawer } from '../src/ui/drawer'

const esc = (): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}
const click = (sel: string): void => {
  const n = document.querySelector(sel)
  if (!n) throw new Error(`없다: ${sel}`)
  n.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('수첩 드로어', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('쉼 상태로 태어난다 — 열려 있지 않고, 안쪽은 inert 다', () => {
    const d = createNotebookDrawer()
    expect(d.isOpen()).toBe(false)
    expect(d.el.classList.contains('is-open')).toBe(false)
    expect(d.el.querySelector('.nbk-leaf')?.hasAttribute('inert')).toBe(true)
    expect(d.el.querySelector('.nbk-grab')?.getAttribute('aria-expanded')).toBe('false')
    d.dispose()
  })

  it('수첩을 누르면 열리고, 콜백은 한 번만 온다', () => {
    const onOpen = vi.fn()
    const d = createNotebookDrawer({ onOpen })
    click('.nbk-grab')
    click('.nbk-grab')          // 열린 뒤 또 눌러도 두 번 열리지 않는다
    expect(d.isOpen()).toBe(true)
    expect(d.el.classList.contains('is-open')).toBe(true)
    expect(d.el.querySelector('.nbk-leaf')?.hasAttribute('inert')).toBe(false)
    expect(onOpen).toHaveBeenCalledTimes(1)
    d.dispose()
  })

  it('Esc 로 닫힌다 — 닫힌 뒤의 Esc 는 아무 일도 하지 않는다', () => {
    const onClose = vi.fn()
    const d = createNotebookDrawer({ onClose })
    d.open()
    esc()
    expect(d.isOpen()).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    esc()
    expect(onClose).toHaveBeenCalledTimes(1)
    d.dispose()
  })

  it('바깥(막)을 누르면 닫힌다', () => {
    const d = createNotebookDrawer()
    d.open()
    click('.nbk-scrim')
    expect(d.isOpen()).toBe(false)
    d.dispose()
  })

  it('닫기 단추로도 닫힌다', () => {
    const d = createNotebookDrawer()
    d.open()
    click('.nbk-x')
    expect(d.isOpen()).toBe(false)
    d.dispose()
  })

  it('내용은 밖에서 주입한다 — 갈아 끼우면 앞의 것이 남지 않는다', () => {
    const d = createNotebookDrawer()
    const a = document.createElement('p'); a.textContent = '첫 장'
    const b = document.createElement('p'); b.textContent = '둘째 장'
    d.setContent(a)
    d.setContent(b)
    const bodyEl = d.el.querySelector('.nbk-body')
    expect(bodyEl?.children.length).toBe(1)
    expect(bodyEl?.textContent).toBe('둘째 장')
    d.dispose()
  })

  it('peek() 는 호버와 같은 자리로 내밀었다 넣는다 (터치에는 호버가 없다)', () => {
    const d = createNotebookDrawer()
    expect(d.el.classList.contains('is-peek')).toBe(false)
    d.peek()
    expect(d.el.classList.contains('is-peek')).toBe(true)
    d.peek(false)
    expect(d.el.classList.contains('is-peek')).toBe(false)
    d.dispose()
  })

  /**
   * 누수 검사 — dispose 뒤에는 **어떤 이벤트도 콜백에 닿지 않아야 한다.**
   * 특히 `Esc` 는 document 에 붙는 전역 리스너라, 잊으면 화면을 떠난 수첩이
   * 계속 키를 먹는다(이 저장소가 실제로 겪은 사고 유형).
   */
  it('dispose 가 DOM 과 리스너를 함께 걷어 간다', () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const d = createNotebookDrawer({ onOpen, onClose })
    const grab = d.el.querySelector('.nbk-grab')!
    const scrimEl = d.el.querySelector('.nbk-scrim')!
    d.open()
    d.dispose()

    expect(d.el.isConnected).toBe(false)
    expect(document.querySelector('.nbk')).toBe(null)

    esc()
    grab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    scrimEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(0)     // 열린 채 dispose 는 "닫힘" 이 아니다
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(d.isOpen()).toBe(false)
  })

  it('dispose 뒤의 open/close/setContent 는 조용히 아무 일도 하지 않는다', () => {
    const onOpen = vi.fn()
    const d = createNotebookDrawer({ onOpen })
    d.dispose()
    d.dispose()                                   // 두 번 불러도 안전
    d.open()
    d.close()
    d.setContent(document.createElement('p'))
    expect(onOpen).toHaveBeenCalledTimes(0)
    expect(d.isOpen()).toBe(false)
  })

  it('여러 장을 동시에 세워도 서로를 밟지 않는다', () => {
    const a = createNotebookDrawer({ label: '수사일지' })
    const b = createNotebookDrawer({ label: '증거철' })
    a.open()
    expect(a.isOpen()).toBe(true)
    expect(b.isOpen()).toBe(false)
    a.dispose()
    expect(document.querySelectorAll('.nbk').length).toBe(1)
    b.dispose()
    expect(document.querySelectorAll('.nbk').length).toBe(0)
  })
})

/**
 * **열린 동안 뒤 화면을 봉한다** (감사 확정건 — 막은 클릭만 막고 Tab 은 통과했다).
 * 실측(브라우저, Tab 12회): 봉인 전에는 칠판·사이드바·「최종 추론」까지 포커스가 나갔다.
 * 봉인 뒤에는 문서 경계(BODY) 한 번을 빼면 전부 수첩 안에 머문다.
 */
describe('수첩 드로어 — 뒤 화면 봉인', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('열면 형제에게 inert 가 걸리고, 닫으면 우리가 건 것만 풀린다', () => {
    const app = document.createElement('div')
    app.id = 'app'
    document.body.appendChild(app)
    // 남의 모달 — 원래부터 inert 였다. 우리가 닫을 때 이것까지 풀면 그쪽이 새기 시작한다
    const other = document.createElement('div')
    other.setAttribute('inert', '')
    document.body.appendChild(other)

    const d = createNotebookDrawer()
    d.open()
    expect(app.hasAttribute('inert')).toBe(true)
    expect(app.dataset.nbkSealed).toBe('1')
    expect(other.dataset.nbkSealed).toBeUndefined()

    d.close()
    expect(app.hasAttribute('inert')).toBe(false)
    expect(app.dataset.nbkSealed).toBeUndefined()
    expect(other.hasAttribute('inert')).toBe(true)     // 남의 것은 그대로 둔다
    d.dispose()
  })

  it('열린 채 dispose 해도 봉인이 남지 않는다', () => {
    const app = document.createElement('div')
    document.body.appendChild(app)
    const d = createNotebookDrawer()
    d.open()
    expect(app.hasAttribute('inert')).toBe(true)
    d.dispose()
    expect(app.hasAttribute('inert')).toBe(false)
    expect(document.querySelectorAll('[data-nbk-sealed]').length).toBe(0)
  })

  it('자기 뿌리에는 inert 를 걸지 않는다 — 걸면 수첩 자신이 죽는다', () => {
    const d = createNotebookDrawer()
    d.open()
    expect(d.el.hasAttribute('inert')).toBe(false)
    expect(d.el.querySelector('.nbk-leaf')?.hasAttribute('inert')).toBe(false)
    d.dispose()
  })
})
