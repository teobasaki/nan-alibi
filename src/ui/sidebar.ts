/**
 * **좌측 사이드바 — 제2막(경찰서·수사)의 상설 기둥.**
 *
 * 화면 좌측 20%를 차지하고 **끝까지 사라지지 않는다.** 경찰서 메인(칠판 타임라인)에서도,
 * 심문실 안에서도 같은 것이 서 있다. 그래야 심문실 → 심문실 이동이 "뒤로 갔다가 다시 들어가기"가
 * 아니라 **옆방으로 걸어가기**가 된다. 사이드바가 죽는 순간 다섯 명은 다섯 개의 화면이 되고,
 * 플레이어는 인물 비교를 그만둔다.
 *
 * ## 6등분 — 위 1칸은 물건, 아래 5칸은 사람
 * ```
 *  ┌──────────────┐
 *  │  ◤ 파일철     │  1/6  인터랙티브 오브젝트. 호버로 빼꼼, 클릭하면 프로파일링 문서
 *  ├──────────────┤
 *  │ ▣ 류나린      │  5/6  이름·나이·직업 + 대화 진행(n/10)
 *  │ ▣ 배지호      │       누르면 그 사람의 심문실로 간다
 *  │ ▣ 문소라      │
 *  │ ▣ 도율        │
 *  │ ▣ 김하늘      │
 *  └──────────────┘
 * ```
 *
 * ## 경계 (이 파일이 하지 않는 것)
 * - **판정하지 않는다.** 소거·모순·점수는 `engine/` 이 소유한다. 여기는 받은 것을 그릴 뿐이다.
 * - **기록으로 소거된 사람을 흐리게 만들지 않는다.** 그래서 `SidebarSuspect` 에 `cleared` 가
 *   아예 없다 — 자동 소거를 없애기로 한 이상, 넘길 수 있게 두면 언젠가 다시 흐려진다.
 * - **전역 상태를 모른다.** 초상 URL 조차 인자로 받는다(`portraitFor`·`castTagFor` 는 배선하는
 *   쪽이 부른다). 그래서 이 파일은 사건 하나 없이도 probe 하네스에서 단독으로 뜬다.
 *
 * ## 색
 * 현재 심문 중인 사람은 **앰버 좌측 바**로 표시한다 — 앰버는 이 게임에서 '자원·주목'이다.
 * 붉은색은 쓰지 않는다. 사이드바에서 붉은색을 쓰면 그건 "이 사람이 수상하다"는 시스템의
 * 판정으로 읽히고, 그 판정은 코드가 할 일이 아니다(모순 인장은 대조 결과에만 찍힌다).
 *
 * ## 배치
 * 루트는 `width:20%` 이자 `flex:0 0 20%` 다 — flex 행에 그대로 넣거나, 그리드 첫 칸에
 * 넣으면 된다. 높이는 부모를 100% 채운다. `src/style.css` 는 건드리지 않는다:
 * 스타일은 아래 한 줄로 자기 파일에서 온다.
 */

import '../styles/sidebar.css'

export interface SidebarSuspect {
  /** 슬롯 id ('S1'~'S5'). 그대로 `pick(id)` 로 되돌아온다 */
  id: string
  name: string
  age: number
  job: string
  /** 초상 URL — 없으면 이니셜 놋쇠 명패로 선다 (에셋 0장에서도 안 깨진다) */
  portrait: string | null
  /** 지금 이 사람의 심문실에 들어와 있는가 — 앰버 좌측 바 */
  active: boolean
  /** 소모한 대화 수 */
  talked: number
  /** 대화 상한 (TALK_CAP) */
  talkCap: number
}

