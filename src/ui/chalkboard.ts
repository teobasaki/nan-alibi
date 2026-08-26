/**
 * 녹색 칠판 타임라인 — 제2막(경찰서)의 **중심 행동**.
 *
 * 이 화면에 들어온 사람이 "여기서 뭘 해야 하는가" 를 글이 아니라 **모양으로** 알아야 한다.
 * 비어 있는 표는 그 자체로 명령이다 — 채워라. 그래서 이 부품의 기본 상태는 빈 칠판이고,
 * 빈 칸에는 값 대신 "여기 적힌다" 만 암시하는 점선 밑줄이 있다.
 *
 * ## 축
 * **행이 시각, 열이 사람이다.** (기존 `main.ts`의 `alibiGrid()` 와 축이 뒤집혀 있다.)
 * 시간이 위에서 아래로 흐르는 편이 타임라인의 은유에 맞고, 사람이 늘어도 가로로만 늘어난다.
 * 범행 시각 행은 반드시 있고, 그 행만 다홍 분필로 쓰이며 살짝 밝다.
 *
 * ## 경계 (이 저장소의 상수)
 * - **판정하지 않는다.** 모순 여부·소거 여부는 전부 engine 이 이미 정한 값을 읽기만 한다.
 *   `chalkData` 가 `candidatesFrom`(engine)·`g.foundContradictions`(engine) 를 그대로 읽는다.
 * - **라벨은 사건이 소유한다.** 시각·장소 문자열은 `slotLabel`/`placeLabel` 만 지난다 (불변식 6).
 *   `renderChalkboard` 는 이미 라벨이 된 문자열만 받는다 — 사건을 모른다.
 * - **전역 `ui` 를 모른다.** 필요한 것은 전부 인자로 받는다. 배선은 부르는 쪽이 한다.
 * - **`Math.random()` 을 쓰지 않는다** (불변식 5). 손글씨 느낌의 미세 기울기는
 *   칸의 좌표로 결정되는 고정 표에서 뽑는다 — 같은 표는 언제나 같은 필체다.
 */

import { candidatesFrom } from '../engine/solver'
import { claimCardId, type GameState } from '../engine/game'
import {
  CRIME_SLOT, placeLabel, slotLabel, SLOTS, SUSPECTS,
  type CaseFile, type Slot, type SuspectId,
} from '../types'
import '../styles/chalkboard.css'

/* ────────────────────────────── 데이터 모양 ────────────────────────────── */

export interface ChalkCell {
  /** 이 칸에 적힌 장소. **이미 `placeLabel` 을 지난 문자열**이다. 아직 모르면 `null` — 빈 칸 */
  place: string | null
  /** 기록과 어긋난다고 **이미 판정된** 칸. 이 부품은 판정하지 않고 결과만 받는다 */
  contradicted: boolean
  /** 연결 대상으로 집혀 있는 칸 */
  selected: boolean
  /** 이번 렌더에서 처음 그어지는 ✕ 인가 — 연출은 한 번만 돈다 */
  fresh?: boolean
}

/** 행 하나 = 시각 하나 */
export interface ChalkSlot {
  /** **이미 `slotLabel` 을 지난 문자열** */
  label: string
  /** 범행 시각인가 — 다홍 분필 + '범행 추정' 표 */
  isCrime: boolean
  /** 시각 밑 작은 메모 (예: `'기록 2건'`). 없으면 안 그린다 */
  note?: string
}

/** 열 하나 = 사람 하나 */
export interface ChalkSuspect {
  id: string
  name: string
  /** 이름 밑 한 줄. 없으면 안 그린다 */
  job?: string
  /** 기록으로 소거된 사람 — 이름에 분필 줄이 그어진다 */
  cleared?: boolean
}

export interface ChalkBoardData {
  slots: ChalkSlot[]
  suspects: ChalkSuspect[]
  /** `(사람, 시각)` 한 칸. 렌더는 칸마다 **정확히 한 번씩만** 부른다 (`fresh` 소모 때문에) */
  cell(suspectId: string, slotIndex: number): ChalkCell
  /** 칠판 머리말. 없으면 기본 문구 */
  caption?: string
  /** 머리말 밑 한 줄. 없으면 기본 문구. 빈 문자열이면 안 그린다 */
  hint?: string
}

