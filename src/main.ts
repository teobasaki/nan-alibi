/**
 * 오케스트레이터 — 씬 전환과 배선만 한다.
 *
 * 규칙(소개팅 MVP 에서 계승): **이 파일은 게임 규칙을 계산하지 않는다.**
 * 자원·판정·점수는 전부 `engine/` 이 소유하고, 여기서는 상태를 읽어 그리기만 한다.
 * 이 경계가 무너지면 headless 테스트가 게임을 증명하지 못하게 된다.
 */

import './style.css'
import { generateValidCase } from './engine/validate'
import {
  availableEvidence, claimCardId, connect, createGame, interview, lockedRecords, lookupEvidence,
  presentEvidence, presentReveal, submit, type GameState, type PresentReveal,
} from './engine/game'
import { cardSummary, renderCard } from './ui/cards'
import { josa } from './josa'
import { isMuted, play, setMuted, wake } from './ui/sound'
import { canSpeak, initVoice, speak, stop as stopVoice } from './ui/voice'
import { playIntro } from './ui/intro'
import { playOutro } from './ui/outro'
import type { Statement } from './engine/prompt'
import { record, stats } from './ui/records'
import { portraitFor } from './ui/portraits'
import { hasModel, mount, type Stage3D } from './ui/stage3d'
import { SLUG_BY_JOB } from './ui/roleSlug'
import { personaById } from './data/personas'
import { pickPoolSeed } from './data/pool'
import { candidatesFrom } from './engine/solver'
import { pendingPairs, placeMatrix } from './engine/crossref'
import { ask } from './api'
import {
  CRIME_PLACE, CRIME_SLOT, PLACES, PLACE_LABEL, SLOTS, SLOT_LABEL, SUSPECTS,
  type CaseFile, type Evidence, type Slot, type SuspectId,
} from './types'
import { INVESTIGATION_BUDGET, METHODS } from './data/config'

/**
 * 정형 질문 — **무엇을 확인하려는 질문인지 함께 적는다** (QA 5.2).
 *
 * "질문이 적절한지 판단할 기준이 없다" 는 것이 이 게임의 가장 큰 마찰이었다.
 * 그 상태에서는 추리 능력이 아니라 **AI 에게 질문을 잘 쓰는 능력**이 중요해진다.
 * 목적을 명시하면 플레이어는 문장을 고민하는 대신 **무엇을 검증할지**를 고른다.
 */
const PRESETS: readonly { q: string; why: string }[] = [
  { q: '사건 시간에 어디 계셨습니까?', why: '범행 시각의 위치를 받아낸다' },
  { q: '피해자와 어떤 관계였습니까?', why: '동기의 유무를 짚는다' },
  { q: '그걸 증명해 줄 사람이 있습니까?', why: '알리바이의 뒷받침을 확인한다' },
  { q: '왜 그 사실을 먼저 말하지 않았습니까?', why: '숨긴 것이 있는지 압박한다' },
]

interface Chat {
  q: string
  a: string
  fallback: boolean
  tell: string
  /**
   * 대사에서 뽑아낸 조서. **기록 노동은 시스템이 진다** (QA 5.3/5.4).
   * 플레이어가 긴 답변에서 시간·장소·행동을 직접 추출하고 있었고,
   * 그래서 "대화는 풍부한데 사건이 진전되지 않는" 느낌이 생겼다.
   */
  st?: Statement
}

/**
 * 상황판을 보는 **세 개의 각도** (QA 5.4).
 * 같은 사실을 세 축으로 놓는다 — 사람 기준 · 자리 기준 · 개인 조서.
 * 축을 바꾸면 안 보이던 것이 보인다. 정보를 더 주는 게 아니라 다르게 놓을 뿐이다.
 */
type View = 'time' | 'place' | 'person'

interface UI {
  game: GameState
  active: SuspectId | null
  view: View
  chats: Record<string, Chat[]>
  selected: string[]
  busy: boolean
  flash: string | null
  /** 방금 맞대본 결과 한 줄 — 일치했을 때도 알려줘야 "아무 일도 안 일어났다" 로 안 읽힌다 */
  note: string | null
  /** 이미 화면에 찍힌 인장 — 재렌더 때 전부 다시 찍히는 걸 막는다 */
  stamped: Set<string>
  /** 심문석 3D. 없거나 실패하면 null 이고 사진으로 폴백한다. */
  scene: { slug: string; handle: Stage3D | null } | null
  /** 재렌더 때 캔버스를 새로 만들지 않고 옮겨 붙이기 위한 보관 */
  sceneCanvas: HTMLCanvasElement | null
}

const app = document.querySelector<HTMLDivElement>('#app')!
/**
 * 시드는 **빌드 타임에 검증된 풀**에서 뽑는다 (ADR 012).
 * 이전에는 `Date.now() % 100000` 을 그대로 썼는데, 그러면 첫 화면에서
 * `generateValidCase` 가 최대 40회까지 재시도할 수 있었다. 풀은 그 재시도를 0회로 못 박는다.
 * `?seed=` 로 들어온 값은 그대로 존중한다 — 데모·재현·버그 신고 경로다.
 */
const seed = Number(new URLSearchParams(location.search).get('seed')) || (() => {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return pickPoolSeed(buf[0]! / 2 ** 32)
})()

const generated = generateValidCase(seed)
const CASE: CaseFile = generated.case

const ui: UI = {
  game: createGame(CASE),
  active: null,
  view: 'time',
  chats: Object.fromEntries(SUSPECTS.map((s) => [s, [] as Chat[]])),
  selected: [],
  busy: false,
  flash: null,
  note: null,
  stamped: new Set(),
  scene: null,
  sceneCanvas: null,
}

/**
 * 취조실 3D 호스트 — **한 번 만들고 재렌더에 살아남는다.**
 *
 * `render()` 는 `app.replaceChildren()` 로 트리를 통째로 갈아치운다. 그 안에서
 * 캔버스를 만들면 재렌더마다 WebGL 컨텍스트가 생겼다 사라지고, 비동기 `mount()` 와
 * 경합해 루프가 취소된 채 캔버스만 남는다 — 실제로 그렇게 **정지 화면**이 됐다
 * (rAF 1초에 0회, 픽셀 변화 0). 그래서 2D 처럼 보였다.
 *
 * 노드를 모듈 스코프에 두고 매 렌더에 `appendChild` 로 **옮기기만** 하면
 * 컨텍스트도 렌더 루프도 그대로 살아 있다.
 */
const roomEl = document.createElement('div')
roomEl.className = 'room3d'

/**
 * 말풍선 — 3D 인물의 **머리 옆**에 뜬다.
 * 아래 로그에도 대사가 남지만, 심문 중 눈은 얼굴에 가 있다.
 * 얼굴 옆에서 말이 나와야 "이 사람이 말하고 있다" 가 된다.
 */
const bubbleEl = document.createElement('div')
bubbleEl.className = 'bubble3d'
roomEl.appendChild(bubbleEl)

// 조작이 있다는 걸 알려 준다 — 안 알려주면 아무도 끌어보지 않는다
const hintEl = document.createElement('div')
hintEl.className = 'hint3d'
hintEl.textContent = '끌어서 둘러보기 · 휠로 다가가기'
roomEl.appendChild(hintEl)

/** 얼굴 위치를 따라 말풍선을 옮긴다. 3D 는 매 프레임 움직이므로 계속 따라가야 한다. */
let bubbleRaf = 0
function trackBubble(): void {
  cancelAnimationFrame(bubbleRaf)
  const step = (): void => {
    bubbleRaf = requestAnimationFrame(step)
    const h = ui.scene?.handle
    if (!h || !bubbleEl.classList.contains('on')) return
    const p = h.facePoint()
    bubbleEl.style.left = `${Math.min(78, Math.max(6, p.x * 100 + 12))}%`
    bubbleEl.style.top = `${Math.min(74, Math.max(4, p.y * 100 - 16))}%`
  }
  step()
}

function say(text: string): void {
  bubbleEl.textContent = text
  bubbleEl.classList.add('on')
  // rAF 가 안 도는 상황(숨김 탭 등)에서도 최소 한 번은 자리를 잡아 둔다
  const h0 = ui.scene?.handle
  if (h0) {
    const p0 = h0.facePoint()
    bubbleEl.style.left = `${Math.min(78, Math.max(6, p0.x * 100 + 12))}%`
    bubbleEl.style.top = `${Math.min(74, Math.max(4, p0.y * 100 - 16))}%`
  }
  trackBubble()
}
function hush(): void {
  bubbleEl.classList.remove('on')
  cancelAnimationFrame(bubbleRaf)
}

const h = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

/* ─────────── 상단 바 ─────────── */
function topbar(): HTMLElement {
  const bar = h('div', 'topbar')
  bar.appendChild(h('h1', undefined, `FIVE ALIBIS — ${CASE.title}`))
  bar.appendChild(h('div', 'brief',
    `${CASE.venue.name} ${CASE.venue.room} · 피해자 ${CASE.victim.name}(${CASE.victim.title}) · 추정 범행 ${SLOT_LABEL[CRIME_SLOT]}`))

  const budget = h('div', 'budget')
  budget.appendChild(h('span', 'label', '남은 조사'))
  for (let i = 0; i < INVESTIGATION_BUDGET; i++) budget.appendChild(h('i', `pip${i < ui.game.investigationsLeft ? '' : ' spent'}`))
  bar.appendChild(budget)

  const mute = focusKey(h('button', 'mutebtn', isMuted() ? '♪ 꺼짐' : '♪ 켜짐'), 'mute') as HTMLButtonElement
  mute.setAttribute('aria-label', isMuted() ? '소리 켜기' : '소리 끄기')
  mute.onclick = () => { setMuted(!isMuted()); if (!isMuted()) play('paper'); render() }
  bar.appendChild(mute)

  const btn = h('button', undefined, '범인 지목') as HTMLButtonElement
  focusKey(btn, 'submit')
  btn.onclick = openSubmit
  bar.appendChild(btn)
  return bar
}

