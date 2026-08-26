import '../styles/drawer.css'
/**
 * 수사일지 드로어 — **우측에서 빼꼼 나온 수첩.**
 *
 * ## 왜 항상 펼쳐 두지 않는가
 * 지금까지 수사일지는 화면 오른쪽에 **항상 펼쳐진 채** 있었다. 늘 보이는 것은 곧
 * 안 보이는 것이 된다 — 읽을지 말지를 고르지 않으니 펼치는 동작도, 덮는 동작도 없다.
 * 수첩은 **필요할 때 꺼내 보는 물건**일 때만 물건으로 읽힌다. 그래서 기본 상태를
 * "가장자리에 꽂혀 있음" 으로 되돌리고, 꺼내는 행동을 플레이어에게 돌려준다.
 *
 * ## 세 상태
 * ```
 *  쉼(idle)   책등(--nbk-peek, 40px)만 화면 오른쪽에 걸친다. 높이는 화면의 72%
 *  호버        폭의 45%가 더 나오고 표면을 빛 한 줄이 스친다 ("보고 있다"는 표시)
 *              키보드 포커스(`:has(:focus-visible)`)와 `peek(true)` 도 같은 자리로 간다
 *  열림        표지가 경첩(책등)을 축으로 젖혀지고 종이가 드러난다
 * ```
 * 상태 전환은 전부 `src/styles/drawer.css` 가 소유한다. **호버는 JS 로 잡지 않는다** —
 * `mouseenter/mouseleave` 는 전환 중에 요소가 커서 밑에서 빠져나가면 `leave` 를 흘려
 * 수첩이 나온 채 얼어붙는다. `:hover` 는 브라우저가 그 정합을 책임진다.
 *
 * ## 이 모듈이 하지 않는 것
 * - **내용을 만들지 않는다.** 일지 본문은 `setContent(node)` 로 밖에서 주입한다.
 *   여기서 일지를 그리면 `journalLines()`(engine 이 소유한 번역)와 두 번째 구현이 생긴다.
 * - **판정하지 않는다.** 상태를 읽지도 쓰지도 않는다. 껍데기 하나와 세 상태가 전부다.
 * - **전역을 import 하지 않는다.** `ui`·`sound`·`engine` 어느 것도 붙잡지 않는다 —
 *   그래야 헤드리스 테스트와 프로브에서 단독으로 선다.
 *
 * ## 리스너 (이 저장소는 누수 이력이 있다)
 * 모든 리스너는 두 개의 `AbortController` 에 매달려 있고, `dispose()` 가 둘 다 끊는다.
 * - **평생(life)**: 손잡이 클릭 · 닫기 클릭 · 막 클릭 — 만들 때 붙고 dispose 에서 끊긴다
 * - **열린 동안(open)**: `Esc` 키(document) — 열 때 붙고 닫을 때 끊긴다.
 *   전역 키 리스너를 닫힌 채로 들고 있지 않는다.
 * "바깥 클릭으로 닫기" 도 document 리스너가 아니라 **막(scrim) 한 장**이 받는다.
 * 전역 클릭 리스너는 잊는 순간 누수이고, 클릭이 뒤 화면으로 새면 **닫으려던 클릭이
 * 게임을 조작한다.**
 *
 * ## 그림이 안 보이면
 * `src/styles/drawer.css` 가 로드되지 않은 것이다. 배선은 사람이 한다
 * (`main.ts` 의 `import './styles/drawer.css'` 또는 `style.css` 상단 `@import`).
 */

export interface DrawerHandle {
  /** 뿌리 노드. 이미 `opts.mount`(기본 `document.body`)에 붙어 있다 */
  el: HTMLElement
  open(): void
  close(): void
  isOpen(): boolean
  /** 수사일지 내용은 밖에서 주입한다 — 이 모듈은 일지를 그리지 않는다 */
  setContent(node: HTMLElement): void
  /**
   * 호버와 **같은 자리**로 손수 내밀었다 넣는다 (호버는 여전히 CSS 가 쥔다).
   * 두 가지 때문에 있다: ① **터치에는 호버가 없다** — 손가락만 있는 화면에서는
   * 수첩이 영영 안 나온다 ② 새 일지 줄이 적혔을 때 한 번 내밀어 눈길을 준다.
   * 열려 있는 동안은 아무 일도 하지 않는다(이미 다 나와 있다).
   */
  peek(on?: boolean): void
  /** 리스너 해제 + DOM 제거. 두 번 불러도 안전하다 */
  dispose(): void
}

export interface DrawerOpts {
  onOpen?(): void
  onClose?(): void
  /** 붙일 곳 — 기본 `document.body` */
  mount?: HTMLElement
  /** 책등에 세로로 새겨지는 이름 */
  label?: string
  /** 펼친 면의 머리글 */
  caption?: string
  /** 머리글 옆 한 줄 (없으면 자리를 비운다) */
  hint?: string
  /** 열렸을 때 뒤를 덮는 막. 기본 켠다 — 이것이 "바깥 클릭으로 닫기" 의 실체다 */
  scrim?: boolean
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/**
 * 수첩을 하나 만들어 화면 오른쪽 가장자리에 꽂는다.
 *
 * ```ts
 * const nb = createNotebookDrawer({ onOpen: () => play('paper') })
 * nb.setContent(renderJournal(lines))   // 내용은 밖에서
 * // …
 * nb.dispose()
 * ```
 */
export function createNotebookDrawer(opts: DrawerOpts = {}): DrawerHandle {
  const label = opts.label ?? '수사일지'
  const caption = opts.caption ?? '수사일지'

  /* ── DOM ──────────────────────────────────────────────────────────
   * .nbk (막 + 수첩)
   *   └ .nbk-book
   *       ├ .nbk-ribbon           책갈피 (표지 뒤, 아래로 꼬리만)
   *       ├ .nbk-spine            책등 — 쉼 상태에서 유일하게 보이는 부분
   *       ├ .nbk-leaf             제본된 면
   *       │   ├ .nbk-paper        회백색 종이 (머리글 + 본문)
   *       │   └ .nbk-cover        표지 — 열리면 경첩을 축으로 젖혀진다
   *       ├ .nbk-sheen            반짝임 (호버에서만)
   *       └ .nbk-grab             보이는 수첩 전체가 하나의 단추
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
  /* 닫힌 동안 안쪽은 **없는 것**으로 둔다 — 표지 뒤의 글이 탭으로 잡히면
     보이지 않는 곳으로 포커스가 사라진다 */
  leaf.setAttribute('inert', '')
  book.appendChild(leaf)

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
  /** 평생 리스너 — dispose 에서만 끊긴다 */
  const life = new AbortController()
  /** 열린 동안만 사는 리스너 (Esc) */
  let scope: AbortController | null = null
  /** 열기 직전에 포커스를 갖고 있던 것 — 닫을 때 돌려준다 */
  let returnTo: HTMLElement | null = null

  const focus = (n: HTMLElement): void => {
    try { n.focus({ preventScroll: true }) } catch { /* 포커스는 연출이다 — 실패해도 진행 */ }
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

    // 포커스가 덮이는 면 안에 있으면 손잡이로 데려온다 — 안 그러면 body 로 떨어진다
    if (book.contains(document.activeElement)) focus(returnTo?.isConnected ? returnTo : grab)
    returnTo = null
    opts.onClose?.()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()          // Esc 하나가 수첩과 그 뒤 화면을 동시에 닫지 않게
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
    dispose() {
      if (dead) return
      dead = true
      open = false
      scope?.abort()
      scope = null
      life.abort()
      returnTo = null
      root.remove()
    },
  }
}