export interface ChalkHandlers {
  /** 칸을 짚었다 — 적힌 진술을 집는 행동 */
  pickCell(suspectId: string, slotIndex: number): void
  /** 열머리(사람 이름)를 짚었다 — 심문 진입. 없으면 이름은 안 눌린다 */
  pickSuspect?(suspectId: string): void
}

/* ────────────────────────────── 상태 → 데이터 ────────────────────────────── */

export interface ChalkOpts {
  /** 지금 집혀 있는 카드 id 들 */
  selected: readonly string[]
  /**
   * 이미 ✕ 를 그은 칸 (`'S3:2'` 꼴). 넘기면 **처음 그어질 때만** 획 애니메이션이 돈다.
   * 전체 재렌더 구조라 이게 없으면 행동할 때마다 표 전체가 다시 그어진다.
   */
  stampedSeen?: Set<string>
  caption?: string
  hint?: string
}

/**
 * 게임 상태를 칠판이 읽을 모양으로 옮긴다 — **순수 변환**이다.
 * 소거 판정은 `candidatesFrom`(engine), 모순 판정은 `g.foundContradictions`(engine) 가 소유한다.
 * 여기서 새로 판정되는 것은 없다.
 */
export function chalkData(c: CaseFile, g: GameState, o: ChalkOpts): ChalkBoardData {
  const cands = candidatesFrom(c, new Set(g.cards))
  // 모순 키는 `증거id|사람|시각` — 어느 증거로 잡혔는지는 표에서 안 쓴다
  const bad = new Set(g.foundContradictions.map((k) => {
    const p = k.split('|')
    return `${p[1]}:${p[2]}`
  }))
  const seen = o.stampedSeen

  const slots: ChalkSlot[] = SLOTS.map((t) => {
    const n = c.evidence.filter((e) => e.slot === t && g.cards.includes(e.id)).length
    return {
      label: slotLabel(c, t),
      isCrime: t === CRIME_SLOT,
      note: n > 0 ? `기록 ${n}건` : undefined,
    }
  })

  const suspects: ChalkSuspect[] = SUSPECTS.map((s) => ({
    id: s,
    name: c.suspects[s].name,
    job: c.suspects[s].job,
    cleared: !cands.includes(s),
  }))

  return {
    slots,
    suspects,
    caption: o.caption,
    hint: o.hint,
    cell(suspectId, slotIndex) {
      const s = suspectId as SuspectId
      const t = slotIndex as Slot
      const known = g.cards.includes(claimCardId(s, t))
      const contradicted = bad.has(`${s}:${t}`)
      const key = `${s}:${t}`
      let fresh = false
      if (contradicted && seen && !seen.has(key)) { seen.add(key); fresh = true }
      return {
        place: known ? placeLabel(c, c.suspects[s].claim[t]!) : null,
        contradicted,
        selected: o.selected.includes(claimCardId(s, t)),
        fresh,
      }
    },
  }
}

/* ────────────────────────────── 그리기 ────────────────────────────── */

const NS = 'http://www.w3.org/2000/svg'

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/** 분필 획 하나. `d` 여러 개면 한 SVG 안에 여러 획 (✕ 처럼) */
function stroke(cls: string, viewBox: string, ...ds: string[]): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg')
  s.setAttribute('class', cls)
  s.setAttribute('viewBox', viewBox)
  s.setAttribute('preserveAspectRatio', 'none')
  s.setAttribute('aria-hidden', 'true')
  s.setAttribute('focusable', 'false')
  for (const d of ds) {
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d)
    s.appendChild(p)
  }
  return s
}