export interface SidebarHandlers {
  /** 용의자 칸을 눌렀다 — 그 사람의 심문실로 데려간다 */
  pick(id: string): void
  /** 파일철을 눌렀다 — 프로파일링 문서를 연다 (문서 자체는 이 파일 밖) */
  openProfile(): void
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/** 화면에 나가는 한 줄 — "41세 · 전시 운영 책임자" */
const jobLine = (p: SidebarSuspect): string => `${p.age}세 · ${p.job}`

/**
 * **파일철** — 위 1/6 칸을 차지하는 인터랙티브 오브젝트.
 *
 * 서류철의 긴 옆면을 보여주면 그냥 '탭 버튼'이 된다. 그래서 **모서리가 앞으로 오도록**
 * 기울여 세운다(수평에서 67° — CSS 의 `--fa-fold-tilt`). 칸이 `overflow:hidden` 이라
 * 위쪽이 잘리고, **화면 밖에서 걸쳐 들어온 물건**으로 읽힌다. 호버하면 조금 더 내려온다.
 *
 * 글자는 기울이지 않는다 — 기운 판 위의 기운 한글은 안 읽힌다. 그래픽만 기울고
 * 캡션은 칸 바닥에 수평으로 눕는다.
 */
function folderCell(on: SidebarHandlers): HTMLElement {
  const cell = el('button', 'fa-sb-folder') as HTMLButtonElement
  cell.type = 'button'
  cell.setAttribute('aria-label', '용의자 프로파일링 문서 열기')

  const fold = el('span', 'fa-sb-fold')
  fold.setAttribute('aria-hidden', 'true')
  fold.appendChild(el('i', 'fa-sb-fold-back'))
  fold.appendChild(el('i', 'fa-sb-fold-paper'))
  fold.appendChild(el('i', 'fa-sb-fold-front'))
  fold.appendChild(el('i', 'fa-sb-fold-tab'))
  fold.appendChild(el('i', 'fa-sb-fold-clip'))
  cell.appendChild(fold)

  const cap = el('span', 'fa-sb-fold-cap')
  cap.appendChild(el('b', 'fa-sb-fold-t', '용의자 파일철'))
  cap.appendChild(el('span', 'fa-sb-fold-s', '프로파일링 문서'))
  cell.appendChild(cap)

  cell.onclick = () => on.openProfile()
  return cell
}

/** 한 사람의 칸을 그린다(뼈대만). 값 채우기는 `paintRow` 가 전담한다 — 갱신과 같은 길을 쓴다. */
function suspectRow(): HTMLButtonElement {
  const row = el('button', 'fa-sb-row') as HTMLButtonElement
  row.type = 'button'

  const face = el('span', 'fa-sb-face')
  face.setAttribute('aria-hidden', 'true')
  row.appendChild(face)

  const meta = el('span', 'fa-sb-meta')
  meta.appendChild(el('span', 'fa-sb-name'))
  meta.appendChild(el('span', 'fa-sb-job'))
  const talk = el('span', 'fa-sb-talk')
  talk.appendChild(el('i', 'fa-sb-bar')).appendChild(el('u'))
  talk.appendChild(el('em', 'fa-sb-n'))
  meta.appendChild(talk)
  row.appendChild(meta)

  return row
}

/**
 * 칸에 값을 바른다. **렌더와 갱신이 같은 함수를 지난다** — 두 벌로 두면 언젠가
 * 한쪽만 고쳐져서 "새로 그리면 맞는데 갱신하면 틀린" 상태가 생긴다.
 */
function paintRow(row: HTMLButtonElement, p: SidebarSuspect): void {
  row.dataset.id = p.id

  const face = row.querySelector<HTMLElement>('.fa-sb-face')!
  if (p.portrait) {
    face.classList.remove('plate')
    face.textContent = ''
    face.style.backgroundImage = `url(${p.portrait})`
  } else {
    face.classList.add('plate')
    face.style.backgroundImage = ''
    face.textContent = p.name.slice(0, 1)
  }

  row.querySelector<HTMLElement>('.fa-sb-name')!.textContent = p.name
  row.querySelector<HTMLElement>('.fa-sb-job')!.textContent = jobLine(p)

  const cap = Math.max(1, p.talkCap)
  const used = Math.min(Math.max(0, p.talked), cap)
  const spent = used >= cap
  row.querySelector<HTMLElement>('.fa-sb-bar u')!.style.width = `${(used / cap) * 100}%`
  const n = row.querySelector<HTMLElement>('.fa-sb-n')!
  n.textContent = spent ? '대화 소진' : `대화 ${used} / ${cap}`
  n.classList.toggle('off', spent)

  row.classList.toggle('on', p.active)
  // aria-current 는 "지금 여기"를 읽어준다. active 를 색으로만 두면 스크린리더에서 사라진다.
  if (p.active) row.setAttribute('aria-current', 'true')
  else row.removeAttribute('aria-current')
  row.setAttribute(
    'aria-label',
    `${p.name} ${jobLine(p)}, ${spent ? '대화 소진' : `대화 ${used} / ${cap}`}.`
      + `${p.active ? ' 지금 심문 중.' : ' 심문실로 이동.'}`,
  )
}

/**
 * 사이드바 DOM 을 만든다. 인원은 5명을 상정하지만 개수에 기대지 않는다 —
 * 4명이 오면 4칸을 그리고 6등분 격자는 그대로 둔다(빈 칸이 남을 뿐 레이아웃이 안 무너진다).
 */
export function renderSidebar(people: SidebarSuspect[], on: SidebarHandlers): HTMLElement {
  const nav = el('nav', 'fa-sb')
  nav.setAttribute('aria-label', '용의자 명단')

  nav.appendChild(folderCell(on))

  const list = el('div', 'fa-sb-list')
  people.forEach((p) => {
    const row = suspectRow()
    paintRow(row, p)
    row.onclick = () => on.pick(p.id)
    list.appendChild(row)
  })
  nav.appendChild(list)

  /**
   * 세로 목록이니 위/아래 화살표로 옮겨 다닌다. 버튼이라 Enter·Space 는 브라우저가 준다 —
   * 우리가 다시 구현하면 IME 조합 중 스페이스까지 삼킨다.
   */
  list.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('.fa-sb-row'))
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    const next = rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]
    next?.focus()
  })

  return nav
}

/**
 * 값만 바꿔 끼운다 — 대화를 한 번 하고 돌아왔을 때 사이드바를 통째로 다시 만들면
 * **포커스가 날아가고** 초상 이미지가 다시 깜빡인다. 인원 구성이 바뀌면(=id 목록이 달라지면)
 * `false` 를 돌려주니, 호출부는 그때만 다시 `renderSidebar` 하면 된다.
 */
export function updateSidebar(root: HTMLElement, people: SidebarSuspect[]): boolean {
  const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('.fa-sb-row'))
  if (rows.length !== people.length) return false
  if (rows.some((r, i) => r.dataset.id !== people[i]!.id)) return false
  rows.forEach((r, i) => paintRow(r, people[i]!))
  return true
}