/* ─────────── 왼쪽: 용의자 ─────────── */
function suspectColumn(): HTMLElement {
  const col = h('div', 'col')
  col.appendChild(h('h2', undefined, '용의자'))

  for (const s of SUSPECTS) {
    const sus = CASE.suspects[s]
    // div+onclick 이 아니라 버튼 시맨틱을 준다 — 키보드만으로도 게임의 첫 행동이 가능해야 한다
    const card = h('div', `suspect${ui.active === s ? ' active' : ''}`)
    card.setAttribute('role', 'button')
    card.tabIndex = 0
    card.setAttribute('aria-pressed', String(ui.active === s))
    card.setAttribute('aria-label', `${sus.name} ${sus.job} 심문하기`)
    focusKey(card, `suspect:${s}`)
    const choose = (): void => { hush(); stopVoice(); ui.active = s; render() }
    card.onclick = choose
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }

    const row = h('div', 'row')
    // 이모지 얼굴(👤/🙂/😰)은 어느 게임에나 붙는 기본값이었고, 다섯 명이 전부 같은 얼굴이라
    // 인물의 정체성을 오히려 지웠다. 놋쇠 문패에 새긴 성(姓) 으로 바꾼다 — 호텔의 물건이다.
    // 사진이 있으면 사진, 없으면 놋쇠 명패. 에셋 0장에서도 화면이 깨지지 않는다.
    const shot = portraitFor(sus.job)
    const face = h('div', shot ? 'face photo' : 'face plate', shot ? '' : sus.name[0]!)
    if (shot) face.style.backgroundImage = `url(${shot})`
    row.appendChild(face)
    const info = h('div')
    info.appendChild(h('div', 'name', sus.name))
    info.appendChild(h('div', 'job', sus.job))
    row.appendChild(info)
    card.appendChild(row)
    card.appendChild(h('div', 'relation', sus.relation))
    // 22:20 주장은 가운데 격자가 보여준다 — 여기 또 적으면 같은 문장이 화면에 세 번 나온다.

    const pr = ui.game.pressure[s]
    if (pr > 0) {
      const gauge = h('div', 'gauge')
      const fill = h('i')
      fill.style.width = `${pr}%`
      gauge.appendChild(fill)
      card.appendChild(gauge)
      card.appendChild(h('div', 'prlabel', pr >= 60 ? '몹시 흔들린다' : pr >= 30 ? '흔들린다' : '평정'))
    }
    col.appendChild(card)
  }
  return col
}

/* ─────────── 중앙: 인터뷰 ─────────── */
/**
 * 응답은 1.7초 만에 통째로 도착한다. 타이핑 연출로 "말하는 중" 을 만든다 —
 * 구조화 출력의 부분 JSON 파싱 없이 스트리밍과 같은 체감을 얻는 방법 (ADR 005).
 */
function typeInto(node: HTMLElement, text: string): void {
  // CSS 미디어 쿼리로는 못 잡는 JS 애니메이션이다. 여기서 직접 존중한다.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.textContent = text
    return
  }
  node.textContent = ''
  let i = 0
  const tick = (): void => {
    node.textContent = text.slice(0, ++i)
    if (i < text.length) setTimeout(tick, 28)
  }
  tick()
}

function tellLabel(t: string): string {
  const m: Record<string, string> = {
    gaze: '(시선을 피한다)', pause: '(잠시 말이 멎는다)',
    stammer: '(말이 꼬인다)', anger: '(언성이 높아진다)',
  }
  return m[t] ?? ''
}

function stage(): HTMLElement {
  const col = h('div', 'col')
  const box = h('div', 'stage')

  if (!ui.active) {
    box.appendChild(situationBoard())
    col.appendChild(box)
    return col
  }

  const s = ui.active
  const sus = CASE.suspects[s]
  const persona = personaById(sus.personaId)
  const tense = ui.game.pressure[s] >= 60
  // 압박이 높으면 방이 좁아진다 — 조명이 붉게 조여든다 (분위기 층 ④)
  if (tense) box.classList.add('tense')

  const slug = SLUG_BY_JOB[sus.job]
  const use3d = !!slug && hasModel(slug)

  // 3D 는 **장면**이지 인물 썸네일이 아니다. 취조실을 132px 상자에 담으면
  // 테이블도 갓등도 안 보이고 그냥 어두운 흉상이 된다. 가로로 통째로 쓴다.
  let big: HTMLElement | null = null
  if (use3d) {
    big = roomEl              // 새로 만들지 않는다 — 옮겨 붙일 뿐이다
    box.appendChild(roomEl)
  }

  const p = h('div', 'portrait')
  const shot = portraitFor(sus.job)
  if (!use3d) {
    big = h('div', `big ${shot ? 'photo' : 'plate'}${tense ? ' tense' : ''}`, shot ? '' : sus.name[0]!)
    if (shot) big.style.backgroundImage = `url(${shot})`
    p.appendChild(big)
  }

  // 3D 는 **비동기로 붙는다.** 붙기 전까지는 빈 자리이고, 실패하면 그대로 사진으로 돌아간다.
  // 재렌더마다 다시 만들면 매 행동에 모델을 새로 받는다 — 같은 인물이면 그대로 둔다.
  if (use3d) {
    if (ui.scene?.slug !== slug) {
      ui.scene?.handle?.dispose()
      ui.scene = { slug: slug!, handle: null }
      const target = big!
      void mount(target, slug!).then((handle) => {
        if (ui.scene?.slug !== slug) return handle?.dispose()
        ui.scene.handle = handle
        if (handle) {
          // 문이 열리고 방이 드러난다
          roomEl.classList.remove('opening')
          void roomEl.offsetWidth        // 리플로우 강제 — 같은 인물을 다시 열어도 연출이 돈다
          roomEl.classList.add('opening')
          play('doorOpen')
          handle.onCreak(() => play('creak'))
        }
        if (!handle) {
          // 3D 가 실패했다 — 자리를 접고 사진으로 되돌린다
          roomEl.remove()
          const fb = h('div', `big ${shot ? 'photo' : 'plate'}${tense ? ' tense' : ''}`, shot ? '' : sus.name[0]!)
          if (shot) fb.style.backgroundImage = `url(${shot})`
          p.prepend(fb)
        }
        handle?.setPressure(ui.game.pressure[s])
      })
    } else if (ui.scene.handle) {
      // 호스트가 영속 노드라 캔버스를 옮길 필요가 없다. 상태만 갱신한다.
      ui.scene.handle.setPressure(ui.game.pressure[s])
    }
  } else if (ui.scene) {
    ui.scene.handle?.dispose()
    ui.scene = null
  }
  const meta = h('div')
  meta.appendChild(h('div', 'name', `${sus.name} · ${sus.job}`))
  meta.appendChild(h('div', 'hint', `읽힌 성향: ${persona.label} — ${persona.hint}`))
  p.appendChild(meta)
  const back = focusKey(h('button', 'backbtn', '← 대조표'), 'back') as HTMLButtonElement
  back.onclick = () => { hush(); stopVoice(); ui.active = null; render() }
  p.appendChild(back)
  box.appendChild(p)

  const log = h('div', 'log')
  for (const c of ui.chats[s]!) {
    log.appendChild(h('div', 'bubble q', c.q))
    const a = h('div', `bubble a${c.fallback ? ' fallback' : ''}`)
    a.appendChild(h('div', undefined, c.a))
    if (c.tell !== 'none') a.appendChild(h('div', 'tell', tellLabel(c.tell)))
    /**
     * **조서** — 대사와 분리해 한 줄로 남긴다.
     * 무엇을 새로 말했는지가 한눈에 보여야 조사 한 번의 값이 읽힌다.
     */
    if (c.st && (c.st.time || c.st.place || c.st.action)) {
      const parts = [c.st.time, c.st.place, c.st.action].filter(Boolean)
      const rec = h('div', `stmt${c.st.newInfo ? ' fresh' : ''}`)
      rec.appendChild(h('span', 'stmt-k', c.st.newInfo ? '새 진술' : '기존 진술'))
      rec.appendChild(h('span', 'stmt-v', parts.join(' · ')))
      if (c.st.certainty !== '확언') rec.appendChild(h('span', 'stmt-c', c.st.certainty))
      a.appendChild(rec)
    }
    log.appendChild(a)
  }
  if (ui.busy) log.appendChild(h('div', 'bubble a', '…'))
  box.appendChild(log)
  box.appendChild(askBox(s))
  col.appendChild(box)
  queueMicrotask(() => { log.scrollTop = log.scrollHeight })
  return col
}

/**
 * 알리바이 격자 — 이 게임의 **시그니처**.
 *
 * 추리의 실체는 처음부터 "누가 · 언제 · 어디" 의 5×5 표였다. 그런데 그 표가
 * 카드 더미와 대화 로그에 흩어져 있어서, 플레이어는 머릿속에서 표를 다시 그려야 했다
 * (초회 플레이 지적: "내가 어느 부분부터 해야 되는 거며").
 * 그 표를 화면 한가운데에 세운다. 아무도 선택하지 않은 상태가 곧 수사 상황판이다.
 *
 * 규칙은 계산하지 않는다 — 상태를 읽어 그리기만 한다 (이 파일의 경계).
 */