/** 손으로 그은 밑줄 — 압력이 오르내린다 */
const D_UNDERLINE = 'M2 5.4 C 20 2.6, 43 6.8, 62 3.4 C 76 1.2, 88 5, 98 3'
/** 열머리 밑줄 (조금 더 짧고 곧다) */
const D_NAME_LINE = 'M4 4.6 C 26 2.2, 58 6.2, 96 3.2'
/** 소거선 */
const D_STRIKE = 'M2 6.4 C 24 2.8, 56 8.4, 98 4.2'
/** 모서리 사선 */
const D_SLASH = 'M3 4 C 28 26, 60 60, 97 96'
/** 크게 그은 ✕ 두 획 */
const D_X1 = 'M8 12 C 30 34, 58 58, 92 88'
const D_X2 = 'M90 10 C 66 36, 40 58, 10 90'
/** 한 번에 두른 동그라미 — 시작점으로 정확히 안 돌아온다 */
const D_RING = 'M62 6 C 24 5, 5 17, 6 31 C 7 45, 30 56, 63 55 C 96 54, 115 43, 114 29 C 113 16, 92 6, 48 8'

/** 칸마다 조금씩 다른 필체. 좌표가 정하는 고정 표 — 같은 표는 언제나 같은 손글씨다 */
const TILT = [-0.9, 0.6, -0.35, 1.0, -0.7, 0.45, -1.05, 0.85, -0.25, 0.9,
  0.4, -0.75, 1.05, -0.5, 0.55, -0.6, 0.95, -1.0, 0.3, 0.75,
  1.0, -0.4, 0.65, -0.85, 0.5]
const NUDGE = [0, 1, -1, 1, 0, -1, 1, 0, -1, 1, 0, -1, 0, 1, -1,
  1, -1, 0, 1, 0, -1, 1, 0, -1, 1]

/** 분필 글씨 한 덩이 */
function ink(cls: string, text: string, i: number): HTMLElement {
  const n = el('span', `cb-ink ${cls}`, text)
  n.style.setProperty('--cb-tilt', `${TILT[i % TILT.length]!}deg`)
  n.style.setProperty('--cb-dy', `${NUDGE[i % NUDGE.length]!}px`)
  return n
}

/**
 * 분필 획 필터 — **활자 티를 지우는 두 단계.**
 *
 * ① `feDisplacementMap` 으로 획을 미세하게 흔든다. 자로 잰 직선은 칠판이 아니라 스프레드시트다.
 * ② 잔 노이즈를 알파로 바꿔 곱한다 (`feComposite in`). 분필은 칠판 결에 얹히는 가루라
 *    획 안쪽이 고르지 않다 — 이 얼룩이 없으면 아무리 흔들어도 '흰 글씨'로만 읽힌다.
 *
 * 흔들기·얼룩 모두 **약하게** 건다. 한글은 획 간격이 좁아서 세게 걸면 글자가 무너진다.
 * 필터를 지원하지 않는 환경에서는 그냥 또렷한 글씨가 된다 — 무너지지 않는다.
 */
function defs(): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg')
  s.setAttribute('class', 'cb-defs')
  s.setAttribute('aria-hidden', 'true')
  s.setAttribute('focusable', 'false')

  const f = document.createElementNS(NS, 'filter')
  f.setAttribute('id', 'cbChalkRough')
  f.setAttribute('x', '-15%'); f.setAttribute('y', '-15%')
  f.setAttribute('width', '130%'); f.setAttribute('height', '130%')
  f.setAttribute('color-interpolation-filters', 'sRGB')

  const mk = (tag: string, attrs: Record<string, string>): SVGElement => {
    const n = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    return n
  }

  // ① 굵은 결로 획을 흔든다
  f.appendChild(mk('feTurbulence', {
    type: 'fractalNoise', baseFrequency: '0.72', numOctaves: '3', seed: '7', result: 'wob',
  }))
  f.appendChild(mk('feDisplacementMap', {
    in: 'SourceGraphic', in2: 'wob', scale: '1.9',
    xChannelSelector: 'R', yChannelSelector: 'G', result: 'disp',
  }))
  // ② 잔 결을 알파로 — 0.45~1.0 사이에서만 흔들어 글자가 끊기지는 않게 한다
  f.appendChild(mk('feTurbulence', {
    type: 'fractalNoise', baseFrequency: '1.1', numOctaves: '2', seed: '11', result: 'dust',
  }))
  f.appendChild(mk('feColorMatrix', {
    in: 'dust', type: 'matrix', result: 'dustA',
    values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .38 .38 .38 0 .30',
  }))
  f.appendChild(mk('feComposite', { in: 'disp', in2: 'dustA', operator: 'in' }))

  s.appendChild(f)
  return s
}

