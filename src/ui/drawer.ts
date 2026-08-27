import '../styles/drawer.css'
/**
 * 수사일지 드로어 — **우측에서 빼꼼 나온 가죽 장정 수첩.**
 *
 * ## 세 상태
 * ```
 *  쉼(idle)   책등만 화면 오른쪽에 걸친다
 *  호버        폭의 45%가 더 나옴 + 빛 반사 → 터치에는 `.is-peek` 으로 내밈
 *  열림        표지 젖혀짐 + 종이 내용 표시 + 우측 번호 인덱스 탭
 * ```
 *
 * ## 이 모듈이 하지 않는 것
 * - 내용을 만들지 않는다 (setContent 로 밖에서 주입)
 * - 판정/상태를 읽거나 쓰지 않는다
 * - 전역 모듈을 import 하지 않는다
 *
 * ## 리스너
 * AbortController 두 개(life, scope). dispose() 가 전부 끊는다.
 */

import type { InquiryTab } from './inquiryPanel'

export interface DrawerHandle {
  el: HTMLElement
  open(): void
  close(): void
  isOpen(): boolean
  setContent(node: HTMLElement): void
  /**
   * 호버와 같은 자리로 내밈/넣음 (터치용 + 새 줄 알림용).
   */
  peek(on?: boolean): void
  /** 우측 인덱스 탭의 활성 상태를 갱신한다 */
  setActiveTab(tab: InquiryTab): void
  dispose(): void
}

export interface DrawerOpts {
  onOpen?(): void
  onClose?(): void
  mount?: HTMLElement
  label?: string
  caption?: string
  hint?: string
  scrim?: boolean
  /** 우측 인덱스 탭 클릭 핸들러 */
  onTabClick?(tab: InquiryTab): void
}

const TABS: { id: InquiryTab; no: string; label: string }[] = [
  { id: 'overview', no: '01', label: '개요' },
  { id: 'evidence', no: '02', label: '증거' },
  { id: 'testimony', no: '03', label: '증언' },
  { id: 'timeline', no: '04', label: '타임라인' },
  { id: 'deduction', no: '05', label: '추론' },
]

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/**
 * 가죽 장정 수사일지를 하나 만들어 화면 오른쪽 가장자리에 꽂는다.
 */
