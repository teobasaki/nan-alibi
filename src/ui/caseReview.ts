/**
 * 수사 정리 — 「현장 조사 종료」 화면의 **기록 진열대**.
 *
 * ## 왜 다시 만들었나 (2026-08-26 팀 피드백)
 *
 * 예전 정리 카드는 확보한 기록마다 *그 기록이 무엇을 뜻하는지* 를 함께 적었다.
 * "— 류나린 확인", "후보 소거", "남은 후보 3명 · 인장 1건". 팀 지적:
 *
 * > 브리핑에 너무 많은 정보가 시스템으로 확정되어 플레이어의 재미를 오히려 빼앗아간다.
 * > 특히 용의자가 바로 제외되는 것은 해당 용의자에 대한 심문의 기회를 빼앗아간다.
 *
 * 그래서 이 화면은 **판정을 한 글자도 쓰지 않는다.** 무엇을 확보했는지만 보여준다.
 * 소거·모순·후보 수는 여기서 사라졌을 뿐 **엔진에서 지워진 게 아니다** —
 * `candidatesFrom` 은 그대로 있고, 플레이어가 심문하며 직접 도달한다.
 *
 * ## 왜 이미지인가
 *
 * `public/props/thumbs/` 의 썸네일 7종은 3D 소품을 **같은 렌즈·같은 조명·같은
 * 프레임 점유율**로 렌더한 「정본 기록 뷰」다(소품 공정성 7A.7). 목적은 하나 —
 * *현장에서 본 그 물건을 기록에서 다시 알아보게 하는 것.* 그래서 썸네일은
 * kind 로 고르면 안 된다. 같은 '카메라 기록' 이라도 현장에서 하나는 보안 카메라,
 * 다른 하나는 필름 릴로 섰기 때문이다. **현장 배치가 정한 모델 키**(`spawnAnchored`)
 * 를 그대로 따라간다 — `heldRecordsFrom` 이 그 일을 한다.
 *
 * ## 경계
 * - 판정·채점 없음. 상태를 읽어 그리기만 한다 (엔진은 `src/engine/` 소유).
 * - 시각·장소 라벨은 `slotLabel`/`placeLabel` 을 지난다 (불변식 6). 하드코딩 없음.
 * - 전역 `ui` 를 import 하지 않는다. 필요한 것은 전부 인자로 받는다.
 * - 스타일은 `src/styles/case-review.css` — `style.css` 를 건드리지 않는다.
 *
 * ## 붙이는 법 (배선은 사람이 한다)
 * ```ts
 * import { heldRecordsFrom, renderCaseReview } from './ui/caseReview'
 * import './styles/case-review.css'
 *
 * const ov = h('div', 'overlay')
 * ov.appendChild(renderCaseReview(
 *   heldRecordsFrom(CASE, ui.game.cards),
 *   { next: () => { play('paper'); ui.wall = true; fadeOut(ov); render() } },
 * ))
 * document.body.appendChild(ov)
 * ```
 * 반환 엘리먼트는 **제 껍데기(패널·테두리·스크롤)를 스스로 갖는다** — `.sheet` 로
 * 한 번 더 감싸지 않아도 된다. CTA 에 포커스를 주고 싶으면
 * `el.querySelector<HTMLButtonElement>('.crv-next')?.focus()`.
 */

import { spawnAnchored } from './sceneRules'
import {
  kindLabel, placeLabel, slotLabel,
  type CaseFile, type Evidence, type Slot,
} from '../types'

/* ─────────── 데이터 ─────────── */

/** 진열대에 오르는 기록 한 장. **이 화면이 아는 것은 이게 전부다** — 해석은 없다. */
export interface HeldRecord {
  id: string
  /** 기록 종류 표시명 — 이미 사건 라벨을 지나온 문자열 (예: '카메라 기록') */
  kindLabel: string
  /** 이미 `slotLabel(c, t)` 를 지나온 문자열 (예: '21:16') */
  slotLabel: string
  /** 이미 `placeLabel(c, p)` 를 지나온 문자열 (예: '메인 전시홀') */
  placeLabel: string
  /** 정본 기록 뷰 썸네일 URL. **없을 수 있다** — 증거 깃발은 파일 에셋이 아니다 */
  thumb: string | null
  /**
   * 시각 묶음의 **정렬 키**(Slot 0..4). 화면에는 절대 나오지 않는다 — 보이는 건
   * 언제나 `slotLabel` 이다(불변식 6). 없으면 등장 순서로 묶는다.
   */
  slot?: number
}

/**
 * 기록 종류의 기본 표시명. 화면마다 어휘 길이가 달라서 기본값은 호출부가 내는 것이
 * 이 저장소의 규약이다(`kindLabel` 주석) — 여기 것은 **진열대용**(짧고 물건스럽게).
 * 월드 스킨이 있으면 그것이 이긴다.
 */