/** 눌리는 칸을 진짜 버튼으로 — 표의 의미(행/열 머리)는 role 이 지킨다 */
function button(label: string, fk: string, onPick: () => void): HTMLButtonElement {
  const b = el('button', 'cb-btn') as HTMLButtonElement
  b.type = 'button'
  b.setAttribute('aria-label', label)
  b.dataset.fk = fk
  b.onclick = onPick
  return b
}

/**
 * 칠판을 그린다. 상태를 읽어 그리기만 하며, 어떤 판정도 하지 않는다.
 *
 * @param d  표의 내용 — 라벨은 이미 사건을 지난 문자열이어야 한다
 * @param on 조작 — 없는 핸들러의 칸은 그냥 안 눌린다
 */
export function renderChalkboard(d: ChalkBoardData, on: ChalkHandlers): HTMLElement {
  const root = el('div', 'chalkboard')
  root.appendChild(defs())

  const frame = el('div', 'cb-frame')
  const surface = el('div', 'cb-surface')

  /* ── 머리말 ── */
  const head = el('div', 'cb-head')
  const cap = el('div', 'cb-cap')
  cap.appendChild(ink('', d.caption ?? '알리바이 대조표', 3))
  head.appendChild(cap)
  head.appendChild(stroke('cb-cap-rule', '0 0 100 8', D_UNDERLINE))
  const hint = d.hint ?? '세로는 시각, 가로는 사람이다. 심문으로 받아낸 진술이 이 칸에 적힌다.'
  if (hint) head.appendChild(el('div', 'cb-hint', hint))
  surface.appendChild(head)

  /*
   * 칸을 **먼저 한 번에 다 읽는다.** `cell()` 은 `fresh` 를 소모하므로 두 번 부르면
   * 처음 그어지는 획이 조용히 사라진다. 읽고 나서 그린다.
   */
  const grid: ChalkCell[][] = d.slots.map((_, ti) => d.suspects.map((s) => d.cell(s.id, ti)))
  const written = grid.some((row) => row.some((c) => c.place !== null))

  /* ── 표 ── */
  const scroll = el('div', 'cb-scroll')
  const table = el('div', 'cb-table')
  table.setAttribute('role', 'table')
  table.setAttribute('aria-label', d.caption ?? '알리바이 대조표')
  // 칸을 무한정 줄이느니 가로로 넘긴다 — 못 읽는 표는 표가 아니다 (`--cb-colmin`)
  table.style.gridTemplateColumns =
    `var(--cb-timecol) repeat(${d.suspects.length}, minmax(var(--cb-colmin), 1fr))`
  table.style.gridTemplateRows = `auto repeat(${d.slots.length}, minmax(var(--cb-rowh), 1fr))`

  /* 머리행 — 사람 */
  const headRow = el('div', 'cb-row')
  headRow.setAttribute('role', 'row')
  const corner = el('div', 'cb-corner')
  corner.setAttribute('role', 'columnheader')
  corner.appendChild(stroke('cb-slash', '0 0 100 100', D_SLASH))
  corner.appendChild(el('span', 'cb-corner-a', '사람'))
  corner.appendChild(el('span', 'cb-corner-b', '시각'))
  headRow.appendChild(corner)

  d.suspects.forEach((s, ci) => {
    const th = el('div', `cb-name${s.cleared ? ' out' : ''}`)
    th.setAttribute('role', 'columnheader')

    const inner = el('span', 'cb-name-in')
    const nameLine = el('span', 'cb-name-t')
    nameLine.appendChild(ink('', s.name, ci * 7 + 1))
    inner.appendChild(nameLine)
    if (s.job) inner.appendChild(el('span', 'cb-name-j', s.job))
    // 소거선은 이름 위를 지난다 — 열머리 칸이 아니라 글자에 그어야 '지워졌다' 로 읽힌다
    if (s.cleared) nameLine.appendChild(stroke('cb-strike', '0 0 100 10', D_STRIKE))
    inner.appendChild(stroke('cb-name-u', '0 0 100 8', D_NAME_LINE))
    if (s.cleared) inner.appendChild(el('span', 'cb-tag-out', '기록으로 소거'))

    if (on.pickSuspect) {
      const b = button(
        `${s.name} 심문하기${s.cleared ? ' (기록으로 소거됨)' : ''}`,
        `chalkwho:${s.id}`,
        () => on.pickSuspect!(s.id),
      )
      b.appendChild(inner)
      th.appendChild(b)
    } else {
      th.appendChild(inner)
    }
    headRow.appendChild(th)
  })
  table.appendChild(headRow)

  /* 본문 — 행 하나가 시각 하나 */
  d.slots.forEach((slot, ti) => {
    const row = el('div', 'cb-row')
    row.setAttribute('role', 'row')

    const th = el('div', `cb-time${slot.isCrime ? ' crime' : ''}`)
    th.setAttribute('role', 'rowheader')
    const tl = el('div', 'cb-time-t')
    tl.appendChild(ink('', slot.label, ti * 5))
    th.appendChild(tl)
    if (slot.isCrime) {
      th.appendChild(stroke('cb-time-u', '0 0 100 8', D_UNDERLINE))
      th.appendChild(el('span', 'cb-tag-crime', '범행 추정'))
    }
    if (slot.note) th.appendChild(el('div', 'cb-time-n', slot.note))
    row.appendChild(th)

    d.suspects.forEach((s, ci) => {
      const c = grid[ti]![ci]!
      const td = el('div',
        `cb-cell${slot.isCrime ? ' crime' : ''}${c.contradicted ? ' bad' : ''}`)
      td.setAttribute('role', 'cell')

      const body = el('span', 'cb-cell-in')
      if (c.place === null) {
        body.appendChild(el('span', 'cb-blank'))
      } else {
        const p = el('span', 'cb-place')
        p.appendChild(ink('', c.place, ti * d.suspects.length + ci))
        body.appendChild(p)
      }

      if (c.place !== null) {
        // 어긋남은 색만으로 말하지 않는다 — 획(✕)과 표('어긋남')가 함께 간다
        const state = c.contradicted ? ', 기록과 어긋남' : ''
        const pick = c.selected ? ' (집힘 — 다시 누르면 놓는다)' : ''
        const b = button(
          `${s.name} ${slot.label} 진술 — ${c.place}${state}. 연결하려면 선택${pick}`,
          `chalkcell:${s.id}:${ti}`,
          () => on.pickCell(s.id, ti),
        )
        b.setAttribute('aria-pressed', String(c.selected))
        b.appendChild(body)
        if (c.selected) b.appendChild(stroke('cb-ring', '0 0 120 60', D_RING))
        if (c.contradicted) {
          b.appendChild(stroke(`cb-x${c.fresh ? ' fresh' : ''}`, '0 0 100 100', D_X1, D_X2))
          b.appendChild(el('span', 'cb-tag-bad', '어긋남'))
        }
        td.appendChild(b)
      } else {
        td.appendChild(body)
      }
      row.appendChild(td)
    })
    table.appendChild(row)
  })

  scroll.appendChild(table)
  surface.appendChild(scroll)

  // 비어 있는 칠판은 그 자체로 지시다. 그래도 한 줄은 붙여 준다 — 첫 화면에서만 보인다.
  if (!written) {
    surface.appendChild(el('div', 'cb-empty',
      '아직 아무것도 적혀 있지 않다. 이름을 짚어 심문을 시작하면 이 칸들이 채워진다.'))
  }

  frame.appendChild(surface)

  // 분필 받침 — 이 물건이 칠판이라는 걸 한 눈에 말해 준다
  const tray = el('div', 'cb-tray')
  tray.setAttribute('aria-hidden', 'true')
  tray.appendChild(el('i', 'cb-stick'))
  tray.appendChild(el('i', 'cb-stick red'))
  tray.appendChild(el('i', 'cb-eraser'))
  frame.appendChild(tray)

  root.appendChild(frame)
  return root
}