function alibiGrid(): HTMLElement {
  const wrap = h('div', 'gridwrap')
  // **누가 아직 후보인가** 를 표에 직접 보여준다.
  // 물증만이 위치를 확정하므로, 범행 시각 기록에 '현장이 아닌 곳' 으로 찍힌 사람은 소거된다.
  // 규칙은 engine 이 소유한다 — 여기서는 그 결과를 읽어 그리기만 한다.
  const cands = candidatesFrom(CASE, new Set(ui.game.cards))
  wrap.appendChild(h('div', 'cap', '알리바이 대조표'))
  wrap.appendChild(h('div', 'sub',
    `가로는 시각, 세로는 사람이다. ${SLOT_LABEL[CRIME_SLOT]} 열이 범행 시각이다. ` +
    `심문하면 그 사람의 나머지 시각이 채워지고, 기록과 어긋나면 붉은 인장이 찍힌다. ` +
    `이름을 누르면 심문이 시작된다.`))
  wrap.appendChild(h('div', 'candline',
    cands.length === 1
      ? `남은 후보 1명 — ${CASE.suspects[cands[0]!].name}. 기록만으로 한 사람이 확정됐다.`
      : `남은 후보 ${cands.length}명 — 진술이 아니라 기록만이 사람을 지운다. ` +
        `범행 시각 기록에 현장 아닌 곳으로 찍히면 그 사람은 소거된다.`))

  const slots = [0, 1, 2, 3, 4] as Slot[]
  const g = h('div', 'agrid')
  g.appendChild(h('div', 'hd', ''))
  for (const t of slots) g.appendChild(h('div', `hd${t === CRIME_SLOT ? ' now' : ''}`, SLOT_LABEL[t]))

  for (const s of SUSPECTS) {
    const sus = CASE.suspects[s]
    const who = h('div', `who${cands.includes(s) ? '' : ' out'}`)
    who.setAttribute('role', 'button')
    who.tabIndex = 0
    who.setAttribute('aria-label', `${sus.name} 심문하기`)
    focusKey(who, `gridwho:${s}`)
    who.appendChild(document.createTextNode(sus.name))
    who.appendChild(h('small', undefined, sus.job))
    if (!cands.includes(s)) who.appendChild(h('small', 'cleared', '기록으로 소거됨'))
    const choose = (): void => { ui.active = s; render() }
    who.onclick = choose
    who.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }
    g.appendChild(who)

    for (const t of slots) {
      const known = ui.game.cards.includes(claimCardId(s, t))
      const bad = ui.game.foundContradictions.some((k) => {
        const [, who2, slot] = k.split('|')
        return who2 === s && Number(slot) === t
      })
      const cid = claimCardId(s, t)
      const sel = ui.selected.includes(cid)
      // 인장 애니메이션은 **처음 찍힐 때 한 번만** 돈다.
      // 전체 재렌더 구조라 그냥 두면 행동할 때마다 모든 인장이 다시 찍혔다.
      const stampKey = `${s}:${t}`
      const fresh = bad && !ui.stamped.has(stampKey)
      if (bad) ui.stamped.add(stampKey)
      const cell = h('div',
        `cell${t === CRIME_SLOT ? ' now' : ''}${known ? '' : ' unknown'}${bad ? ' bad' : ''}${sel ? ' sel' : ''}${fresh ? ' fresh' : ''}`)
      cell.appendChild(h('span', undefined, known ? PLACE_LABEL[sus.claim[t]!] : '—'))
      // **칸이 곧 진술 카드다.** 예전엔 같은 진술이 왼쪽 카드·격자·오른쪽 보유카드에 세 번 나왔다.
      // 격자에서 바로 집게 하면 중복이 사라지고, 연결이 "표 위의 한 칸을 짚는" 공간적 행동이 된다.
      if (known) {
        cell.setAttribute('role', 'button')
        cell.tabIndex = 0
        cell.setAttribute('aria-pressed', String(sel))
        cell.setAttribute('aria-label', `${sus.name} ${SLOT_LABEL[t]} 진술 — 연결하려면 선택`)
        focusKey(cell, `cell:${cid}`)
        cell.onclick = () => pickCard(cid)
        cell.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickCard(cid) } }
      }
      g.appendChild(cell)
    }
  }

  // 열 아래 — 그 시각에 내가 확보한 기록 수. "어느 시각이 아직 비었나" 가 다음 행동이 된다.
  g.appendChild(h('div', 'foot', '확보 기록'))
  for (const t of slots) {
    const n = CASE.evidence.filter((e) => ui.game.cards.includes(e.id) && e.slot === t).length
    g.appendChild(h('div', `foot${n ? ' has' : ''}`, n ? `${n}건` : '없음'))
  }
  wrap.appendChild(g)
  return wrap
}

/** 기록 한 건을 사람이 읽는 이름으로. `E1` 같은 내부 id 는 화면에 나오면 안 된다. */
function evLabel(evId: string): string {
  const e = CASE.evidence.find((x) => x.id === evId)
  return e ? `${labelOfKind(e.kind)} · ${SLOT_LABEL[e.slot]} ${PLACE_LABEL[e.place]}` : evId
}

/**
 * 상황판 — **같은 사실을 세 각도로 놓는다** (QA 5.4).
 *
 * 초회 플레이 지적의 핵심은 "기억하기 어렵다" 였고, 그 진단은 기억력이 아니라
 * **정보 구조**였다. 다섯 사람 × 다섯 시각이 대화 로그와 카드 더미에 흩어져 있으니
 * 플레이어가 머릿속에서 표를 다시 그리느라 추리할 시간을 다 썼다.
 *
 * 여기서 새 정보를 주지는 **않는다** — 이미 확보한 것을 다르게 놓을 뿐이다.
 * 그래서 탭을 옮겨도 조사 횟수는 소모되지 않고, 아직 모르는 칸은 세 각도 모두에서 비어 있다.
 */
function situationBoard(): HTMLElement {
  const wrap = h('div', 'boardview')

  const tabs = h('div', 'viewtabs')
  const TABS: [View, string, string][] = [
    ['time', '시각별', '누가 · 언제 · 어디라고 했나'],
    ['place', '장소별', '그 시각 그 자리에 누가 있었나'],
    ['person', '인물별', '이 사람이 무엇을 말했나'],
  ]
  for (const [v, label, why] of TABS) {
    const b = h('button', `viewtab${ui.view === v ? ' on' : ''}`) as HTMLButtonElement
    b.appendChild(h('span', 'vt-l', label))
    b.appendChild(h('span', 'vt-w', why))
    b.setAttribute('aria-pressed', String(ui.view === v))
    focusKey(b, `view:${v}`)
    b.onclick = () => { play('paper'); ui.view = v; render() }
    tabs.appendChild(b)
  }
  wrap.appendChild(tabs)

  wrap.appendChild(ui.view === 'time' ? alibiGrid() : ui.view === 'place' ? placeGrid() : personSheets())
  wrap.appendChild(pendingBlock())
  wrap.appendChild(findingsBlock())
  return wrap
}

/**
 * 장소별 대조표 — **알리바이 격자의 축을 뒤집은 것.**
 *
 * 인물 격자는 "그 사람이 어디 있었다고 하는가" 를 답한다. 뒤집으면 인물 격자가
 * 구조적으로 못 보여주는 두 가지가 보인다.
 *
 * ① **누가 누구와 함께 있었다고 주장하는가** — 한 칸에 이름이 둘 모이면 서로의 알리바이다.
 * ② **한 사람이 같은 세로줄에 두 번 나오는가** — 본인 말로 한 번, 기록으로 한 번.
 *    사람은 한 시각에 한 곳에만 있으므로 둘 중 하나는 거짓이다.
 *
 * ②를 **시스템이 판정하지 않는다는 점이 중요하다.** 이름을 제자리에 놓는 것까지가
 * 기록 노동이고, 두 번 나온 이름을 알아보는 것이 추리다. QA 가 요구한 경계도 이것이다 —
 * "모순 후보를 표시하되, 모순의 의미는 플레이어가 판단하게 한다."
 */
function placeGrid(): HTMLElement {
  const wrap = h('div', 'gridwrap')
  wrap.appendChild(h('div', 'cap', '장소별 대조표'))
  wrap.appendChild(h('div', 'sub',
    `가로는 시각, 세로는 장소다. 한 칸에 이름이 모이면 그 시각 그 자리에 함께 있었다는 주장이다. ` +
    `테두리만 있는 이름은 본인 주장이고, 채워진 이름은 기록으로 확정된 위치다. ` +
    `사람은 한 시각에 한 곳에만 있다 — 같은 세로줄에 한 이름이 두 번 나오면 둘 중 하나는 거짓이다.`))

  const m = placeMatrix(ui.game)
  const g = h('div', 'pgrid')
  g.appendChild(h('div', 'hd', ''))
  for (const t of SLOTS) g.appendChild(h('div', `hd${t === CRIME_SLOT ? ' now' : ''}`, SLOT_LABEL[t]))

  for (const p of PLACES) {
    const rowHd = h('div', `pwho${p === CRIME_PLACE ? ' scene' : ''}`)
    rowHd.appendChild(document.createTextNode(PLACE_LABEL[p]))
    if (p === CRIME_PLACE) rowHd.appendChild(h('small', 'cleared', '사건 현장'))
    g.appendChild(rowHd)

    for (const t of SLOTS) {
      const cell = m[p]![t]!
      const box = h('div', `pcell${t === CRIME_SLOT ? ' now' : ''}${p === CRIME_PLACE ? ' scene' : ''}`)

      // 기록으로 확정된 사람이 먼저다 — 진술보다 무겁다
      for (const s of cell.pinned) {
        const chip = h('span', 'nchip pin', CASE.suspects[s].name)
        const evId = cell.records[0]!
        chip.setAttribute('role', 'button')
        chip.tabIndex = 0
        chip.setAttribute('aria-label', `${CASE.suspects[s].name} — ${evLabel(evId)} 기록으로 확정. 연결하려면 선택`)
        if (ui.selected.includes(evId)) chip.classList.add('sel')
        focusKey(chip, `pchip:${evId}:${s}`)
        chip.onclick = () => pickCard(evId)
        chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickCard(evId) } }
        box.appendChild(chip)
      }
      // 진술은 **기록에 이미 확정된 사람은 빼고** 그린다 — 같은 칸에 같은 이름을 두 번 그리면
      // 세로줄의 중복(진짜 신호)이 안 보인다
      for (const s of cell.claimants) {
        if (cell.pinned.includes(s)) continue
        const cid = claimCardId(s, t)
        // 이미 찾아낸 모순은 **두 표에서 같게 보여야 한다.** 시각별 격자가 붉은 인장을 찍는
        // 진술에 장소별 표만 아무 표시가 없으면, 같은 사실이 화면마다 달라 보인다.
        const bad = ui.game.foundContradictions.some((k) => {
          const [, who, slot] = k.split('|')
          return who === s && Number(slot) === t
        })
        const chip = h('span',
          `nchip say${bad ? ' bad' : ''}${ui.selected.includes(cid) ? ' sel' : ''}`, CASE.suspects[s].name)
        chip.setAttribute('role', 'button')
        chip.tabIndex = 0
        chip.setAttribute('aria-label', `${CASE.suspects[s].name} ${SLOT_LABEL[t]} 진술 — 연결하려면 선택`)
        focusKey(chip, `pchip:${cid}`)
        chip.onclick = () => pickCard(cid)
        chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickCard(cid) } }
        box.appendChild(chip)
      }

      if (cell.records.length) {
        // 남김없는 기록(CCTV)은 **없는 이름이 곧 정보**다. 그 사실을 칸에 적어둔다.
        box.appendChild(h('div', 'prec',
          cell.exhaustive
            ? `${cell.records.map(evLabel).join(' · ')} — 구역 전체`
            : cell.records.map(evLabel).join(' · ')))
      }
      if (!cell.pinned.length && !cell.claimants.length && !cell.records.length) {
        box.classList.add('unknown')
        box.appendChild(h('span', 'pdash', '—'))
      }
      g.appendChild(box)
    }
  }
  wrap.appendChild(g)
  return wrap
}

/**
 * 인물별 조서 — 한 사람이 지금까지 말한 것을 **말한 순서대로** 모은다.
 *
 * 조서는 원래 그 사람 대화 로그 안에만 있었다. 방을 나오면 사라지니,
 * "누가 뭐라고 했더라" 를 확인하려면 다시 들어가 스크롤해야 했다 — 그게 QA 가 말한
 * "메모와 재확인에 시간이 많이 든다" 의 실체다. 순서대로 쌓아두면 **진술이 바뀐 것도
 * 같이 드러난다** — 앞뒤로 다른 말을 했으면 두 줄이 나란히 남는다.
 */