export function createNotebookDrawer(opts: DrawerOpts = {}): DrawerHandle {
  const label = opts.label ?? '수사일지'
  const caption = opts.caption ?? '수사일지'

  /* ── DOM ──────────────────────────────────────────────────────────
   * .nbk
   *   ├ .nbk-scrim
   *   └ .nbk-book
   *       ├ .nbk-ribbon
   *       ├ .nbk-spine (.nbk-title)
   *       ├ .nbk-edges           쌓인 종이 가장자리
   *       ├ .nbk-leaf
   *       │   ├ .nbk-paper       크림색 종이 (머리글 + 본문)
   *       │   └ .nbk-cover       표지 — 열리면 경첩 축으로 젖혀짐
   *       ├ .nbk-idx             우측 번호 인덱스 탭
   *       ├ .nbk-sheen           반짝임
   *       └ .nbk-grab            클릭 영역
   */
  const root = el('div', 'nbk')
  if (opts.scrim === false) root.classList.add('no-scrim')

  const scrim = el('div', 'nbk-scrim')
  root.appendChild(scrim)

  const book = el('div', 'nbk-book')
  book.appendChild(el('div', 'nbk-ribbon'))

  const spine = el('div', 'nbk-spine')
  spine.appendChild(el('span', 'nbk-title', label))
  book.appendChild(spine)

  // 쌓인 종이 가장자리
  book.appendChild(el('div', 'nbk-edges'))

  const leaf = el('div', 'nbk-leaf')
  const paper = el('div', 'nbk-paper')

  const cap = el('div', 'nbk-cap')
  cap.appendChild(el('h2', undefined, caption))
  cap.appendChild(el('span', 'nbk-sub', opts.hint ?? ''))
  const x = el('button', 'nbk-x', '닫기') as HTMLButtonElement
  x.type = 'button'
  x.title = '닫기 (Esc)'
  x.setAttribute('aria-label', `${caption} 닫기`)
  cap.appendChild(x)
  paper.appendChild(cap)

  const body = el('div', 'nbk-body')
  paper.appendChild(body)
  leaf.appendChild(paper)
  leaf.appendChild(el('div', 'nbk-cover'))
  leaf.setAttribute('inert', '')
  book.appendChild(leaf)

  // 우측 번호 인덱스 탭 (01~05)
  const idx = el('nav', 'nbk-idx')
  idx.setAttribute('aria-label', '수사일지 탭 인덱스')
  const tabBtns: HTMLButtonElement[] = []
  for (const t of TABS) {
    const btn = el('button', 'nbk-idx-tab') as HTMLButtonElement
    btn.type = 'button'
    btn.dataset.tab = t.id
    btn.setAttribute('aria-label', `${t.no} ${t.label}`)
    btn.innerHTML = `<span class="nbk-idx-no">${t.no}</span><br><span class="nbk-idx-label">${t.label}</span>`
    btn.addEventListener('click', () => {
      opts.onTabClick?.(t.id)
    })
    tabBtns.push(btn)
    idx.appendChild(btn)
  }
  // Default first tab active
  tabBtns[0]?.classList.add('on')
  book.appendChild(idx)

  const sheen = el('div', 'nbk-sheen')
  sheen.appendChild(el('i'))
  book.appendChild(sheen)

  const grab = el('button', 'nbk-grab') as HTMLButtonElement
  grab.type = 'button'
  grab.setAttribute('aria-label', `${label} 펼치기`)
  grab.setAttribute('aria-expanded', 'false')
  const bodyId = `nbk-body-${Math.round(performance.now() * 1000) % 1e9}`
  body.id = bodyId
  grab.setAttribute('aria-controls', bodyId)
  book.appendChild(grab)

  root.appendChild(book)

  const host = opts.mount ?? document.body
  host.appendChild(root)

  /* ── 상태 ── */
  let open = false
  let dead = false
  const life = new AbortController()
  let scope: AbortController | null = null
  let returnTo: HTMLElement | null = null

  const focus = (n: HTMLElement): void => {
    try { n.focus({ preventScroll: true }) } catch { /* */ }
  }

  const sealBehind = (on: boolean): void => {
    const parent = root.parentElement
    if (!parent) return
    for (const sib of Array.from(parent.children)) {
      if (sib === root || !(sib instanceof HTMLElement)) continue
      if (on) {
        if (sib.hasAttribute('inert')) continue
        sib.setAttribute('inert', '')
        sib.dataset.nbkSealed = '1'
      } else if (sib.dataset.nbkSealed) {
        sib.removeAttribute('inert')
        delete sib.dataset.nbkSealed
      }
    }
  }

  const doOpen = (): void => {
    if (dead || open) return
    open = true
    scope = new AbortController()
    document.addEventListener('keydown', onKey, { signal: scope.signal })

    root.classList.add('is-open')
    leaf.removeAttribute('inert')
    grab.setAttribute('aria-expanded', 'true')
    grab.tabIndex = -1
    sealBehind(true)

    const act = document.activeElement
    returnTo = act instanceof HTMLElement && act !== document.body ? act : null
    focus(x)
    opts.onOpen?.()
  }

  const doClose = (): void => {
    if (dead || !open) return
    open = false
    scope?.abort()
    scope = null

    root.classList.remove('is-open')
    leaf.setAttribute('inert', '')
    grab.setAttribute('aria-expanded', 'false')
    grab.tabIndex = 0
    sealBehind(false)

    if (book.contains(document.activeElement)) focus(returnTo?.isConnected ? returnTo : grab)
    returnTo = null
    opts.onClose?.()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()
    e.preventDefault()
    doClose()
  }

  grab.addEventListener('click', doOpen, { signal: life.signal })
  x.addEventListener('click', doClose, { signal: life.signal })
  scrim.addEventListener('click', doClose, { signal: life.signal })

  return {
    el: root,
    open: doOpen,
    close: doClose,
    isOpen: () => open,
    setContent(node: HTMLElement) {
      if (dead) return
      while (body.firstChild) body.removeChild(body.firstChild)
      body.appendChild(node)
    },
    peek(on = true) {
      if (dead) return
      root.classList.toggle('is-peek', on)
    },
    setActiveTab(tab: InquiryTab) {
      if (dead) return
      for (const btn of tabBtns) {
        btn.classList.toggle('on', btn.dataset.tab === tab)
      }
    },
    dispose() {
      if (dead) return
      dead = true
      open = false
      scope?.abort()
      scope = null
      life.abort()
      returnTo = null
      sealBehind(false)
      root.remove()
    },
  }
}