const KIND_FALLBACK: Record<Evidence['kind'], string> = {
  keycard: '카드키 기록',
  cctv: 'CCTV',
  call: '통화 내역',
  receipt: '영수증',
  autopsy: '검시 소견',
}

/**
 * 썸네일 색인 — `public/props/thumbs/<모델키>.webp`.
 *
 * `manifest.json` 을 fetch 하지 않고 glob 을 쓰는 이유는 **`base: './'`** 다.
 * 하드코딩한 `/props/thumbs/x.webp` 는 하위 경로 배포에서 깨진다. glob 은
 * 빌드에서 올바른 상대 URL 로 바뀐다 — `crimescene3d` 가 소품 GLB 에 쓰는 그 방법이다.
 * (개발 서버에서는 키가 `/public/...` 로 오므로 앞머리를 떼어낸다.)
 */
const THUMB_FILES = import.meta.glob('/public/props/thumbs/*.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const THUMB_BY_KEY = new Map<string, string>()
for (const [p, url] of Object.entries(THUMB_FILES)) {
  const k = p.split('/').pop()?.replace(/\.webp$/, '')
  if (k) THUMB_BY_KEY.set(k, url.replace(/^\/public/, ''))
}

/**
 * 현장 모델 키 → 정본 기록 뷰 URL. **없으면 `null`** — 증거 깃발(`FLAG_KEY`)은
 * 씬이 프리미티브로 세우는 물건이라 사진이 존재하지 않는다. 그 경우 카드는
 * 사진 없는 태그로 선다(빈칸이 아니라 다른 형태다).
 */
export function thumbUrlFor(modelKey: string | null | undefined): string | null {
  if (!modelKey) return null
  return THUMB_BY_KEY.get(modelKey) ?? null
}

/**
 * 손에 쥔 기록 → 진열대 데이터. **순수 함수**다 — 상태를 읽어 옮겨 담기만 한다.
 *
 * 썸네일은 `spawnAnchored` 가 정한 현장 모델을 따라간다. 그 배치는 **사건 전체의
 * 증거 목록**을 봐야 정해지므로(같은 모델은 한 현장에 한 번뿐) 수거분만 넘기면 안 된다 —
 * `c.evidence` 를 통째로 넣고 손에 쥔 것만 골라낸다.
 *
 * @param heldIds 손에 쥔 카드 id 목록 (`g.cards`). 증거가 아닌 id 는 알아서 무시된다.
 * @param kindLabelOf 기록 종류 표시명 주입구. 없으면 사건 라벨 + 진열대 기본값.
 */
export function heldRecordsFrom(
  c: CaseFile,
  heldIds: readonly string[],
  kindLabelOf: (kind: Evidence['kind']) => string =
    (k) => kindLabel(c, k, KIND_FALLBACK[k]),
): HeldRecord[] {
  const spots = spawnAnchored(c.evidence.map((e) => ({ id: e.id, kind: e.kind })))
  const held = new Set(heldIds)
  return c.evidence
    .filter((e) => held.has(e.id))
    .map((e) => ({
      id: e.id,
      kindLabel: kindLabelOf(e.kind),
      slotLabel: slotLabel(c, e.slot),
      placeLabel: placeLabel(c, e.place),
      thumb: thumbUrlFor(spots.get(e.id)?.model),
      slot: e.slot as Slot as number,
    }))
}

/** 한 시각에 확보한 기록 묶음 */
export interface RecordGroup {
  /** 사건이 소유한 시각 라벨 그대로 */
  slotLabel: string
  items: HeldRecord[]
}

/**
 * 시각별 묶음. **어느 시각에 무엇을 확보했는지**가 한눈에 보여야 한다는 게 3단계 요구다.
 *
 * 정렬은 `slot`(숫자 순서키)이 있으면 그것으로, 없으면 **등장 순서**로 한다 —
 * 라벨 문자열을 사전순으로 정렬하면 월드 스킨이 시각을 '초저녁/자정' 같은 말로
 * 바꿨을 때 시간이 뒤섞인다. 라벨은 읽는 것이지 비교하는 것이 아니다.
 */
export function groupBySlot(held: readonly HeldRecord[]): RecordGroup[] {
  const order = new Map<string, number>()
  const bag = new Map<string, HeldRecord[]>()
  held.forEach((r, i) => {
    const key = r.slotLabel
    const rank = r.slot ?? i
    const prev = order.get(key)
    if (prev === undefined || rank < prev) order.set(key, rank)
    const list = bag.get(key)
    if (list) list.push(r)
    else bag.set(key, [r])
  })
  return [...bag.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([slotLabel_, items]) => ({ slotLabel: slotLabel_, items }))
}

/* ─────────── 그리기 ─────────── */

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/** 사진 자리 — 있으면 정본 기록 뷰, 없으면(증거 깃발) 사진 없는 태그 */
function plateFor(r: HeldRecord): HTMLElement {
  if (!r.thumb) {
    const none = el('div', 'crv-plate crv-plate-none')
    none.setAttribute('aria-hidden', 'true')
    none.appendChild(el('span', 'crv-nophoto', '사진 없음'))
    return none
  }
  const plate = el('div', 'crv-plate')
  const img = document.createElement('img')
  img.className = 'crv-photo'
  img.src = r.thumb
  img.loading = 'lazy'
  img.decoding = 'async'
  img.draggable = false
  // 사진은 장식이 아니라 **알아보라고 있는 것**이지만, 이름·시각·장소가 바로 아래
  // 글자로 있으므로 스크린리더에는 중복이다. 캡션이 카드의 이름을 맡는다.
  img.alt = ''
  /**
   * 경로가 어긋나면 브라우저 기본 깨진 이미지가 뜬다 — 진열대에서 그건 사고다.
   * (썸네일 경로는 실제로 함정이 하나 있다: `manifest.json` 의 값은 vite glob 키라
   * `/public/` 이 붙어 있고, 정적 서빙 경로가 아니다.) 사진 없는 태그로 조용히 내려앉는다.
   */
  img.onerror = () => plate.replaceWith(plateFor({ ...r, thumb: null }))
  plate.appendChild(img)
  return plate
}

/** 기록 한 장 = 사진 + 이름 + 시각 + 장소. **그 넷이 전부다.** */
function cardFor(r: HeldRecord, index: number): HTMLElement {
  const li = el('li', 'crv-card')
  li.style.setProperty('--i', String(index))
  li.appendChild(plateFor(r))

  const cap = el('div', 'crv-cap')
  cap.appendChild(el('div', 'crv-name', r.kindLabel))
  const meta = el('dl', 'crv-meta')
  meta.appendChild(el('dt', undefined, '시각'))
  meta.appendChild(el('dd', undefined, r.slotLabel))
  meta.appendChild(el('dt', undefined, '장소'))
  meta.appendChild(el('dd', undefined, r.placeLabel))
  cap.appendChild(meta)
  li.appendChild(cap)
  return li
}

export interface CaseReviewHandlers {
  /** 다음 막으로 — 용의자를 만나러 간다 */
  next(): void
}

/**
 * 「현장 조사 종료」 진열대.
 *
 * **여기에 판정을 더하지 마라.** '후보 소거', '남은 후보 n명', '수사 상황' 은
 * 팀 지적으로 걷어낸 것이지 자리가 없어서 뺀 게 아니다. 숫자는 **확보 건수** 하나만
 * 남긴다 — 그건 해석이 아니라 셈이다.
 */
export function renderCaseReview(
  held: readonly HeldRecord[],
  on: CaseReviewHandlers,
): HTMLElement {
  const root = el('section', 'crv')
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', '확보한 기록')

  const hd = el('header', 'crv-hd')
  hd.appendChild(el('div', 'crv-kicker', '현장 조사 종료'))
  const titleRow = el('div', 'crv-titlerow')
  titleRow.appendChild(el('h2', 'crv-title', '확보한 기록'))
  titleRow.appendChild(el('div', 'crv-count', `${held.length}건`))
  hd.appendChild(titleRow)
  // 한 줄만 쓴다. 이 화면의 새 규칙("아무것도 판정해 주지 않는다")을 설명하지 않고 **말한다**.
  hd.appendChild(el('p', 'crv-lede',
    '현장에서 가져온 것은 여기까지다. 무엇을 뜻하는지는 여기 적혀 있지 않다.'))
  root.appendChild(hd)

  // 빈손일 때는 시각 축(열 격자)을 세우지 않는다 — 열 하나 폭(168px)에 문장이 갇혀
  // "빈손\n으로" 처럼 어절이 쪼개진다. 격자를 끄고 한 줄로 눕힌다.
  const body = el('div', held.length === 0 ? 'crv-body crv-hollow' : 'crv-body')
  if (held.length === 0) {
    body.appendChild(el('div', 'crv-empty', '가져온 기록이 없다. 빈손으로 취조실 문을 연다.'))
  } else {
    let n = 0
    for (const g of groupBySlot(held)) {
      const sec = el('section', 'crv-group')
      const rail = el('div', 'crv-rail')
      rail.appendChild(el('span', 'crv-time', g.slotLabel))
      rail.appendChild(el('span', 'crv-tally', `${g.items.length}건`))
      sec.appendChild(rail)
      const grid = el('ul', 'crv-grid')
      for (const r of g.items) grid.appendChild(cardFor(r, n++))
      sec.appendChild(grid)
      body.appendChild(sec)
    }
  }
  root.appendChild(body)

  const foot = el('footer', 'crv-foot')
  const go = el('button', 'crv-next', '용의자를 만난다') as HTMLButtonElement
  go.type = 'button'
  go.onclick = () => on.next()
  foot.appendChild(go)
  root.appendChild(foot)

  return root
}