function personSheets(): HTMLElement {
  const wrap = h('div', 'gridwrap')
  wrap.appendChild(h('div', 'cap', '인물별 조서'))
  wrap.appendChild(h('div', 'sub',
    '심문에서 받아 적은 것을 사람마다 말한 순서대로 모았다. ' +
    '앞뒤로 다른 말을 했으면 두 줄이 나란히 남는다 — 그 사이가 볼 만한 자리다.'))

  const cands = candidatesFrom(CASE, new Set(ui.game.cards))
  for (const s of SUSPECTS) {
    const sus = CASE.suspects[s]
    const sheet = h('div', `dossier${cands.includes(s) ? '' : ' out'}`)

    const head = h('div', 'dossier-hd')
    head.setAttribute('role', 'button')
    head.tabIndex = 0
    head.setAttribute('aria-label', `${sus.name} 심문하기`)
    focusKey(head, `sheet:${s}`)
    const choose = (): void => { ui.active = s; render() }
    head.onclick = choose
    head.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }
    head.appendChild(h('span', 'dossier-name', sus.name))
    head.appendChild(h('span', 'dossier-job', sus.job))
    if (!cands.includes(s)) head.appendChild(h('span', 'dossier-out', '기록으로 소거됨'))
    else if (ui.game.pressure[s] >= 60) head.appendChild(h('span', 'dossier-hot', '동요 높음'))
    sheet.appendChild(head)

    sheet.appendChild(h('div', 'dossier-rel', `피해자와의 관계 — ${sus.relation}`))

    // 확보한 궤적 한 줄. 모르는 칸은 감춘다.
    const traj = SLOTS
      .filter((t) => ui.game.cards.includes(claimCardId(s, t)))
      .map((t) => `${SLOT_LABEL[t]} ${PLACE_LABEL[sus.claim[t]!]}`)
    sheet.appendChild(h('div', 'dossier-traj', traj.length ? traj.join('  ›  ') : '아직 받아낸 진술이 없다'))

    const said = ui.chats[s]!.filter((c) => c.st && (c.st.time || c.st.place || c.st.action))
    if (said.length === 0) {
      sheet.appendChild(h('div', 'hintline', '아직 조서에 적힌 것이 없다. 심문해야 채워진다.'))
    }
    for (const c of said) {
      const st = c.st!
      const row = h('div', `stmt${st.newInfo ? ' fresh' : ''}`)
      row.appendChild(h('span', 'stmt-k', st.newInfo ? '새 진술' : '기존 진술'))
      row.appendChild(h('span', 'stmt-v', [st.time, st.place, st.action].filter(Boolean).join(' · ')))
      if (st.certainty !== '확언') row.appendChild(h('span', 'stmt-c', st.certainty))
      sheet.appendChild(row)
    }

    const mine = ui.game.foundContradictions.filter((k) => k.split('|')[1] === s)
    for (const k of mine) {
      const [evId, , slot] = k.split('|') as [string, string, string]
      sheet.appendChild(h('div', 'contradiction',
        `${SLOT_LABEL[Number(slot) as Slot]} 진술이 ${evLabel(evId)} 기록과 어긋난다.`))
    }
    wrap.appendChild(sheet)
  }
  return wrap
}

/**
 * 미대조 조합 — **판정이 아니라 장부다.**
 *
 * "손에 쥔 기록과 진술 중 아직 안 맞춰본 것" 만 말한다. 맞춰보면 무슨 일이 나는지는
 * 말하지 않는다 — 그걸 말하면 이 게임에 남은 유일한 추론 행위가 사라진다.
 * 연결은 조사를 소모하지 않으므로 이 목록을 비우는 것은 언제나 이득이고,
 * 그래서 "다음에 뭘 하지" 가 막힌 플레이어에게 **공짜 다음 수**가 된다.
 */
function pendingBlock(): HTMLElement {
  const pend = pendingPairs(ui.game)
  const wrap = h('div', 'findings pending')
  wrap.appendChild(h('h3', undefined, `아직 안 맞춰본 조합 (${pend.length})`))
  if (pend.length === 0) {
    wrap.appendChild(h('div', 'hintline',
      '지금 손에 쥔 기록과 진술은 전부 맞대봤다. 새 기록을 조회하거나 심문해야 새 조합이 생긴다.'))
    return wrap
  }
  wrap.appendChild(h('div', 'hintline',
    '맞대보면 어긋나는지 아닌지 알 수 있다. 연결은 조사를 소모하지 않는다.'))
  if (ui.note) wrap.appendChild(h('div', 'pendnote', ui.note))
  // 너무 길어지면 목록이 곧 소음이 된다 — 범행 시각이 위로 오도록 이미 정렬돼 있다
  const SHOW = 6
  for (const p of pend.slice(0, SHOW)) {
    const row = h('div', 'pendrow')
    row.appendChild(h('span', 'pend-t',
      `${evLabel(p.evidenceId)}  ↔  ${CASE.suspects[p.suspect].name}의 ${SLOT_LABEL[p.slot]} 진술`))
    const b = h('button', 'pendbtn', '맞대보기') as HTMLButtonElement
    b.disabled = ui.busy
    focusKey(b, `pend:${p.evidenceId}:${p.claimCardId}`)
    b.onclick = () => {
      // 선택 상태를 거치지 않고 바로 연결한다 — 두 번 클릭시키면 장부의 값이 사라진다
      ui.selected = []
      const r = connect(ui.game, p.evidenceId, p.claimCardId)
      ui.game = r.state
      play(r.contradiction ? 'stamp' : 'deny')
      ui.flash = r.contradiction ? p.evidenceId : null
      ui.note = r.message
      render()
      if (r.contradiction) setTimeout(() => { ui.flash = null; render() }, 600)
    }
    row.appendChild(b)
    wrap.appendChild(row)
  }
  if (pend.length > SHOW) {
    wrap.appendChild(h('div', 'hintline', `그 밖에 ${pend.length - SHOW}건 더 있다.`))
  }
  return wrap
}

/** 발견한 모순 — 세 각도 어디에서 보든 같은 자리에 있어야 한다. */
function findingsBlock(): HTMLElement {
  const f = h('div', 'findings')
  f.appendChild(h('h3', undefined, `발견한 모순 (${ui.game.foundContradictions.length})`))
  if (ui.game.foundContradictions.length === 0) {
    f.appendChild(h('div', 'hintline',
      '기록 한 장과 진술 한 장을 연결하십시오. 연결은 조사를 소모하지 않습니다.'))
  }
  for (const key of ui.game.foundContradictions) {
    const parts = key.split('|')
    const sid = parts[1] as SuspectId
    const slot = Number(parts[2]) as Slot
    f.appendChild(h('div', 'contradiction',
      `${CASE.suspects[sid].name}의 ${SLOT_LABEL[slot]} 진술이 ${evLabel(parts[0]!)} 기록과 어긋난다.`))
  }
  return f
}

function askBox(s: SuspectId): HTMLElement {
  const wrap = h('div', 'ask')
  const chips = h('div', 'chips')
  const input = h('input') as HTMLInputElement
  input.placeholder = '직접 질문을 입력하십시오'
  input.maxLength = 200

  for (const { q, why } of PRESETS) {
    // 질문 아래 목적을 함께 적는다 — 무엇을 확인하려는 질문인지 알고 눌러야 한다
    const c = h('button', 'chip') as HTMLButtonElement
    c.appendChild(h('span', 'chip-q', q))
    c.appendChild(h('span', 'chip-why', why))
    c.onclick = () => { input.value = q; input.focus() }
    chips.appendChild(c)
  }
  wrap.appendChild(chips)

  const row = h('div', 'askrow')
  row.appendChild(input)
  const send = h('button', undefined, '심문') as HTMLButtonElement
  send.disabled = ui.busy || ui.game.investigationsLeft <= 0
  send.onclick = () => { void doAsk(s, input.value) }
  input.onkeydown = (e) => {
    // 한글 IME: 조합 확정용 Enter 와 전송용 Enter 는 다르다.
    // isComposing 을 안 보면 "안녕하세" 상태에서 질문이 잘린 채 전송되고,
    // 조사 1회가 그대로 날아간다 (되돌릴 수 없는 자원이다).
    if (e.isComposing) return
    if (e.key === 'Enter') void doAsk(s, input.value)
  }
  row.appendChild(send)
  row.appendChild(h('span', 'cost', `조사 ${ui.game.investigationsLeft} → ${Math.max(0, ui.game.investigationsLeft - 1)}`))
  wrap.appendChild(row)

  if (ui.selected.length === 1) {
    const evId = ui.selected[0]!
    // 버튼을 조건부로 비활성화하면 **활성화 자체가 정답을 유출한다** (해금 쌍은 범인에게만 있다).
    // 항상 누를 수 있게 두고, 헛수고의 책임은 플레이어가 진다.
    const present = h('button', undefined, '선택한 카드를 들이민다 (조사 1회)') as HTMLButtonElement
    present.disabled = ui.busy || ui.game.investigationsLeft <= 0
    present.style.marginTop = '7px'
    present.onclick = () => { void doPresent(s, evId) }
    wrap.appendChild(present)
    wrap.appendChild(h('div', 'hintline', '엉뚱한 상대에게 들이밀면 조사만 소모된다.'))
  }
  return wrap
}

/* ─────────── 오른쪽: 사건 보드 ─────────── */
function labelOfKind(k: string): string {
  const m: Record<string, string> = { keycard: '카드키 기록', cctv: 'CCTV', call: '통화 내역', receipt: '영수증' }
  return m[k] ?? k
}

function board(): HTMLElement {
  const col = h('div', 'col')

  col.appendChild(h('h2', undefined, '기록 조회'))
  const lookup = h('div', 'lookup')
  const avail = availableEvidence(ui.game)
  if (avail.length === 0) {
    lookup.appendChild(h('div', 'hintline', '지금 조회할 수 있는 기록이 없다. 심문으로 실마리를 열어야 한다.'))
  }
  // **정렬로는 부족했다.** 범행 시각 기록을 위로 올려도 초회 플레이어는 여전히
  // 목록을 위에서부터 훑고 지나갔다 (자동 리뷰 major/onboarding, 두 라운드 연속).
  // 아예 구역을 갈라 이름을 붙인다 — 사람을 지우는 기록과 그렇지 않은 기록은 다른 물건이다.
  const groups: [string, typeof avail][] = [
    [`${SLOT_LABEL[CRIME_SLOT]} — 후보를 지우는 기록`, avail.filter((e) => e.slot === CRIME_SLOT)],
    ['그 밖의 시각 — 해금·교차검증용', avail.filter((e) => e.slot !== CRIME_SLOT)],
  ]
  for (const [title, list] of groups) {
    if (list.length === 0) continue
    lookup.appendChild(h('div', 'grouphd', title))
    for (const e of list) buildLookupButton(lookup, e)
  }
  col.appendChild(lookup)

  function buildLookupButton(into: HTMLElement, e: Evidence): void {
    // 기록실 색인처럼 **무엇을 여는지**는 보여주고 **누가 찍혔는지**는 감춘다.
    // 라벨이 전부 "영수증 조회" 로 같으면 플레이어는 찍기밖에 못 하고,
    // 그 순간 "무엇을 먼저 볼 것인가" 라는 이 게임의 전략이 사라진다.
    // 범행 시각 기록만이 사람을 지운다. 그 사실을 **조회 전에** 밝힌다 —
    // 규칙을 아는 것과 목록에서 알아보는 것은 다르다 (자동 리뷰 major/onboarding).
    const label = `${labelOfKind(e.kind)} · ${SLOT_LABEL[e.slot]} ${PLACE_LABEL[e.place]}`
    const use = e.slot === CRIME_SLOT ? '후보 소거' : '해금·교차검증'
    // 같은 시각·장소 기록이 두 장이면 조회 전에는 **완전히 똑같아 보여** 선택이 동전 던지기가 된다.
    // 기록번호를 붙여 구분한다 — 내용을 흘리지 않으면서 "다른 문서" 임을 알린다 (자동 리뷰 minor/fairness).
    const b = h('button', undefined, `[${e.id}] ${label} — ${use} (조사 1회)`) as HTMLButtonElement
    b.disabled = ui.game.investigationsLeft <= 0 || ui.busy
    b.onclick = () => { play('paper'); act(() => lookupEvidence(ui.game, e.id)) }
    focusKey(b, `lookup:${e.id}`)
    into.appendChild(b)
  }

  // 잠긴 기록 — 자물쇠는 보여주고 열쇠의 주인만 감춘다 (ADR 010)
  const locked = lockedRecords(ui.game)
  if (locked.length) {
    col.appendChild(h('h2', undefined, `잠긴 기록 (${locked.length})`))
    for (const l of locked) {
      const row = h('div', 'hintline')
      row.appendChild(h('div', undefined,
        `🔒 ${labelOfKind(l.evidence.kind)} · ${SLOT_LABEL[l.evidence.slot]} ${PLACE_LABEL[l.evidence.place]}`))
      row.appendChild(h('div', undefined, `   조건 ${l.met}/${l.total} — 필요: ${l.missing.join(', ')}`))
      if (l.evidence.slot === CRIME_SLOT && l.evidence.place === CRIME_PLACE) {
        row.appendChild(h('div', undefined,
          '   이것이 결정적 증거(20점)이며, 카드의 발급 구분이 곧 범행 수단(20점)이다.'))
      }
      col.appendChild(row)
    }
  }

  // 발견한 모순은 **상황판(가운데 알리바이 대조표 아래)** 으로 옮겼다.
  // 격자와 모순은 같은 것의 두 표현이라 떨어뜨려 놓으면 눈이 왕복해야 했다.

  if (ui.game.ruledOut.length) {
    col.appendChild(h('h2', undefined, `소거된 조합 (${ui.game.ruledOut.length})`))
    for (const k of ui.game.ruledOut) {
      const [evId, sid] = k.split('|') as [string, SuspectId]
      const ev = CASE.evidence.find((e) => e.id === evId)
      const evName = ev ? `${labelOfKind(ev.kind)} · ${SLOT_LABEL[ev.slot]} ${PLACE_LABEL[ev.place]}` : evId!
      col.appendChild(h('div', 'hintline',
        `${CASE.suspects[sid].name}에게 ${evName} 기록을 들이밀었으나 반응 없음 — 이 조합은 아니다.`))
    }
  }

  // 진술 카드는 **격자가 담당한다.** 여기엔 기록만 남긴다 — 같은 것을 두 번 그리지 않는다.
  const recordCards = ui.game.cards.filter((id) => CASE.evidence.some((e) => e.id === id))
  col.appendChild(h('h2', undefined, `확보한 기록 (${recordCards.length})`))
  if (recordCards.length === 0) {
    col.appendChild(h('div', 'hintline', '아직 기록이 없다. 위에서 하나를 조회하면 여기에 쌓인다.'))
  }
  for (const id of recordCards) {
    const card = renderCard(CASE, id)
    if (ui.selected.includes(id)) card.classList.add('sel')
    if (ui.flash === id) card.classList.add('flash')
    card.setAttribute('role', 'button')
    card.tabIndex = 0
    card.setAttribute('aria-pressed', String(ui.selected.includes(id)))
    card.setAttribute('aria-label', `${cardSummary(CASE, id)} — 연결하려면 선택`)
    focusKey(card, `card:${id}`)
    card.onclick = () => pickCard(id)
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickCard(id) } }
    col.appendChild(card)
  }
  return col
}

function pickCard(id: string): void {
  if (ui.selected.includes(id)) {
    ui.selected = ui.selected.filter((x) => x !== id)
    return render()
  }
  ui.selected = [...ui.selected, id]
  if (ui.selected.length === 2) {
    const a = ui.selected[0]!
    const b = ui.selected[1]!
    const r = connect(ui.game, a, b)
    ui.game = r.state
    ui.flash = r.contradiction ? b : null
    play(r.contradiction ? 'stamp' : 'deny')
    ui.selected = []
    render()
    if (r.contradiction) setTimeout(() => { ui.flash = null; render() }, 600)
    return
  }
  render()
}

/* ─────────── 행동 ─────────── */
function act(fn: () => GameState): void {
  try {
    ui.game = fn()
    ui.selected = []
    render()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

async function doAsk(s: SuspectId, question: string): Promise<void> {
  const q = question.trim()
  if (!q || ui.busy || ui.game.investigationsLeft <= 0) return
  ui.busy = true
  render()

  const before = ui.game
  ui.game = interview(ui.game, s) // 예산은 낙관적으로 먼저 깎는다

  const r = await ask({
    seed: CASE.seed, suspectId: s, personaId: CASE.suspects[s].personaId,
    question: q, pressure: before.pressure[s],
    history: ui.chats[s]!.map((c) => ({ q: c.q, a: c.a })),
  })

  // 폴백이면 조사 횟수를 돌려준다 — AI 실패의 대가를 플레이어가 치르지 않는다
  if (r.fallback) ui.game = before

  ui.chats[s] = [...ui.chats[s]!, { q, a: r.reply.speech, fallback: r.fallback, tell: r.reply.tell, st: r.reply.statement }]
  ui.busy = false
  render()
  animateLast(r.reply.speech)
  // 3D 인물 옆에도 띄운다 — 심문 중 눈은 아래 로그가 아니라 얼굴에 가 있다
  say(r.reply.speech)
  voiceOut(r.reply, CASE.suspects[s].personaId)
}

async function doPresent(s: SuspectId, evId: string): Promise<void> {
  if (ui.busy) return
  const before = ui.game
  let advanced: GameState
  try {
    advanced = presentEvidence(ui.game, evId, s)
  } catch (e) {
    return alert(e instanceof Error ? e.message : String(e))
  }
  ui.busy = true
  ui.game = advanced
  render()

  const r = await ask({
    seed: CASE.seed, suspectId: s, personaId: CASE.suspects[s].personaId,
    question: '이 기록을 어떻게 설명하시겠습니까?',
    presentedEvidence: cardSummary(CASE, evId),
    pressure: before.pressure[s],
    history: ui.chats[s]!.map((c) => ({ q: c.q, a: c.a })),
  })
  if (r.fallback) ui.game = before

  // **판별은 엔진이 소유한다.** 폴백이면 해금 여부를 알려선 안 된다 —
  // 해금 쌍은 범인에게만 있어서 그 한 줄이 곧 정답이다 (`presentReveal` 주석).
  const reveal = presentReveal(before, advanced, r.fallback)
  play(reveal === 'opened' ? 'open' : 'deny')
  ui.chats[s] = [...ui.chats[s]!, {
    q: `[증거 제시] ${cardSummary(CASE, evId)}`,
    a: r.reply.speech + unlockNote(before, advanced, reveal),
    fallback: r.fallback, tell: r.reply.tell, st: r.reply.statement,
  }]
  ui.busy = false
  ui.selected = []
  render()
  animateLast(r.reply.speech)
  say(r.reply.speech)
  voiceOut(r.reply, CASE.suspects[s].personaId)
}

/**
 * 대사를 소리로 낸다. **몸동작·말풍선과 한 몸으로 움직인다** —
 * 말이 끝나는 시점을 소리가 알려주므로, 제스처도 거기에 맞춰 멎는다.
 * 음성을 못 쓰는 환경(윈도우 한국어 언어팩 없음 등)에서는 글자 길이로 어림한다.
 */
function voiceOut(reply: { speech: string; tell: string }, personaId: string): void {
  const h = ui.scene?.handle
  h?.setSpeaking(true)
  const fallbackMs = Math.min(9000, reply.speech.length * 140)
  if (canSpeak() && !isMuted()) {
    let ended = false
    const done = (): void => { if (!ended) { ended = true; h?.setSpeaking(false) } }
    speak(reply as never, personaId)
    // 큐가 비면 끝난 것으로 본다 — utterance 를 문장 단위로 쪼개 놔서 onend 가 여러 번 온다
    const poll = setInterval(() => {
      if (!speechSynthesis.speaking && !speechSynthesis.pending) {
        clearInterval(poll)
        done()
      }
    }, 220)
    setTimeout(() => { clearInterval(poll); done() }, 20000)
  } else {
    setTimeout(() => h?.setSpeaking(false), fallbackMs)
  }
}

/**
 * 제시 직후 **무슨 일이 일어났는지** 를 분류해 알려준다.
 *
 * 이전에는 "열렸다 / 아무것도 아니다" 두 줄뿐이라, 반응을 얻고도 다음에 뭘 할지
 * 모르고 무반응이 무엇을 배제했는지도 알 수 없었다 (자동 리뷰 minor 2건).
 * 정답은 여전히 감춘다 — 알려주는 건 **자물쇠의 진행도**뿐이다.
 */
function unlockNote(before: GameState, after: GameState, reveal: PresentReveal): string {
  if (reveal === 'void') {
    // 행동이 없던 일이 됐다. **무엇이 열렸는지 열리지 않았는지 말하지 않는다** — 그게 곧 정답이다.
    return '\n\n▸ 응답을 받지 못했다. 조사 횟수를 돌려주고, 이 제시는 없던 것으로 한다.'
  }
  if (reveal === 'nothing') {
    return '\n\n▸ 이 사람은 이 기록에 대해 열어줄 진술이 없다 — 이 조합은 해금 경로가 아니다.' +
      ' 다만 이것은 **자물쇠에 대한 소거일 뿐, 범인 후보를 지우지는 않는다.**' +
      ' 사람을 지우는 건 범행 시각의 기록뿐이다.'
  }
  const key = (g: GameState) => {
    const l = lockedRecords(g).find((x) => x.evidence.slot === CRIME_SLOT && x.evidence.place === CRIME_PLACE)
    return l ? `${l.met}/${l.total}` : null
  }
  const b = key(before), a = key(after)
  if (b && !a) return '\n\n▸ 새로운 진술이 열렸고, **잠겨 있던 현장 기록의 자물쇠가 풀렸다.** 기록 목록을 보라.'
  if (b && a && b !== a) return `\n\n▸ 새로운 진술이 열렸다 — 잠긴 현장 기록 조건이 ${b} → ${a} 로 진전됐다.`
  return '\n\n▸ 새로운 진술이 열렸다.'
}

function animateLast(text: string): void {
  const bubbles = document.querySelectorAll('.bubble.a')
  const node = bubbles[bubbles.length - 1]?.firstElementChild
  if (node instanceof HTMLElement) typeInto(node, text)
}

/* ─────────── 제출 · 결과 ─────────── */
function openSubmit(): void {
  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet casefile')
  sheet.appendChild(fileHeader('송치\n의견'))
  sheet.appendChild(h('h2', undefined, '범인 지목'))
  // 지금까지 손에 쥔 것을 한 줄로 상기시킨다 — 지목은 기억이 아니라 근거로 하는 것이다.
  const held = ui.game.cards.filter((id) => CASE.evidence.some((e) => e.id === id)).length
  sheet.appendChild(h('div', 'tally',
    `조사 ${INVESTIGATION_BUDGET - ui.game.investigationsLeft}회 소모 · ` +
    `확보한 기록 ${held}건 · 찾아낸 인장 ${ui.game.foundContradictions.length}건` +
    (ui.game.ruledOut.length ? ` · 소거한 조합 ${ui.game.ruledOut.length}건` : '')))
  sheet.appendChild(h('p', undefined, '범인만 맞혀도 부분 점수가 있습니다. 수단과 결정적 증거까지 맞히면 만점입니다.'))

  const opt = (v: string, t: string): HTMLOptionElement => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; return o
  }
  const who = h('select') as HTMLSelectElement
  for (const s of SUSPECTS) who.appendChild(opt(s, `${CASE.suspects[s].name} (${CASE.suspects[s].job})`))

  const method = h('select') as HTMLSelectElement
  for (const m of METHODS) method.appendChild(opt(m, m))

  const dec = h('select') as HTMLSelectElement
  // 시각 순으로만 정렬한다. **범행 현장 기록에 ★ 를 달았더니 추리를 건너뛰게 됐다**
  // (자동 리뷰 major 지적: 무반응 제시로 실패한 플레이어가 ★ 만 보고 정답을 골랐다).
  // 카드에 시각·장소가 이미 적혀 있으므로, 판별은 플레이어의 몫으로 남긴다 (ADR 010).
  const owned = ui.game.cards
    .filter((x) => CASE.evidence.some((e) => e.id === x))
    .sort((a, b) => {
      const at = (id: string) => CASE.evidence.find((x) => x.id === id)!.slot
      return at(a) - at(b)
    })
  if (owned.length === 0) dec.appendChild(opt('', '(확보한 물증이 없다)'))
  // 조건("범행 시각")은 이미 화면에 적혀 있고 카드 앞면에 시각이 있다.
  // 그 조건을 목록에도 반영한다 — 정답 유출이 아니라 **사무 실수 제거**다.
  // 범행 시각 기록은 여러 건이므로 "어느 장소가 현장인가" 라는 진짜 판단은 남는다
  // (자동 리뷰 minor/clarity: 22:10 기록을 결정적 증거로 골라 오답이 났다).
  for (const id of owned) {
    const e = CASE.evidence.find((x) => x.id === id)!
    const ok = e.slot === CRIME_SLOT
    // 범행 시각이 아닌 기록은 아예 못 고른다. 범행 시각이지만 카드키가 아닌 기록은
    // **고를 수는 있되 사실을 알려준다** — 선택권을 뺏지 않고 혼동만 없앤다
    // (자동 리뷰 minor/clarity: 22:20 CCTV 를 결정적 증거로 골라 오답이 났다).
    const note = !ok ? `  — ${SLOT_LABEL[CRIME_SLOT]} 기록이 아니다`
      : e.kind !== 'keycard' ? '  — 현장 확인용 기록이다. 카드키 출입 기록이 아니다'
      : ''
    dec.appendChild(opt(id, cardSummary(CASE, id) + note))
    if (!ok) (dec.lastElementChild as HTMLOptionElement).disabled = true
  }

  sheet.appendChild(h('label', undefined, '범인')); sheet.appendChild(who)
  sheet.appendChild(h('label', undefined, '범행 수단'))
  sheet.appendChild(h('div', 'hintline',
    '결정적 증거(범행 시각 현장의 카드키 기록) 카드의 "발급 구분" 칸에 어떤 카드로 열었는지가 찍혀 있다. ' +
    '그 카드를 확보하지 못했다면 수단은 추측이고, **찍어서 맞혀도 점수는 없다.** — 배점 20점.'))
  sheet.appendChild(method)
  sheet.appendChild(h('label', undefined, '결정적 증거'))
  sheet.appendChild(h('div', 'hintline',
    '범행 시각 현장의 **카드키 출입 기록** 이어야 한다. 진술이나 알리바이 기록은 해당하지 않는다. — 배점 20점, 못 맞혀도 범인만 맞히면 해결이다.'))
  sheet.appendChild(dec)

  const go = h('button', undefined, '제출') as HTMLButtonElement
  go.style.marginTop = '16px'
  go.onclick = () => { ov.remove(); showResult(who.value as SuspectId, method.value, dec.value) }
  const cancel = h('button', undefined, '더 조사하기') as HTMLButtonElement
  cancel.style.cssText = 'margin:16px 0 0 8px'
  cancel.onclick = () => ov.remove()
  sheet.appendChild(go); sheet.appendChild(cancel)

  ov.appendChild(sheet)
  document.body.appendChild(ov)
}

function showResult(culprit: SuspectId, method: string, decisiveEvidenceId: string): void {
  const r = submit(ui.game, { culprit, method, decisiveEvidenceId })
  ui.game = r.state

  /**
   * **판정문보다 장면이 먼저다.**
   * 점수표를 바로 들이밀면 "정답 확인" 으로 끝난다. 검거 장면을 먼저 보여주고
   * 그다음에 서류를 펼쳐야 한 편의 사건으로 닫힌다 — 인트로와 같은 문법이다.
   * 3D 는 정리하고 간다 (심문은 끝났고, 뒤에 남아 돌 이유가 없다).
   */
  stopVoice()
  ui.scene?.handle?.dispose()
  ui.scene = null
  roomEl.remove()
  void playOutro(CASE, culprit, r.correct.culprit).then(() => renderResultSheet(r, culprit))
}

/**
 * 오답 진단 — **범인·정답 증거·수단은 절대 말하지 않는다.**
 * 대신 "어느 시간대가 비었는가 · 누가 말을 바꿨는가 · 무엇을 확인 안 했는가" 를 준다.
 * 다음 수사의 방향은 주되 답은 주지 않는다 (QA 5.7).
 */
function diagnosis(): HTMLElement {
  const box = h('div', 'diag')
  box.appendChild(h('h3', undefined, '수사 진단'))
  const held = new Set(ui.game.cards)
  const lines: string[] = []

  // ① 범행 시각 기록을 얼마나 열었나 — 사람을 지우는 유일한 수단이다
  const crimeRecs = CASE.evidence.filter((e) => e.slot === CRIME_SLOT)
  const openedCrime = crimeRecs.filter((e) => held.has(e.id)).length
  if (openedCrime < crimeRecs.length) {
    lines.push(`${SLOT_LABEL[CRIME_SLOT]} 기록 ${crimeRecs.length}건 중 ${openedCrime}건만 확인했습니다. ` +
      '사람을 지우는 건 이 시간대의 기록뿐입니다.')
  }

  // ② 아무 질문도 안 한 사람이 있나
  const untouched = SUSPECTS.filter((x) => (ui.chats[x]?.length ?? 0) === 0)
  if (untouched.length) {
    lines.push(`${untouched.length}명에게는 한 번도 묻지 않았습니다 — ` +
      untouched.map((x) => CASE.suspects[x].job).join(' · ') + '.')
  }

  // ③ 말을 바꾼 사람이 있었나 (이름은 밝히지 않는다)
  let changed = 0
  for (const x of SUSPECTS) {
    const places = new Set((ui.chats[x] ?? []).map((c) => c.st?.place).filter(Boolean))
    if (places.size > 1) changed += 1
  }
  if (changed) {
    lines.push(`진술 중 장소가 바뀐 사람이 ${changed}명 있었습니다. 조서를 다시 훑어보십시오.`)
  }

  // ④ 인장(모순)을 하나도 못 찾았나
  if (ui.game.foundContradictions.length === 0) {
    lines.push('찾아낸 모순이 없습니다 — 기록을 손에 쥔 채 같은 시각을 다시 물으면 인장이 찍힙니다.')
  }

  if (!lines.length) {
    lines.push('놓친 절차는 없습니다. 근거는 모였지만 해석이 갈린 판입니다 — 같은 기록을 다른 순서로 읽어 보십시오.')
  }
  for (const t of lines) box.appendChild(h('div', 'hintline', t))
  box.appendChild(h('div', 'diag-note', '진범은 밝히지 않습니다. 같은 사건번호로 다시 수사할 수 있습니다.'))
  return box
}

/**
 * 정답 결말 — **사실 요약이 아니라 이야기**로 닫는다 (QA 5.8).
 * "범인은 돈 때문에 도구로 죽였다" 는 범죄 사실이지 사건이 아니다.
 * 발단·전개·절정·결말을 페르소나에 맞춘 문장으로 잇는다.
 */
function storyBlock(): HTMLElement {
  const c = CASE.suspects[CASE.culprit]
  const persona = personaById(c.personaId)
  const d = CASE.evidence.find((e) => e.decisive)!
  const box = h('div', 'story')
  box.appendChild(h('h3', undefined, '사건의 전말'))

  const beats: [string, string][] = [
    // 조사는 josa() 로 붙인다 — 이름이 매 판 바뀌므로 '와(과)' 같은 회피 표기는 쓰지 않는다
    ['발단', `${josa(c.name, '은/는')} ${josa(CASE.victim.name, '과/와')} ${c.relation}. ` +
             `${josa(CASE.motive, '이/가')} 둘 사이에 남아 있었다.`],
    ['전개', `${SLOT_LABEL[CRIME_SLOT]}, ${CASE.venue.room}. 그 시각 그 층에 있었던 사람은 하나뿐이었다.`],
    // 수단은 사건마다 '준비된 것' 일 수도 있어 단정하지 않는다 — 도구 이름만 놓는다
    ['절정', `그리고 ${josa(CASE.method, '이/가')} 쓰였다.`],
    ['결말', `${josa(d.keyLabel ?? '그 기록', '이/가')} 남았다. ${persona.confession}`],
  ]
  for (const [k, t] of beats) {
    const row = h('div', 'beat')
    row.appendChild(h('span', 'beat-k', k))
    row.appendChild(h('span', 'beat-t', t))
    box.appendChild(row)
  }
  return box
}

function renderResultSheet(r: ReturnType<typeof submit>, culprit: SuspectId): void {
  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet casefile')
  // 붉은 인장은 '확정' 의 색이다. 못 맞혔으면 색을 빼야 한다 — 색이 곧 판정이다.
  play(r.correct.culprit ? 'solved' : 'filed')
  sheet.appendChild(fileHeader(r.correct.culprit ? '사건\n해결' : '미제\n편철', !r.correct.culprit))
  /**
   * **판정을 네 등급으로 나눠 이름을 준다** (QA 5.6).
   * "범인을 맞혔습니다 / 아닙니다" 두 칸뿐이면, 범인을 찾고도 입증에 실패한 판과
   * 아무것도 못 한 판이 같은 문장으로 끝난다. 핵심 추리와 입증을 갈라서 부른다.
   */
  const proved = r.correct.decisive && !r.methodGuessed
  const grade = r.correct.culprit
    ? (proved ? { t: '사건 완전 해결', k: 'ok' } : { t: '범인은 찾았으나 입증이 부족합니다', k: 'ok half' })
    : (r.correct.decisive || r.correct.method
        ? { t: '방향은 옳았으나 대상이 틀렸습니다', k: 'no half' }
        : { t: '수사 실패', k: 'no' })
  sheet.appendChild(h('div', `verdict ${grade.k}`, grade.t))

  /**
   * **맞힌 것과 좁힌 것은 다르다.**
   * 후보가 넷 남은 채 찍어 맞힌 판과 기록으로 한 사람까지 몬 판이
   * 같은 문장으로 끝나고 있었다 (자동 리뷰 major/feedback).
   * 점수는 건드리지 않는다 — 승리 조건을 바꾸면 밸런스를 다시 재야 한다.
   * 대신 무엇을 한 것인지 정확히 적는다.
   */
  const endCands = candidatesFrom(CASE, new Set(ui.game.cards))
  if (r.correct.culprit) {
    sheet.appendChild(h('div', endCands.length === 1 ? 'contradiction' : 'hintline',
      endCands.length === 1
        ? '기록만으로 한 사람까지 좁힌 뒤 지목했습니다 — 추리가 완성된 판입니다.'
        : `다만 기록으로는 아직 ${endCands.length}명이 남아 있었습니다 — 좁혀서 맞힌 것이 아니라 ` +
          `남은 후보 중에서 고른 것이라 범인 점수는 ${r.breakdown.culprit}점입니다` +
          `(1명까지 좁히면 60 · 2~3명 50 · 4명 이상 40). ` +
          `${SLOT_LABEL[CRIME_SLOT]} 기록을 더 열었다면 지목이 필연이 됐을 것입니다.`))
  } else if (endCands.length > 1) {
    sheet.appendChild(h('div', 'hintline',
      `제출 시점에 기록으로 좁혀진 후보는 ${endCands.length}명이었습니다. ` +
      `사람을 지우는 건 ${SLOT_LABEL[CRIME_SLOT]} 기록뿐입니다 — 진술과 인장은 의심의 근거이지 소거가 아닙니다.`))
  }
  /**
   * ## 오답이면 **진범을 밝히지 않는다** (QA 5.7)
   *
   * "오답은 정답 공개 화면이 아니라 재수사를 위한 진단 화면이어야 한다."
   * 즉시 범인을 공개하면 같은 사건에 다시 도전할 이유가 사라진다.
   * 대신 **무엇을 놓쳤는지**를 정답을 노출하지 않고 짚어 준다.
   */
  if (r.correct.culprit) {
    sheet.appendChild(storyBlock())
  } else {
    sheet.appendChild(diagnosis())
  }

  /**
   * 수단·결정적 증거 해설은 **범인을 맞혔을 때만** 편다 (QA 5.7).
   * 이 문장들은 결정적 증거의 이름·시각·장소를 그대로 알려준다 —
   * 오답에 띄우면 진단 화면을 조심스럽게 써 놓고 옆문으로 정답을 흘리는 셈이다.
   */
  if (r.correct.culprit) {
    if (r.methodGuessed) {
      const d = CASE.evidence.find((e) => e.decisive)!
      sheet.appendChild(h('div', 'hintline',
        `수단은 맞았지만 점수는 없다 — 근거가 되는 카드(${d.keyLabel})를 확보하지 못한 채 찍은 것이기 때문이다.`))
    } else if (!r.correct.method) {
      const d = CASE.evidence.find((e) => e.decisive)!
      sheet.appendChild(h('div', 'hintline',
        ui.game.cards.includes(d.id)
          ? `수단은 확보한 결정적 증거 카드의 "발급 구분" 칸에 적혀 있었다 — ${d.keyLabel}.`
          : `수단은 결정적 증거 카드의 "발급 구분" 칸(${d.keyLabel})에서 읽어낼 수 있었다. 그 카드를 끝내 확보하지 못했다.`))
    }

    if (!r.correct.decisive) {
      const d = CASE.evidence.find((e) => e.decisive)!
      const had = ui.game.cards.includes(d.id)
      sheet.appendChild(h('div', 'hintline',
        had
          ? `결정적 증거는 ${d.id}(${SLOT_LABEL[d.slot]} ${PLACE_LABEL[d.place]})였다. 손에 쥐고도 고르지 못했다.`
          : `결정적 증거(${SLOT_LABEL[d.slot]} ${PLACE_LABEL[d.place]} 기록)를 끝내 확보하지 못했다. ` +
            `그것은 범인의 자백과 무고한 목격자의 증언이 모두 모여야 열린다.`))
    }
  }

  /**
   * 사건 재구성 — **정답을 맞혔을 때만 보여준다** (QA 5.7).
   * 이 표는 진범의 이름과 다섯 시간대 동선을 통째로 드러낸다.
   * 오답에 이걸 띄우면 진단 화면을 아무리 조심스럽게 써도 소용이 없다 —
   * 같은 사건번호로 다시 도전할 이유가 사라진다.
   */
  if (r.correct.culprit) {
    sheet.appendChild(h('h2', undefined, '사건 재구성'))
    const tl = h('ul', 'timeline')
    const k = CASE.suspects[CASE.culprit]
    k.truth.forEach((place, i) => {
      const li = h('li', i === CRIME_SLOT ? 'crime' : undefined,
        `${SLOT_LABEL[i as Slot]}  ${k.name} — ${PLACE_LABEL[place]}${i === CRIME_SLOT ? '   ← 범행' : ''}`)
      li.style.animationDelay = `${i * 260}ms`
      tl.appendChild(li)
    })
    sheet.appendChild(tl)
  }

  const sc = h('div', 'score')
  const line = (label: string, v: number, cls?: string): void => {
    sc.appendChild(h('div', cls, label)); sc.appendChild(h('div', cls, String(v)))
  }
  line(r.correct.culprit && r.candidatesLeft > 1 ? `범인 (후보 ${r.candidatesLeft}명 중 지목)` : '범인',
    r.breakdown.culprit)
  line('범행 수단', r.breakdown.method)
  line('결정적 증거', r.breakdown.decisive)
  line(`남은 조사 ${ui.game.investigationsLeft}회`, r.breakdown.efficiency)
  line(`발견한 모순 ${ui.game.foundContradictions.length}건`, r.breakdown.insight)
  line('합계', r.total, 'tot')
  sheet.appendChild(sc)
  sheet.appendChild(h('p', undefined, `최소 ${generated.validation.solve.minActions}회면 풀 수 있었습니다.`))

  // 판 기록 — 다음 판이 이전 판에 대한 응답이 되게 한다
  const st = record(CASE.seed, r.total, r.correct.culprit)
  const isNewBest = r.total >= st.best && st.bestSeed === CASE.seed
  sheet.appendChild(h('div', isNewBest ? 'candline' : 'tally',
    isNewBest
      ? `최고 기록입니다 — ${st.best}점. 통산 ${st.plays}판 중 ${st.solved}건 해결.`
      : `통산 ${st.plays}판 중 ${st.solved}건 해결 · 최고 ${st.best}점` +
        (st.bestSeed !== null ? ` (사건번호 ${String(st.bestSeed).padStart(5, '0')})` : '')))

  const again = h('button', undefined, '다른 사건으로') as HTMLButtonElement
  // 시드 '선택' 은 시뮬레이션 밖이지만, 가드에 예외를 두면 그 예외가 언젠가 시뮬레이션으로 샌다.
  // crypto 를 쓰면 규칙을 안 깨고도 더 나은 난수를 얻는다.
  again.onclick = () => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    location.search = `?seed=${buf[0]! % 100000}`
  }
  sheet.appendChild(again)

  ov.appendChild(sheet)
  document.body.appendChild(ov)
}

/**
 * 사건 파일 서식 머리 — 브리핑·제출·결과가 **같은 서류철**로 읽히게 한다.
 * 사건번호는 시드다. 재현 가능한 게임이라는 사실이 세계관 안에서도 말이 된다.
 */
function fileHeader(stamp: string, cold = false): HTMLElement {
  const hd = h('div', 'filehd')
  hd.appendChild(h('div', 'kicker', `사건번호 ${String(CASE.seed).padStart(5, '0')} · 강력 3팀`))
  hd.appendChild(h('div', `stamp${cold ? ' cold' : ''}`, stamp))
  return hd
}

/* ─────────── 오프닝 브리핑 (기획서 §5.1) ─────────── */
/**
 * 플레이 테스트 지적: "어디부터 해야 되는지, 뭘 조사해야 되는지 모르겠다."
 * 규칙을 툴팁으로 흩뿌리는 대신 **시작 전에 한 번** 사건과 목표를 세워준다.
 */
function openBriefing(): void {
  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet casefile')

  sheet.appendChild(fileHeader('수사\n개시'))
  sheet.appendChild(h('h2', undefined, CASE.title))
  sheet.appendChild(h('p', undefined,
    `어젯밤 ${SLOT_LABEL[CRIME_SLOT]}, ${CASE.venue.name} ${CASE.venue.room}에서 ` +
    `${CASE.victim.title} ${josa(CASE.victim.name, '이/가')} 숨진 채 발견됐다. ` +
    `호텔에는 다섯 사람이 남아 있었고, 그중 한 명이 범인이다.`))
  sheet.appendChild(h('p', undefined,
    '다섯 명 모두 "그 시간엔 다른 곳에 있었다"고 말한다. ' +
    '그러나 거짓말하는 사람이 곧 범인은 아니다 — 저마다 숨기고 싶은 사정이 따로 있다.'))

  sheet.appendChild(h('h2', undefined, '당신이 할 일'))
  const ol = h('ol', 'steps')
  for (const [t, d] of [
    ['대조표를 읽는다',
      `가운데 표가 수사의 전부다. 가로가 시각, 세로가 사람이고, ${SLOT_LABEL[CRIME_SLOT]} 열이 범행 시각이다. 읽는 건 무료다.`],
    ['심문하거나 기록을 조회한다',
      `조사는 총 ${INVESTIGATION_BUDGET}회뿐 — 이 게임의 유일한 자원이다. 심문하면 그 사람의 나머지 시각이 표에 채워진다.`],
    ['기록으로 후보를 지운다 — 이게 승리 경로다',
      `${SLOT_LABEL[CRIME_SLOT]} 기록에 현장이 아닌 곳으로 찍힌 사람은 소거된다. ` +
      '표 위의 "남은 후보" 가 줄어드는 걸로 확인하라. 진술은 거짓일 수 있어 사람을 지우지 못한다.'],
    ['기록과 진술을 맞춰 붉은 인장을 찍는다',
      '기록 한 장과 표의 칸 하나를 누르면 대조된다. 어긋나면 인장이 찍힌다. 대조는 무료이고, ' +
      '인장은 누구를 의심할지 정하는 근거다.'],
    ['(선택) 증거를 들이밀어 잠긴 기록을 연다',
      '흔들리면 자물쇠가 풀린다. 다만 조사 1회를 거는 도박이고, 헛짚으면 아무것도 안 열린다. ' +
      '이건 완주 보상(결정적 증거·수단, 40점)을 위한 것이지 범인을 맞히는 데 필요하지는 않다. ' +
      '잠긴 것은 범행 시각 현장의 카드키 출입 기록이고, 그 카드의 발급 구분이 곧 범행 수단이다.'],
    ['범인·수단·결정적 증거를 지목한다',
      '범인만 맞히면 해결이다(60점). 남은 조사와 찾아낸 인장도 점수가 된다.'],
  ] as [string, string][]) {
    const li = h('li')
    li.appendChild(h('b', undefined, t))
    li.appendChild(h('span', undefined, d))
    ol.appendChild(li)
  }
  sheet.appendChild(ol)

  const st = stats()
  if (st.plays > 0) {
    sheet.appendChild(h('div', 'tally',
      `통산 ${st.plays}판 중 ${st.solved}건 해결 · 최고 ${st.best}점. 이번 판은 사건번호 ${String(CASE.seed).padStart(5, '0')} 입니다.`))
  }

  const go = h('button', undefined, '수사를 시작한다') as HTMLButtonElement
  go.style.marginTop = '10px'
  go.onclick = () => {
    wake()
    // 음성 엔진 예열 — 여기서 안 깨우면 첫 심문에서만 소리가 ~800ms 늦는다
    void initVoice()
    ov.remove()
    render()
  }
  sheet.appendChild(go)

  ov.appendChild(sheet)
  document.body.appendChild(ov)
  queueMicrotask(() => go.focus())
}

/* ─────────── 다음 할 일 코치 ─────────── */
/** 상태를 보고 "지금 뭘 하면 되는지" 한 줄로 알려준다. 규칙 설명이 아니라 **다음 행동** 이다. */
function coachLine(): string {
  const g = ui.game
  const hasEvidence = g.cards.some((id) => CASE.evidence.some((e) => e.id === id))
  const interviewed = SUSPECTS.some((s) => (ui.chats[s]?.length ?? 0) > 0)

  if (g.investigationsLeft === 0) return '조사가 끝났다. 상단 [범인 지목]으로 결론을 내리십시오.'
  if (!interviewed && !hasEvidence) return '① 다섯 진술을 훑고, 가장 걸리는 사람을 눌러 심문하십시오.'
  if (!hasEvidence) return '② 오른쪽에서 기록을 조회해 진술과 맞춰 보십시오.'
  if (g.foundContradictions.length === 0) return '③ 기록 카드와 진술 카드를 하나씩 눌러 연결하십시오. 무료입니다.'
  // **후반에만 경고하면 늦다.** 9회 중 8회를 후보 소거와 무관한 곳에 쓰고
  // 마지막에야 범행 시각 기록을 연 판이 있었다 (자동 리뷰 minor/pacing).
  const spent = INVESTIGATION_BUDGET - g.investigationsLeft
  const hasCrimeRecord = CASE.evidence.some((e) => g.cards.includes(e.id) && e.slot === CRIME_SLOT)
  if (spent >= 3 && !hasCrimeRecord && availableEvidence(g).some((e) => e.slot === CRIME_SLOT)) {
    return `④ 조사 ${spent}회를 썼지만 ${SLOT_LABEL[CRIME_SLOT]} 기록을 아직 하나도 열지 않았습니다 — ` +
      `사람을 지우는 건 그 기록뿐입니다. 승패는 범인 적중입니다.`
  }
  if (g.investigationsLeft <= 2) {
    // 자원이 바닥날 때 **무엇을 포기하는 중인지** 알려준다. 화면에 이미 있는 정보를
    // 합쳐 말할 뿐이지만, 그 합산을 플레이어가 마지막 2회 안에 스스로 하기는 어렵다
    // (자동 리뷰: 유망한 실마리를 쥔 채 예산이 끝났다).
    const sceneLocked = lockedRecords(g).some(
      (l) => l.evidence.slot === CRIME_SLOT && l.evidence.place === CRIME_PLACE)
    const left = candidatesFrom(CASE, new Set(g.cards)).length
    const openCrimeRecords = availableEvidence(g).filter((e) => e.slot === CRIME_SLOT).length
    // **승패는 범인 적중이다.** 후보가 여럿이면 자물쇠보다 후보 소거가 먼저다.
    if (left > 1 && openCrimeRecords > 0) {
      return `④ 남은 조사 ${g.investigationsLeft}회 · 후보 ${left}명. 승패는 범인 적중입니다 — ` +
        `먼저 ${SLOT_LABEL[CRIME_SLOT]} 기록 ${openCrimeRecords}건 중 하나를 열어 후보를 줄이십시오. 제시는 완주 보상 경로입니다.`
    }
    return sceneLocked
      ? `④ 남은 조사 ${g.investigationsLeft}회 · 후보 ${left}명. 현장 기록은 아직 잠겨 있습니다 — 지금 결론을 내면 결정적 증거(20점)는 포기하는 것입니다.`
      : `④ 남은 조사 ${g.investigationsLeft}회 · 후보 ${left}명. 슬슬 결론을 낼 때입니다.`
  }
  return '④ 모순이 나온 인물에게 그 증거를 제시하면 새 진술이 열립니다.'
}

/* ─────────── 렌더 ─────────── */
/**
 * 재렌더는 DOM 을 통째로 갈아치운다. 그러면 **키보드 포커스가 사라진다** —
 * `role="button"` 과 `tabIndex` 를 붙여 키보드만으로 플레이할 수 있게 해 놓고,
 * 정작 첫 행동 뒤에는 Tab 을 처음부터 다시 눌러야 했다. 약속을 지킨다.
 *
 * 모든 포커스 대상에 안정된 키(`data-fk`)를 달아 두고, 재렌더 뒤 같은 키를 다시 잡는다.
 */
function focusKey(el: HTMLElement, key: string): HTMLElement {
  el.dataset.fk = key
  return el
}

/**
 * 재렌더 뒤 포커스를 되돌린다. 같은 요소가 살아 있으면 그리로,
 * 사라졌으면(방금 조회한 기록처럼) **같은 종류의 다음 것**으로 넘긴다.
 * 아무것도 없으면 상단바로 — 키보드 사용자를 화면 맨 위에 버려두지 않는다.
 */
function restoreFocus(key: string): void {
  const exact = app.querySelector<HTMLElement>(`[data-fk="${CSS.escape(key)}"]`)
  if (exact) return exact.focus()

  const kind = key.split(':')[0]!
  const sibling = app.querySelector<HTMLElement>(`[data-fk^="${CSS.escape(kind)}:"]`)
  if (sibling) return sibling.focus()

  app.querySelector<HTMLElement>('[data-fk="submit"]')?.focus()
}

function render(): void {
  const keep = (document.activeElement as HTMLElement | null)?.dataset?.fk ?? null
  // 전체 재렌더의 대가 — 스크롤 위치. 측정상 렌더 자체는 0.8ms 라 비용이 아니지만,
  // 오른쪽 기록 더미를 내려보다 행동하면 맨 위로 튀는 건 실제 불편이다.
  const scrolls = Array.from(app.querySelectorAll('.col')).map((c) => c.scrollTop)
  app.replaceChildren()
  app.appendChild(topbar())
  app.appendChild(h('div', 'coach', coachLine()))
  const cols = h('div', 'cols')
  cols.appendChild(suspectColumn())
  cols.appendChild(stage())
  cols.appendChild(board())
  app.appendChild(cols)

  const cols2 = app.querySelectorAll('.col')
  scrolls.forEach((top, i) => { if (top) cols2[i]?.scrollTo({ top }) })

  if (keep) restoreFocus(keep)
}

render()
void playIntro(CASE).then(openBriefing)
