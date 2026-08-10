/**
 * 오케스트레이터 — 씬 전환과 배선만 한다.
 *
 * 규칙(소개팅 MVP 에서 계승): **이 파일은 게임 규칙을 계산하지 않는다.**
 * 자원·판정·점수는 전부 `engine/` 이 소유하고, 여기서는 상태를 읽어 그리기만 한다.
 * 이 경계가 무너지면 headless 테스트가 게임을 증명하지 못하게 된다.
 */

import './style.css'
import { generateValidCase, validateCase } from './engine/validate'
import { gc001Case, GC001_CASE_NO } from './data/gc001'
import { applyWorld, WORLD_PACKS, WORLD_ROTATION } from './data/worlds'
import {
  availableEvidence, claimCardId, connect, createGame, fieldDone, interview, lockedRecords,
  lookupEvidence, presentEvidence, presentReveal, submit, talksLeft,
  type GameState, type PresentReveal,
} from './engine/game'
import { makeRng, shuffle } from './engine/rng'
import { cardSummary, renderCard } from './ui/cards'
import { josa } from './josa'
import { isMuted, play, setMuted, wake } from './ui/sound'
import { canSpeak, initVoice, speak, stop as stopVoice } from './ui/voice'
import { probeKey } from './ui/tts/supertone'
import { FALLBACK_LABEL, onStage, setStage, stage as pipeStage, STAGE_LABEL } from './ui/pipeline'
import { dashboard, probeProviders } from './ui/dashboard'
import { playIntro } from './ui/intro'
import { showJournal } from './ui/journal3d'
import { playOutro } from './ui/outro'
import { hasReenactment, playReenactment } from './ui/reenact'
import type { Statement } from './engine/prompt'
import { record, stats } from './ui/records'
import { portraitFor } from './ui/portraits'
import { hasModel, mount, type Stage3D } from './ui/stage3d'
import { hasStation, hasWalkModel, mountExplore, type Explore3D, type Marker, type Seat } from './ui/explore3d'
import { SLUG_BY_JOB } from './ui/roleSlug'
import { personaById } from './data/personas'
import { confessionFor } from './data/confessions'
import { pickPoolSeed } from './data/pool'
import { candidatesFrom } from './engine/solver'
import { newTrace, profile, record as trace, type TraceEvent, type TraceInput } from './engine/journey'
import { journalLines } from './ui/journal'
import { saveTrace } from './ui/journeyStore'
import { pendingPairs, placeMatrix } from './engine/crossref'
import { ask } from './api'
import {
  CRIME_PLACE, CRIME_SLOT, kindLabel, PLACES, placeLabel, SLOTS, slotLabel, SUSPECTS,
  type CaseFile, type Evidence, type PlaceId, type Slot, type SuspectId,
} from './types'
import { FIELD_BUDGET, TALK_CAP, WEAPONS, WEAPON_TRACE } from './data/config'

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
  /**
   * 심문 챕터가 열렸는가 — **걸쇠(latch)다.** `fieldDone()` 은 심문 중 잠긴 기록이
   * 해금되면 false 로 되돌아갈 수 있으므로(game.ts 주석), 첫 true 를 여기 잡아 둔다.
   * 게이트가 도로 잠기면 플레이어는 이유를 알 길이 없다.
   */
  chapter2: boolean
  /** 챕터 게이트에 막혔을 때 띄우는 한 줄 — 잠시 떠 있다 사라진다 */
  gateMsg: string | null
  /** 방금 맞대본 결과 한 줄 — 일치했을 때도 알려줘야 "아무 일도 안 일어났다" 로 안 읽힌다 */
  note: string | null
  /** 이미 화면에 찍힌 인장 — 재렌더 때 전부 다시 찍히는 걸 막는다 */
  stamped: Set<string>
  /** 심문석 3D. 없거나 실패하면 null 이고 사진으로 폴백한다. */
  /** AI 파이프라인 판을 펼쳤는가 */
  dash: boolean
  /** 수첩이 펼쳐지는 연출 중인가 — 첫 진입에 한 번만 */
  opening: boolean
  /** 마지막으로 그린 일지 줄 수 — 새 줄만 써지는 연출을 주기 위해 */
  journalSeen: number
  /** 탐색 모드 — 방을 걸어 다니며 기록을 줍는다 */
  /**
   * `mounting` 이 따로 있는 이유: 씬을 만드는 데 수 초가 걸리는데 그 사이 `handle` 은
   * 아직 null 이다. `!handle` 만 보고 막으면 로딩 중 재렌더 한 번에 **씬이 둘이 되고**,
   * 먼저 뜬 쪽은 dispose 대상에서 빠져 window 키 리스너와 rAF 루프가 영구히 남는다.
   */
  explore: {
    handle: Explore3D | null
    mounting: boolean
    near: string | null
    nearSeat: string | null
  } | null
  /** 플레이 여정 — 개인화의 재료. 규칙에는 영향을 주지 않는다 */
  journey: ReturnType<typeof newTrace>
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
/**
 * 고정 사건 진입 (GC001 계약 §3) — `?case=gc001` 은 생성기를 우회한다.
 * 수제 사건도 검증기는 그대로 지난다: 통과 못 하면 시작조차 못 하는 것이 맞다 —
 * 조용히 잘못된 사건을 내보내는 것보다 낫다 (generateValidCase 와 같은 철학).
 */
const IS_GC001 = new URLSearchParams(location.search).get('case') === 'gc001'

/**
 * 월드 팩 선택 (P1) — `?world=auction|studio|theater`. 없으면 호텔.
 * 모르는 값은 applyWorld 가 원본을 돌려주므로 오타가 빈 화면이 되지 않는다.
 * gc001 은 자기 월드를 갖고 있어 이 축과 겹치지 않는다.
 */
const WORLD_ID = IS_GC001 ? null : new URLSearchParams(location.search).get('world')

const seed = IS_GC001 ? 1 : Number(new URLSearchParams(location.search).get('seed')) || (() => {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return pickPoolSeed(buf[0]! / 2 ** 32)
})()

const generated = IS_GC001
  ? (() => {
      const c = gc001Case()
      const validation = validateCase(c)
      if (!validation.ok) {
        throw new Error(`GC-001 검증 실패: ${validation.violations.map((v) => v.code).join(', ')}`)
      }
      return { case: c, validation, attempts: 1 }
    })()
  : generateValidCase(seed)
// 스킨은 검증 **뒤에** 입는다 — 라벨은 유일해에 관여하지 않고, 관여하게 두면 안 된다
const CASE: CaseFile = IS_GC001 ? generated.case : applyWorld(generated.case, WORLD_ID)

/** 서류·시작 페이지에 찍히는 사건번호 — 고정 사건은 시드가 아니라 케이스 번호를 쓴다 */
const CASE_NO = IS_GC001 ? GC001_CASE_NO : String(CASE.seed).padStart(5, '0')

/**
 * 월드 라벨 축약 (GC001 계약 §1) — 이 파일의 라벨 소비는 전부 이 둘을 지난다.
 * CASE 가 모듈 전역이라 인자를 반복해 넘기지 않는 축약을 둔다. world 가 없으면
 * 기존 호텔 상수 그대로다.
 */
const SLOT_L = (t: Slot): string => slotLabel(CASE, t)
const PLACE_L = (p: PlaceId): string => placeLabel(CASE, p)

const ui: UI = {
  game: createGame(CASE),
  active: null,
  view: 'time',
  chats: Object.fromEntries(SUSPECTS.map((s) => [s, [] as Chat[]])),
  selected: [],
  busy: false,
  flash: null,
  chapter2: false,
  gateMsg: null,
  note: null,
  stamped: new Set(),
  dash: false,
  opening: false,
  journalSeen: 0,
  explore: null,
  journey: newTrace(seed, Date.now()),
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
 * 탐색 씬 호스트 — `roomEl` 과 **같은 이유로** 모듈 스코프에 둔다.
 * `render()` 가 트리를 통째로 갈아치우므로 여기서 만들면 재렌더마다
 * WebGL 컨텍스트가 생겼다 사라지고 루프가 취소된 채 캔버스만 남는다.
 * 그 실수는 이미 한 번 정지 화면을 만들었다.
 */
const exploreEl = document.createElement('div')
exploreEl.className = 'exhost'

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

/**
 * 오버레이를 부드럽게 걷는다 (P2-2) — 즉발 제거는 전환이 아니라 스위치다.
 * 모션 축소 설정이면 CSS 전환이 0 이 되므로 타이머만 짧게 남는다.
 */
function fadeOut(ov: HTMLElement): void {
  ov.classList.add('fadeout')
  setTimeout(() => ov.remove(), 400)
}

/* ─────────── 상단 바 ─────────── */
function topbar(): HTMLElement {
  const bar = h('div', 'topbar')
  bar.appendChild(h('h1', undefined, `FIVE ALIBIS — ${CASE.title}`))
  bar.appendChild(h('div', 'brief',
    `${CASE.venue.name} ${CASE.venue.room} · 피해자 ${CASE.victim.name}(${CASE.victim.title}) · 추정 범행 ${SLOT_L(CRIME_SLOT)}`))

  // 조사 pip 은 삭제했다 — 일지의 여백 눈금이 같은 정보를 더 잘 말한다(ADR 018 3단계).
  // 같은 것을 두 곳에서 말하면 하나는 잉여이고, 눈금 쪽이 무엇에 썼는지까지 말한다.

  // AI 파이프라인 판 — 무엇이 무엇을 하고 있는지 여는 곳
  const dash = focusKey(h('button', `dashbtn${ui.dash ? ' on' : ''}`, '⚙ AI'), 'dash') as HTMLButtonElement
  dash.setAttribute('aria-expanded', String(ui.dash))
  dash.setAttribute('aria-label', 'AI 파이프라인 설정')
  dash.onclick = () => { ui.dash = !ui.dash; play('paper'); render() }
  bar.appendChild(dash)

  const mute = focusKey(h('button', 'mutebtn', isMuted() ? '♪ 꺼짐' : '♪ 켜짐'), 'mute') as HTMLButtonElement
  mute.setAttribute('aria-label', isMuted() ? '소리 켜기' : '소리 끄기')
  mute.onclick = () => { setMuted(!isMuted()); if (!isMuted()) play('paper'); render() }
  bar.appendChild(mute)

  const btn = h('button', undefined, '최종 추론') as HTMLButtonElement
  focusKey(btn, 'submit')
  btn.onclick = openSubmit
  bar.appendChild(btn)
  return bar
}

/* ─────────── 왼쪽: 용의자 ─────────── */

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

/**
 * 파이프라인 상태 칩 — 지금 무엇을 기다리는가.
 *
 * 네 칸을 **항상 다 보여주고** 지나온 칸에 불을 켠다. 현재 칸만 보이면
 * "이게 몇 번째인지" 를 알 수 없어서 여전히 끝을 가늠하지 못한다.
 * 음성 합성 칸은 서버 TTS 를 실제로 쓸 때만 켜진다 — 내장 합성은 즉시라서 칸이 없다.
 */
function stageChip(): HTMLElement {
  const ORDER = ['thinking', 'verifying', 'synthesizing', 'speaking'] as const
  const now = pipeStage()
  const at = ORDER.indexOf(now as (typeof ORDER)[number])

  const box = h('div', 'bubble a stagechip')
  const row = h('div', 'stages')
  ORDER.forEach((s, i) => {
    const done = at >= 0 && i < at
    const active = s === now
    const cell = h('span', `st${done ? ' done' : ''}${active ? ' on' : ''}`, STAGE_LABEL[s])
    row.appendChild(cell)
  })
  box.appendChild(row)

  /**
   * 타이핑 인디케이터 (P2-1) — 점 세 개가 숨쉬고, 기다림에 인물의 결을 입힌다.
   * 파이프라인 칩은 "시스템이 무엇을 하나" 를, 이 줄은 "사람이 무엇을 하나" 를 말한다 —
   * 같은 2초가 지연이 아니라 망설임으로 읽히게.
   */
  const typing = h('div', 'typing')
  typing.appendChild(h('i'))
  typing.appendChild(h('i'))
  typing.appendChild(h('i'))
  typing.appendChild(h('span', 'typing-l',
    now === 'verifying' ? '한 말을 되짚어 보고 있다'
    : now === 'synthesizing' || now === 'speaking' ? '목소리를 고르고 있다'
    : '말을 고르고 있다'))
  box.appendChild(typing)
  return box
}

function tellLabel(t: string): string {
  const m: Record<string, string> = {
    gaze: '(시선을 피한다)', pause: '(잠시 말이 멎는다)',
    stammer: '(말이 꼬인다)', anger: '(언성이 높아진다)',
  }
  return m[t] ?? ''
}

/**
 * 장소 → 방 안 좌표(미터). **이 표는 규칙이 아니라 배치다** — 어느 기록이
 * 어디에 있는지는 `evidence.place` 가 이미 정했고, 여기서는 그 다섯 자리를
 * 방 안의 실제 위치로 옮기기만 한다.
 */
const PLACE_AT: readonly [number, number][] = [
  [-9.5, 5.5],    // 로비 — 입구 쪽
  [9.5, 5.5],     // 복도
  [0, -6.5],      // 1204호 — 가장 안쪽
  [-9.5, -5.0],   // 직원계단
  [9.5, -5.0],    // 라운지
]

/**
 * 용의자들이 앉아 있는 자리. **경찰서 대기 구역이다.**
 * 방 가운데를 비워 두고 좌우로 벌려 놓는다 — 한 명에게 다가갈 때
 * 다른 사람의 원에 같이 걸리면 누구를 연행하는지 헷갈린다.
 */
const SEAT_AT: readonly [number, number][] = [
  [-5.0, 1.5], [-2.5, 3.0], [0, 1.5], [2.5, 3.0], [5.0, 1.5],
]

/** 경찰서에 앉아 있는 다섯 사람 */
function exploreSeats(): Seat[] {
  // **규칙은 engine 이 소유한다.** 누가 소거됐는지는 화면이 계산하지 않는다.
  const cands = candidatesFrom(CASE, new Set(ui.game.cards))
  return SUSPECTS.map((s, i) => ({
    id: s,
    slug: SLUG_BY_JOB[CASE.suspects[s].job] ?? 'security',
    at: SEAT_AT[i] ?? [0, 0],
    label: `${CASE.suspects[s].name} · ${CASE.suspects[s].job}`,
    // 이미 말을 걸어본 사람인가 — 발치 표식 색이 갈린다
    done: (ui.chats[s]?.length ?? 0) > 0,
    // 이 사람에게서 찾아낸 모순 수 — 이름표에 뜬다
    stamps: ui.game.foundContradictions.filter((k) => k.split('|')[1] === s).length,
    cleared: !cands.includes(s),
  }))
}

/**
 * 탐색 모드 화면 — **방을 걸어 다닌다.**
 *
 * 이건 기록 조회의 **또 하나의 입력 방법**이지 유일한 입력이 아니다.
 * 우면 기록철은 그대로 있고 버튼으로도 전부 조회된다 — 3D 가 실패하거나
 * 저사양이면 그쪽으로 그냥 돌아가면 된다. 이 프로젝트가 사진 폴백에서
 * 지켜 온 원칙과 같다.
 */
function exploreRoom(): HTMLElement {
  const page = h('div', 'nb-page nb-left explore')
  const host = exploreEl          // 새로 만들지 않는다 — 옮겨 붙일 뿐이다
  page.appendChild(host)

  // 씬이 서는 동안 검은 화면을 두지 않는다 (P2-4) — 로딩도 장면의 일부여야 한다
  if (!ui.explore?.handle) {
    page.appendChild(h('div', 'exloading', '경찰서로 이동 중 — 복도 불이 먼저 켜진다…'))
  }

  /**
   * **조사 잔량을 화면 안에 박는다.**
   *
   * 60 Seconds! 는 들 수 있는 개수를 손 아이콘 네 개로 화면 아래에 붙여 둔다 —
   * 뛰어다니는 동안 무엇을 포기할지가 계속 보인다. 우리의 "손 개수" 는 조사 9회인데,
   * 그 잔량이 오른쪽 수첩에만 있어서 **걸어다니는 동안 눈을 떼야** 보였다.
   * 자원이 보이지 않으면 자원 게임이 아니다.
   */
  const pips = h('div', 'expips')
  for (let i = 0; i < FIELD_BUDGET; i++) {
    pips.appendChild(h('i', `expip${i < ui.game.investigationsLeft ? '' : ' spent'}`))
  }
  pips.appendChild(h('span', 'expip-l', `남은 현장 조사 ${ui.game.investigationsLeft}`))
  page.appendChild(pips)

  const bar = h('div', 'exbar')
  const back = focusKey(h('button', 'backbtn', '← 책상으로'), 'exback') as HTMLButtonElement
  back.onclick = () => {
    ui.explore?.handle?.dispose()
    ui.explore = null
    render()
  }
  bar.appendChild(back)
  const nearId = ui.explore?.near ?? null
  const seatId = ui.explore?.nearSeat as SuspectId | null | undefined
  const ev = nearId ? CASE.evidence.find((e) => e.id === nearId) : null
  // **사람이 우선한다** — 연행이 조회보다 큰 행동이라 힌트도 그 순서다
  bar.appendChild(h('div', 'exhint', seatId
    ? `${CASE.suspects[seatId].name} · ${CASE.suspects[seatId].job} — E 또는 Space 를 눌러 취조실로 데려간다`
    : ev
      ? `${labelOfKind(ev.kind)} · ${SLOT_L(ev.slot)} ${PLACE_L(ev.place)} — E 또는 Space 로 조회 (조사 1회)`
      : '방향키·WASD 로 걷는다 · V 로 1인칭 전환 · 앉아 있는 사람에게 다가가면 취조실로 데려간다.'))
  page.appendChild(bar)

  // 씬은 한 번만 만든다. 재렌더마다 새로 만들면 WebGL 컨텍스트가 쌓인다.
  // **로딩 중에도 한 번뿐이다** — `handle` 은 로드가 끝나야 채워지므로 그것만 보면 못 막는다.
  if (ui.explore && !ui.explore.handle && !ui.explore.mounting) {
    ui.explore.mounting = true
    // 내가 조종하는 형사의 몸. 걷기 모델이 있는 것 중 아무거나 — 없는 걸 고르면 씬이 안 뜬다.
    const slug = SUSPECTS.map((s) => SLUG_BY_JOB[CASE.suspects[s].job] ?? '')
      .find((x) => hasWalkModel(x)) ?? 'security'
    void mountExplore(host, slug, {
      onNear: (id) => {
        if (!ui.explore || ui.explore.near === id) return
        ui.explore.near = id
        render()
      },
      onNearSeat: (id) => {
        if (!ui.explore || ui.explore.nearSeat === id) return
        ui.explore.nearSeat = id
        render()
      },
      /**
       * **취조실로 데려간다.** 여기서 규칙은 계산하지 않는다 —
       * 심문 자체(조사 소모·증언 해금)는 `doAsk` 가 호출하는 engine 이 정한다.
       * 이 화면은 장면을 바꾸기만 한다.
       */
      onTake: (id) => {
        // 챕터 게이트(ADR 022): 걸어 다니는 경찰서에서도 심문의 문은 같다
        if (!gatePass()) return
        play('doorOpen')
        ui.explore?.handle?.dispose()
        ui.explore = null
        hush(); stopVoice()
        mark({ k: 'open', who: id as SuspectId })
        ui.active = id as SuspectId
        render()
      },
      onPick: (id) => {
        // **규칙은 engine 이 정한다.** 여기서는 조회를 시도만 한다.
        // 예산 0 이어도 해금 기록(requires>0)은 무료다 — 보드 버튼과 같은 규칙 (ADR 023 §2)
        const ev = availableEvidence(ui.game).find((e) => e.id === id)
        if (ui.busy || !ev) return
        if (ui.game.investigationsLeft <= 0 && ev.requires.length === 0) return
        play('paper')
        mark({ k: 'lookup', ev: id })
        act(() => lookupEvidence(ui.game, id))
        ui.explore?.handle?.setMarkers(exploreMarkers())
      },
    }).then((hd) => {
      // **떠났으면 정리한다.** 로딩 중에 탐색 모드를 나갔으면 씬만 남는다.
      if (!ui.explore) return hd?.dispose()
      ui.explore.mounting = false
      if (!hd) {
        // 3D 가 안 되면 조용히 책상으로 되돌린다 — 빈 화면을 남기지 않는다
        ui.explore = null
        return render()
      }
      ui.explore.handle = hd
      hd.setMarkers(exploreMarkers())
      void hd.setSeats(exploreSeats())
      render()   // 로딩 표시를 걷는다 (P2-4) — handle 이 생겼으니 재렌더가 그 사실을 그린다
    })
  } else if (ui.explore?.handle) {
    ui.explore.handle.setMarkers(exploreMarkers())
    void ui.explore.handle.setSeats(exploreSeats())
  }
  return page
}

/** 지금 걸어가서 주울 수 있는 기록 — **무엇이 가능한지는 engine 이 정한다.** */
function exploreMarkers(): Marker[] {
  return availableEvidence(ui.game).map((e) => ({
    id: e.id,
    at: PLACE_AT[e.place] ?? [0, 0],
    label: `${labelOfKind(e.kind)} · ${SLOT_L(e.slot)} ${PLACE_L(e.place)}`,
    kind: e.kind,
    crime: e.slot === CRIME_SLOT,
  }))
}

/**
 * 좌면 — **책상이거나 취조실이다.** 우면은 이 전환에 관여하지 않는다.
 *
 * 두 모드의 폭이 같기 때문에(둘 다 62%) 3D 렌더러가 mount 시점에 잡은 크기가
 * 모드를 오가도 유효하다. 예전 3단에서는 45% 였고, 만약 모드마다 폭이 달랐으면
 * `stage3d.ts` 의 크기 계산(mount 시 `host.clientWidth`)을 건드려야 했을 것이다.
 */
function deskOrRoom(): HTMLElement {
  if (ui.active) return stage()
  if (ui.explore) return exploreRoom()

  const page = h('div', 'nb-page nb-left')
  page.appendChild(indexTabs())
  const body = h('div', 'nb-body')
  body.appendChild(
    ui.view === 'time' ? alibiGrid() : ui.view === 'place' ? placeGrid() : personSheets(),
  )
  page.appendChild(body)
  return page
}

/**
 * 우면 — **모드와 무관하게 항상 같은 것이 있다.**
 *
 * 위는 수사 일지(내가 지출한 내역), 아래는 기록철(다음에 쓸 수 있는 것).
 * 일지를 상단으로 **한정한** 이유가 있다: 정보 구조가 문제라고 진단해 놓고
 * 화면 절반을 회고에 주면 앞뒤가 안 맞는다. 일지는 새 정보를 주는 면이 아니다.
 *
 * 기록철을 탭 뒤로 내리지 않는 것도 의도다 — 격자 마지막 행 `확보 기록` 은
 * 조회 목록으로 손을 넘기려고 존재하는데, 목록이 탭 뒤에 있으면 그 인계가 끊긴다.
 */
function rightPage(): HTMLElement {
  const page = h('div', 'nb-page nb-right')

  page.appendChild(journalBlock())

  page.appendChild(h('div', 'nb-rule'))
  page.appendChild(board())
  return page
}

/**
 * 수사 일지 — **내가 지출한 내역.** 새 정보를 주는 면이 아니다.
 *
 * 조사 1회 = 정확히 한 줄이고, 그 줄 왼쪽에 눈금이 하나 그어진다.
 * 상단바의 조사 pip 을 없앤 것이 이 눈금 때문이다 — 같은 정보를 두 곳에서
 * 말하면 하나는 잉여이고, 눈금 쪽이 **무엇에 썼는지까지** 말한다.
 *
 * 미대조 조합과 모순은 별도 목록이 아니라 여기에 흡수된다. 모순은 일지 안의 인장이다.
 */
function journalBlock(): HTMLElement {
  const wrap = h('div', 'nb-journal')

  // 조서는 `ui.chats` 에 있다. journal.ts 는 인물별 배열만 받고 순번으로 맞춘다.
  const statements = Object.fromEntries(
    SUSPECTS.map((s) => [s, ui.chats[s]!.map((c) => {
      const st = c.st
      if (!st || !(st.time || st.place || st.action)) return undefined
      return [st.time, st.place, st.action].filter(Boolean).join(' · ')
    })]),
  ) as Partial<Record<SuspectId, (string | undefined)[]>>

  const lines = journalLines(CASE, ui.journey, statements)

  const head = h('div', 'nb-cap')
  head.appendChild(document.createTextNode('수사 일지'))
  // 잔량은 상태에서 직접 읽는다 — 일지 줄 수로 세면 심문(대화 지갑)이 현장 예산에 섞인다 (ADR 022)
  head.appendChild(h('span', 'nb-tally',
    `현장 조사 ${FIELD_BUDGET - Math.max(0, ui.game.investigationsLeft)} / ${FIELD_BUDGET}`))
  wrap.appendChild(head)

  if (lines.length === 0) {
    wrap.appendChild(h('div', 'hintline', '아직 적을 것이 없다. 기록을 조회하거나 사람을 만나야 한다.'))
  }

  /**
   * **동시 필기** — 새로 생긴 줄만 써지는 연출을 준다.
   *
   * 전체 재렌더 구조라 그냥 두면 행동할 때마다 **모든 줄이 다시 써진다**.
   * 알리바이 격자의 인장이 같은 이유로 한 번 겪은 문제다(`ui.stamped`).
   * 마지막으로 그린 줄 수를 기억해 그보다 늘어난 만큼만 새 줄로 본다.
   */
  const fresh = Math.max(0, lines.length - ui.journalSeen)
  ui.journalSeen = lines.length
  let lastFresh: HTMLElement | null = null

  lines.forEach((l, i) => {
    const isNew = i >= lines.length - fresh
    const row = h('div',
      `jl${l.spent ? ' spent' : ''}${l.stamp ? ` st-${l.stamp}` : ''}${isNew ? ' fresh' : ''}`)
    row.appendChild(h('span', 'jl-mark', l.spent ? '│' : ''))
    const body = h('div', 'jl-body')
    body.appendChild(h('span', 'jl-t', l.text))
    if (l.note) body.appendChild(h('span', 'jl-note', l.note))
    row.appendChild(body)
    wrap.appendChild(row)
    if (isNew) lastFresh = row
  })

  // 일지가 길어지면 새 줄이 화면 밖에 써진다 — 형사가 안 보고 적는 셈이다
  if (lastFresh) queueMicrotask(() => (lastFresh as HTMLElement).scrollIntoView({ block: 'nearest' }))

  wrap.appendChild(pendingBlock())
  return wrap
}

/**
 * 세로 인덱스 탭 — 수첩 가장자리에 붙은 색인이다.
 * 가로 탭(`.viewtabs`)이 격자 위 세로 공간을 먹고 있었는데, 세로로 세우면
 * 그 공간이 격자로 돌아간다. 수첩이라는 그릇에도 이쪽이 맞는다.
 */
function indexTabs(): HTMLElement {
  const tabs = h('div', 'nb-tabs')
  const TABS: [View, string, string][] = [
    ['time', '시각별', '누가 · 언제 · 어디라고 했나'],
    ['place', '장소별', '그 시각 그 자리에 누가 있었나'],
    ['person', '인물별', '이 사람이 무엇을 말했나'],
  ]
  // 미대조가 남아 있으면 대조표 탭의 귀퉁이를 접는다 — 연결은 조사를 소모하지
  // 않으므로 접힌 귀는 항상 **공짜 다음 수**를 가리킨다.
  const pending = pendingPairs(ui.game).length

  for (const [v, label, why] of TABS) {
    const on = ui.view === v
    const dog = v === 'time' && pending > 0
    const b = h('button', `nb-tab${on ? ' on' : ''}${dog ? ' dog' : ''}`) as HTMLButtonElement
    b.appendChild(h('span', 'nbt-l', label))
    b.setAttribute('aria-pressed', String(on))
    b.title = why
    focusKey(b, `view:${v}`)
    b.onclick = () => { play('paper'); mark({ k: 'view', to: v }); ui.view = v; render() }
    tabs.appendChild(b)
  }

  // 방으로 나간다 — 걷기 모델이 실린 배포에서만 보인다.
  // 없는 기능의 버튼을 두면 눌렀는데 아무 일도 안 일어나는 화면이 된다.
  /**
   * **첫 용의자 하나로 판단하면 안 된다.** 걷기 모델이 없는 직업(manager)이
   * 0번으로 뽑히는 판에서는 경찰서 탭이 통째로 사라졌다 — 8종 중 1종이므로
   * 시드의 일부에서 기능이 조용히 없어진다. 걸을 수 있는 사람이 하나라도 있으면 연다.
   */
  const walkable = SUSPECTS.some((s) => hasWalkModel(SLUG_BY_JOB[CASE.suspects[s].job] ?? ''))
  if (walkable && hasStation()) {
    const go = h('button', 'nb-tab exgo') as HTMLButtonElement
    go.appendChild(h('span', 'nbt-l', '경찰서'))
    go.title = '경찰서를 걸어 다니며 사람을 만나고 기록을 줍는다'
    focusKey(go, 'view:explore')
    go.onclick = () => { play('doorOpen'); ui.explore = { handle: null, mounting: false, near: null, nearSeat: null }; render() }
    tabs.appendChild(go)
  }
  return tabs
}

function stage(): HTMLElement {
  const col = h('div', 'nb-page nb-left')
  const box = h('div', 'stage')

  const s = ui.active!
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
  // 용의자 카드 — 이름·나이·관계·읽힌 성향 (ADR 022 심문 화면). 나이와 관계는 동기 추리의 재료다.
  meta.appendChild(h('div', 'name', `${sus.name} · ${sus.age}세 · ${sus.job}`))
  meta.appendChild(h('div', 'hint', `피해자와의 관계 — ${sus.relation}`))
  meta.appendChild(h('div', 'hint', `읽힌 성향: ${persona.label} — ${persona.hint}`))
  // 남은 대화 칩 — 인당 상한(10회)의 잔량. 소진이 가까울수록 붉어진다.
  const tl = talksLeft(ui.game, s)
  meta.appendChild(h('div', `talkchip${tl <= 0 ? ' off' : tl <= 3 ? ' low' : ''}`,
    tl > 0 ? `남은 대화 ${tl} / ${TALK_CAP}` : '이 사람과의 대화는 끝났다'))
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
  // **기다림에 이름을 붙인다.** 예전엔 `…` 하나였고, 2초 동안 플레이어는
  // 멈춘 건지 느린 건지 알 수 없었다. 단계가 보이면 같은 2초가 진행 중으로 읽힌다.
  // 그리고 이 칩은 장식이 아니다 — 이 게임에서 LLM 출력은 검증기를 통과해야만
  // 쓰이므로, '진술 검증' 칸이 곧 아키텍처를 화면에 드러낸 것이다.
  if (ui.busy || pipeStage() !== 'idle') log.appendChild(stageChip())
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
    `가로는 시각, 세로는 사람이다. ${SLOT_L(CRIME_SLOT)} 열이 범행 시각이다. ` +
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
  for (const t of slots) g.appendChild(h('div', `hd${t === CRIME_SLOT ? ' now' : ''}`, SLOT_L(t)))

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
    // **인물을 바꾸면 이전 사람의 목소리와 말풍선을 끊는다.** 안 끊으면 두 용의자가
    // 겹쳐 말한다. 원래 진입 경로(용의자 열)에는 있었는데, 격자·조서에서 들어가는
    // 새 경로 두 곳에 빠져 있었다 — 경로를 늘리면 정리도 같이 늘려야 한다.
    // 챕터 게이트(ADR 022): 현장 조사가 남아 있으면 심문 진입이 잠긴다.
    const choose = (): void => {
      if (!gatePass()) return
      hush(); stopVoice(); mark({ k: 'open', who: s }); ui.active = s; render()
    }
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
      cell.appendChild(h('span', undefined, known ? PLACE_L(sus.claim[t]!) : '—'))
      // **칸이 곧 진술 카드다.** 예전엔 같은 진술이 왼쪽 카드·격자·오른쪽 보유카드에 세 번 나왔다.
      // 격자에서 바로 집게 하면 중복이 사라지고, 연결이 "표 위의 한 칸을 짚는" 공간적 행동이 된다.
      if (known) {
        cell.setAttribute('role', 'button')
        cell.tabIndex = 0
        cell.setAttribute('aria-pressed', String(sel))
        cell.setAttribute('aria-label', `${sus.name} ${SLOT_L(t)} 진술 — 연결하려면 선택`)
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
  return e ? `${labelOfKind(e.kind)} · ${SLOT_L(e.slot)} ${PLACE_L(e.place)}` : evId
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
  for (const t of SLOTS) g.appendChild(h('div', `hd${t === CRIME_SLOT ? ' now' : ''}`, SLOT_L(t)))

  for (const p of PLACES) {
    const rowHd = h('div', `pwho${p === CRIME_PLACE ? ' scene' : ''}`)
    rowHd.appendChild(document.createTextNode(PLACE_L(p)))
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
        chip.setAttribute('aria-label', `${CASE.suspects[s].name} ${SLOT_L(t)} 진술 — 연결하려면 선택`)
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
    // **인물을 바꾸면 이전 사람의 목소리와 말풍선을 끊는다.** 안 끊으면 두 용의자가
    // 겹쳐 말한다. 원래 진입 경로(용의자 열)에는 있었는데, 격자·조서에서 들어가는
    // 새 경로 두 곳에 빠져 있었다 — 경로를 늘리면 정리도 같이 늘려야 한다.
    // 챕터 게이트(ADR 022): 조서에서도 같은 문이 잠긴다 — 경로마다 규칙이 다르면 안 된다.
    const choose = (): void => {
      if (!gatePass()) return
      hush(); stopVoice(); mark({ k: 'open', who: s }); ui.active = s; render()
    }
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
      .map((t) => `${SLOT_L(t)} ${PLACE_L(sus.claim[t]!)}`)
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
        `${SLOT_L(Number(slot) as Slot)} 진술이 ${evLabel(evId)} 기록과 어긋난다.`))
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
      `${evLabel(p.evidenceId)}  ↔  ${CASE.suspects[p.suspect].name}의 ${SLOT_L(p.slot)} 진술`))
    const b = h('button', 'pendbtn', '맞대보기') as HTMLButtonElement
    b.disabled = ui.busy
    focusKey(b, `pend:${p.evidenceId}:${p.claimCardId}`)
    b.onclick = () => {
      // 선택 상태를 거치지 않고 바로 연결한다 — 두 번 클릭시키면 장부의 값이 사라진다
      ui.selected = []
      const r = connect(ui.game, p.evidenceId, p.claimCardId)
      // **연결 경로가 둘이다** — 격자에서 카드 두 장을 집는 길과 이 버튼.
      // 여기에 기록이 빠져 있어서 맞대본 것이 일지에 한 줄도 안 남았다.
      // 행동을 늘리면 기록도 같이 늘려야 한다 (음성 정리와 같은 실수였다).
      mark({ k: 'connect', hit: r.contradiction })
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

function askBox(s: SuspectId): HTMLElement {
  const wrap = h('div', 'ask')
  const left = talksLeft(ui.game, s)
  const chips = h('div', 'chips')
  const input = h('input') as HTMLInputElement
  input.placeholder = left > 0 ? '직접 질문을 입력하십시오' : '이 사람과의 대화는 끝났다'
  input.maxLength = 200
  input.disabled = left <= 0

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
  send.disabled = ui.busy || left <= 0
  send.onclick = () => { void doAsk(s, input.value) }
  input.onkeydown = (e) => {
    // 한글 IME: 조합 확정용 Enter 와 전송용 Enter 는 다르다.
    // isComposing 을 안 보면 "안녕하세" 상태에서 질문이 잘린 채 전송되고,
    // 조사 1회가 그대로 날아간다 (되돌릴 수 없는 자원이다).
    if (e.isComposing) return
    if (e.key === 'Enter') void doAsk(s, input.value)
  }
  row.appendChild(send)
  // 대화는 인당 상한이다 (ADR 022) — 잔량을 이 사람 옆에 붙여야 "누구에게 얼마 남았나" 가 보인다
  row.appendChild(h('span', 'cost', `대화 ${ui.game.talks[s]} / ${TALK_CAP}`))
  wrap.appendChild(row)

  if (ui.selected.length === 1 && left > 0) {
    const evId = ui.selected[0]!
    // 버튼을 조건부로 비활성화하면 **활성화 자체가 정답을 유출한다** (해금 쌍은 범인에게만 있다).
    // 항상 누를 수 있게 두고, 헛수고의 책임은 플레이어가 진다.
    const present = h('button', undefined, '선택한 카드를 들이민다 (대화 1회)') as HTMLButtonElement
    present.disabled = ui.busy
    present.style.marginTop = '7px'
    present.onclick = () => { void doPresent(s, evId) }
    wrap.appendChild(present)
    wrap.appendChild(h('div', 'hintline', '엉뚱한 상대에게 들이밀면 대화 1회만 소모된다.'))
  }
  return wrap
}

/* ─────────── 오른쪽: 사건 보드 ─────────── */
function labelOfKind(k: string): string {
  const m: Record<string, string> = { keycard: '카드키 기록', cctv: 'CCTV', call: '통화 내역', receipt: '영수증', autopsy: '검시 소견' }
  return kindLabel(CASE, k as Evidence['kind'], m[k] ?? k)
}

/** 3축 셋째 축의 표시명 — 호텔은 '살인 도구', 월드 사건은 스킨이 정한다 (예: gc001 '수단') */
const WEAPON_AXIS = CASE.world?.weaponAxisLabel ?? '살인 도구'
/** 검시 기록의 표시명 — 안내 문장들이 같은 이름을 불러야 플레이어가 같은 물건으로 읽는다 */
const AUTOPSY_NAME = kindLabel(CASE, 'autopsy', '검시 소견')

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
    [`${SLOT_L(CRIME_SLOT)} — 후보를 지우는 기록`, avail.filter((e) => e.slot === CRIME_SLOT)],
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
    const label = `${labelOfKind(e.kind)} · ${SLOT_L(e.slot)} ${PLACE_L(e.place)}`
    // 검시 소견은 범행 시각 기록이지만 사람을 지우지 못한다 — '후보 소거' 로 적으면 거짓말이 된다.
    // 인물을 담지 않은 기록(gc001 의 위치 비고정 통화 등)도 마찬가지다: 정황일 뿐 소거가 아니다.
    const use = e.kind === 'autopsy' ? `${WEAPON_AXIS} 판독`
      : e.slot === CRIME_SLOT ? (e.subjects.length ? '후보 소거' : '정황 확인')
      : '해금·교차검증'
    // 같은 시각·장소 기록이 두 장이면 조회 전에는 **완전히 똑같아 보여** 선택이 동전 던지기가 된다.
    // 기록번호를 붙여 구분한다 — 내용을 흘리지 않으면서 "다른 문서" 임을 알린다 (자동 리뷰 minor/fairness).
    /**
     * **예산 소진 후에도 해금 기록(requires>0)은 열려 있어야 한다.**
     * 엔진은 그 조회를 무료로 허용하는데(ADR 023 §2) 버튼이 일괄 비활성이면
     * 통찰 보너스가 화면에서만 죽는다 — gc001 실플레이에서 실제로 밟은 버그다.
     */
    const free = ui.game.investigationsLeft <= 0 && e.requires.length > 0
    const b = h('button', undefined,
      `[${e.id}] ${label} — ${use} (${free ? '무료 — 자물쇠 값은 치렀다' : '조사 1회'})`) as HTMLButtonElement
    b.disabled = ui.busy || (ui.game.investigationsLeft <= 0 && e.requires.length === 0)
    b.onclick = () => { play('paper'); mark({ k: 'lookup', ev: e.id }); act(() => lookupEvidence(ui.game, e.id)) }
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
        `🔒 ${labelOfKind(l.evidence.kind)} · ${SLOT_L(l.evidence.slot)} ${PLACE_L(l.evidence.place)}`))
      row.appendChild(h('div', undefined, `   조건 ${l.met}/${l.total} — 필요: ${l.missing.join(', ')}`))
      // "결정적 = 범행 시각·현장" 은 호텔 생성기의 습관이었다 — 플래그로 판별한다 (GC001 계약 §2).
      // gc001 의 결정적 기록은 은폐 시각(21:18)에 있다.
      if (l.evidence.decisive) {
        // ADR 022: 이 사슬은 채점 축이 아니라 **통찰 보너스**다 — 문구가 배점을 부풀리면 안 된다
        row.appendChild(h('div', undefined,
          '   이것이 결정적 증거다 — 열면 통찰 보너스 +10. 범인을 못박는 유일한 기록이기도 하다.'))
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
      const evName = ev ? `${labelOfKind(ev.kind)} · ${SLOT_L(ev.slot)} ${PLACE_L(ev.place)}` : evId!
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

/** 여정 한 줄. **시각은 판 시작 기준 상대 밀리초** — 절대 시각은 생활 패턴이 된다. */
function mark(e: TraceInput): void {
  ui.journey = trace(ui.journey, { ...e, t: Date.now() - ui.journey.startedAt } as TraceEvent)
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
    mark({ k: 'connect', hit: r.contradiction })
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
    syncChapter()
    render()
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e))
  }
}

/**
 * 챕터 전이 감시 — 현장 조사가 끝나는 **그 행동 직후** 수사 정리를 한 번 편다 (ADR 022).
 * 걸쇠(ui.chapter2)를 먼저 잠근다: fieldDone 은 심문 중 해금으로 되돌아갈 수 있어서
 * 이 값으로 게이트를 직접 몰면 열렸던 심문이 도로 잠긴다.
 */
function syncChapter(): void {
  if (ui.chapter2 || !fieldDone(ui.game)) return
  ui.chapter2 = true
  play('doorOpen')
  openCaseReview()
}

/** 심문 진입 게이트 (ADR 022) — 현장 조사가 남아 있으면 심문은 잠긴다 */
function gatePass(): boolean {
  if (ui.chapter2) return true
  play('deny')
  // 디에게틱 문구 (P2-3) — 매뉴얼이 아니라 형사의 독백. 숫자(남은 횟수)는 남긴다.
  ui.gateMsg = `아직 현장이 남았다 — 기록 ${ui.game.investigationsLeft}건을 더 꺼내 보기 전엔 취조실 문이 열리지 않는다.`
  render()
  setTimeout(() => { if (ui.gateMsg) { ui.gateMsg = null; render() } }, 2600)
  return false
}

/**
 * 수사 정리 — 1장과 2장 사이의 쉼표. 확보한 것을 한 화면에 모아 보여주고
 * 심문에서 무엇을 캐물을지 정하게 한다. **새 정보는 없다** — 전부 이미 손에 쥔 것이고,
 * 여기서 새 것을 주면 정리 화면이 아니라 보상 화면이 된다.
 */
function openCaseReview(): void {
  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet casefile')
  sheet.appendChild(fileHeader('수사\n정리'))
  sheet.appendChild(h('h2', undefined, '현장 조사 종료'))

  // ① 확보한 기록
  const owned = CASE.evidence.filter((e) => ui.game.cards.includes(e.id))
  sheet.appendChild(h('label', undefined, `확보한 기록 (${owned.length})`))
  if (owned.length === 0) sheet.appendChild(h('div', 'hintline', '확보한 기록이 없다.'))
  for (const e of owned) {
    const who = e.subjects.length ? ` — ${e.subjects.map((s) => CASE.suspects[s].name).join(', ')} 확인` : ''
    sheet.appendChild(h('div', 'hintline', `${labelOfKind(e.kind)} · ${SLOT_L(e.slot)} ${PLACE_L(e.place)}${who}`))
  }

  // ② 검시 소견/현장 판정 — 셋째 축의 근거. 확보 여부가 지목의 성격(판독/추측)을 가른다
  sheet.appendChild(h('label', undefined, AUTOPSY_NAME))
  const hasAutopsy = owned.some((e) => e.kind === 'autopsy')
  sheet.appendChild(h('div', hasAutopsy ? 'contradiction' : 'hintline',
    hasAutopsy
      ? CASE.world?.autopsyText ?? WEAPON_TRACE[CASE.weapon] ?? ''
      : `확인하지 않았다 — ${WEAPON_AXIS} 지목은 추측이 된다.`))

  // ③ 확보한 증언
  const heldTestimonies = CASE.testimonies.filter((t) => ui.game.cards.includes(t.id))
  if (heldTestimonies.length) {
    sheet.appendChild(h('label', undefined, `확보한 증언 (${heldTestimonies.length})`))
    for (const t of heldTestimonies) {
      sheet.appendChild(h('div', 'hintline', `${CASE.suspects[t.from].name} — ${t.text}`))
    }
  }

  // ④ 핵심 단서 요약 — 상태를 읽어 그릴 뿐, 판정은 하지 않는다
  const cands = candidatesFrom(CASE, new Set(ui.game.cards))
  sheet.appendChild(h('label', undefined, '수사 상황'))
  sheet.appendChild(h('div', 'tally',
    `남은 후보 ${cands.length}명 · 찾아낸 인장 ${ui.game.foundContradictions.length}건 · ` +
    `아직 안 맞춰본 조합 ${pendingPairs(ui.game).length}건`))
  sheet.appendChild(h('p', undefined,
    '이제 다섯 사람을 심문한다. 한 사람과의 대화는 10회가 상한이다 — 다 쓸 필요는 없다. ' +
    '기록과 어긋난 진술이 있는 사람부터 캐묻는 것이 보통 빠르다.'))

  const go = h('button', undefined, '심문 시작') as HTMLButtonElement
  go.style.marginTop = '12px'
  go.onclick = () => { play('paper'); fadeOut(ov); render() }
  sheet.appendChild(go)

  ov.appendChild(sheet)
  document.body.appendChild(ov)
  queueMicrotask(() => go.focus())
}

async function doAsk(s: SuspectId, question: string): Promise<void> {
  const q = question.trim()
  if (!q || ui.busy || talksLeft(ui.game, s) <= 0) return
  ui.busy = true
  setStage('thinking')
  render()

  const before = ui.game
  ui.game = interview(ui.game, s) // 대화 횟수는 낙관적으로 먼저 깎는다 (폴백이면 환불)

  const r = await ask({
    seed: CASE.seed, world: WORLD_ID ?? undefined, caseId: IS_GC001 ? 'gc001' : undefined,
    suspectId: s, personaId: CASE.suspects[s].personaId,
    question: q, pressure: before.pressure[s],
    history: ui.chats[s]!.map((c) => ({ q: c.q, a: c.a })),
  })

  // 폴백이면 조사 횟수를 돌려준다 — AI 실패의 대가를 플레이어가 치르지 않는다
  setStage(r.fallback ? 'idle' : 'verifying', r.fallback ? FALLBACK_LABEL : undefined)
  if (r.fallback) ui.game = before

  mark({ k: 'ask', who: s, preset: PRESETS.some((p) => p.q === q), fallback: r.fallback })
  ui.chats[s] = [...ui.chats[s]!, { q, a: r.reply.speech, fallback: r.fallback, tell: r.reply.tell, st: r.reply.statement }]
  ui.busy = false
  // 응답 도착음 (P2-1) — 조서 한 장이 놓이는 소리. 폴백은 아무것도 도착하지 않은 것이다.
  if (!r.fallback) play('paper')
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
    seed: CASE.seed, world: WORLD_ID ?? undefined, caseId: IS_GC001 ? 'gc001' : undefined,
    suspectId: s, personaId: CASE.suspects[s].personaId,
    question: '이 기록을 어떻게 설명하시겠습니까?',
    presentedEvidence: cardSummary(CASE, evId),
    pressure: before.pressure[s],
    history: ui.chats[s]!.map((c) => ({ q: c.q, a: c.a })),
  })
  if (r.fallback) ui.game = before

  // **판별은 엔진이 소유한다.** 폴백이면 해금 여부를 알려선 안 된다 —
  // 해금 쌍은 범인에게만 있어서 그 한 줄이 곧 정답이다 (`presentReveal` 주석).
  const reveal = presentReveal(before, advanced, r.fallback)
  mark({ k: 'present', ev: evId, who: s, opened: reveal === 'opened' })
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
    return '\n\n▸ 응답을 받지 못했다. 대화 횟수를 돌려주고, 이 제시는 없던 것으로 한다.'
  }
  if (reveal === 'nothing') {
    return '\n\n▸ 이 사람은 이 기록에 대해 열어줄 진술이 없다 — 이 조합은 해금 경로가 아니다.' +
      ' 다만 이것은 **자물쇠에 대한 소거일 뿐, 범인 후보를 지우지는 않는다.**' +
      ' 사람을 지우는 건 범행 시각의 기록뿐이다.'
  }
  const key = (g: GameState) => {
    // 결정적 기록의 자물쇠 진행도 — 슬롯·장소가 아니라 플래그로 찾는다 (gc001 은 은폐 시각에 있다)
    const l = lockedRecords(g).find((x) => x.evidence.decisive)
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

/* ─────────── 최종 추론 · 결과 ─────────── */
/**
 * 지목 시트 3축 — 범인 · 동기 · 살인 도구 (ADR 022).
 *
 * '결정적 증거 지목' 과 '수단(카드키 발급 구분)' 축은 시트에서 내렸다 —
 * 둘 다 잠긴 기록 사슬 하나에 걸려 점수가 몰렸고, 이제 그 사슬은 통찰 보너스(+10)로만 산다.
 */
function openSubmit(): void {
  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet casefile')
  sheet.appendChild(fileHeader('송치\n의견'))
  sheet.appendChild(h('h2', undefined, '최종 추론'))
  // 지금까지 손에 쥔 것을 한 줄로 상기시킨다 — 지목은 기억이 아니라 근거로 하는 것이다.
  const held = ui.game.cards.filter((id) => CASE.evidence.some((e) => e.id === id)).length
  const talksSpent = SUSPECTS.reduce((a, s) => a + ui.game.talks[s], 0)
  sheet.appendChild(h('div', 'tally',
    `현장 조사 ${FIELD_BUDGET - Math.max(0, ui.game.investigationsLeft)}회 · 대화 ${talksSpent}회 · ` +
    `확보한 기록 ${held}건 · 찾아낸 인장 ${ui.game.foundContradictions.length}건` +
    (ui.game.ruledOut.length ? ` · 소거한 조합 ${ui.game.ruledOut.length}건` : '')))
  sheet.appendChild(h('p', undefined,
    `누가, 왜, 무엇으로 죽였는가 — 세 가지를 지목합니다. 범인 60점 · 동기 15점 · ${WEAPON_AXIS} 15점.`))

  const opt = (v: string, t: string): HTMLOptionElement => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; return o
  }
  const who = h('select') as HTMLSelectElement
  for (const s of SUSPECTS) {
    who.appendChild(opt(s, `${CASE.suspects[s].name} (${CASE.suspects[s].age}세 · ${CASE.suspects[s].job})`))
  }

  /**
   * 동기 — 다섯 용의자의 사정 다섯을 **이름 없이** 나열한다 (ADR 022).
   * 순서는 시드 파생 셔플로 고정한다: 무작위여야 "몇 번째가 누구" 가 안 성립하고,
   * 고정이어야 시트를 다시 열 때마다 순서가 바뀌는 사무 실수가 안 생긴다.
   */
  const motive = h('select') as HTMLSelectElement
  const motiveOptions = shuffle(makeRng(CASE.seed ^ 0x51ed270b), SUSPECTS.map((s) => CASE.suspects[s].motive))
  for (const m of motiveOptions) motive.appendChild(opt(m, m))

  // 셋째 축 — 표시명·선택지를 월드가 정한다 (호텔: '살인 도구'/WEAPONS, gc001: '수단'/추상 분류 5종)
  const weapon = h('select') as HTMLSelectElement
  for (const w of CASE.world?.weaponOptions ?? WEAPONS) weapon.appendChild(opt(w, w))

  sheet.appendChild(h('label', undefined, '범인')); sheet.appendChild(who)
  sheet.appendChild(h('label', undefined, '동기'))
  sheet.appendChild(h('div', 'hintline',
    '다섯 사람 모두 피해자와 얽힌 사정이 하나씩 있다 — 그중 **살인까지 간 사정**은 하나다. ' +
    '심문에서 관계를 캐물어야 각자의 사정이 드러난다.'))
  sheet.appendChild(motive)
  sheet.appendChild(h('label', undefined, WEAPON_AXIS))
  sheet.appendChild(h('div', 'hintline',
    `${AUTOPSY_NAME} 기록이 ${WEAPON_AXIS}의 근거다 — 확보하지 않았다면 지금 이 선택은 추측이다.`))
  sheet.appendChild(weapon)

  const go = h('button', undefined, '제출') as HTMLButtonElement
  go.style.marginTop = '16px'
  go.onclick = () => { ov.remove(); showResult(who.value as SuspectId, motive.value, weapon.value) }
  const cancel = h('button', undefined, '더 조사하기') as HTMLButtonElement
  cancel.style.cssText = 'margin:16px 0 0 8px'
  cancel.onclick = () => ov.remove()
  sheet.appendChild(go); sheet.appendChild(cancel)

  ov.appendChild(sheet)
  document.body.appendChild(ov)
}

function showResult(culprit: SuspectId, motive: string, weapon: string): void {
  const r = submit(ui.game, { culprit, motive, weapon })
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
  /**
   * **검거일 때만 재현이 나온다.**
   * 틀렸으면 진범을 밝히지 않는 것이 이 게임의 규율이고(QA 5.7), 재현은 곧 정답 공개다.
   * 영상이 없으면 `playReenactment` 가 즉시 resolve 하므로 지금과 똑같이 돈다.
   */
  // 재현 영상의 자막은 호텔 사건 전용(카드키·12층)이다 — 월드 사건에서는 틀지 않는다.
  // 클립이 없으면 어차피 즉시 resolve 라, 이 분기는 gc001 에서 자막 거짓말만 막는다.
  const reenact = r.correct.culprit && !CASE.world ? playReenactment(CASE, culprit) : Promise.resolve()
  void reenact
    .then(() => playOutro(CASE, culprit, r.correct.culprit))
    .then(() => renderResultSheet(r, { culprit, motive, weapon }))
}

/**
 * 오답 진단 — **범인·정답 동기·정답 도구는 절대 말하지 않는다.**
 * 대신 "어느 시간대가 비었는가 · 누가 말을 바꿨는가 · 어느 축의 근거가 부족한가" 를 준다.
 * 다음 수사의 방향은 주되 답은 주지 않는다 (QA 5.7).
 */
function diagnosis(r: ReturnType<typeof submit>): HTMLElement {
  const box = h('div', 'diag')
  box.appendChild(h('h3', undefined, '수사 진단'))
  const held = new Set(ui.game.cards)
  const lines: string[] = []

  /**
   * 부족한 축 안내 (ADR 022) — 어긋난 축과 **그 축을 뒷받침하는 근거의 종류**만 말한다.
   * 정답이 무엇인지는 말하지 않는다 — 진단은 재수사의 나침반이지 해설이 아니다.
   */
  if (!r.correct.motive) {
    lines.push('동기 지목이 어긋났습니다 — 동기는 어휘가 아니라 사람의 사정입니다. ' +
      '다섯 사람 모두 사정이 하나씩 있으니, 심문에서 관계를 캐물어 누구의 사정이 살인까지 갔는지 다시 재보십시오.')
  }
  if (!r.correct.weapon) {
    const hadAutopsy = CASE.evidence.some((e) => e.kind === 'autopsy' && held.has(e.id))
    lines.push(hadAutopsy
      ? `${WEAPON_AXIS} 지목이 어긋났습니다 — ${AUTOPSY_NAME}의 판정 서술을 다시 읽어보십시오. 서술과 답은 하나로 이어집니다.`
      : `${WEAPON_AXIS} 지목을 뒷받침할 근거가 없습니다 — ${josa(AUTOPSY_NAME, '을/를')} 확인하지 않은 채 고른 답은 추측입니다.`)
  }

  // ① 범행 시각 기록을 얼마나 열었나 — 사람을 지우는 유일한 수단이다
  const crimeRecs = CASE.evidence.filter((e) => e.slot === CRIME_SLOT)
  const openedCrime = crimeRecs.filter((e) => held.has(e.id)).length
  if (openedCrime < crimeRecs.length) {
    lines.push(`${SLOT_L(CRIME_SLOT)} 기록 ${crimeRecs.length}건 중 ${openedCrime}건만 확인했습니다. ` +
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

  /**
   * **여정 로그의 첫 실사용처.**
   * 위 ①~④는 전부 "지금 무엇을 갖고 있나"(상태)에서 나온다. 그래서
   * "한 사람만 계속 팠다" 같은 건 원리상 말할 수 없다 — 그건 지나간 과정이라
   * 상태에 안 남기 때문이다. 여정을 남기면 그 한 줄이 가능해진다.
   */
  const pf = profile(ui.journey)
  if (pf.note) {
    box.appendChild(h('div', 'diag-style', `읽힌 수사 방식: ${pf.style} — ${pf.note}`))
  }

  box.appendChild(h('div', 'diag-note', '진범은 밝히지 않습니다. 같은 사건번호로 다시 수사할 수 있습니다.'))
  return box
}

/**
 * 정답 결말 — **사실 요약이 아니라 이야기**로 닫는다 (QA 5.8).
 * "범인은 돈 때문에 도구로 죽였다" 는 범죄 사실이지 사건이 아니다.
 * ADR 022: 발단→전개→위기→절정→결말 **5단계 재구성** — 케이스 사실(궤적·동기·도구)로 채운다.
 * 새 카툰 페이지를 만들지 않는다 — outro 카툰이 닫고, 이 타임라인이 서류로 남는다.
 */
function storyBlock(): HTMLElement {
  const c = CASE.suspects[CASE.culprit]
  const persona = personaById(c.personaId)
  const d = CASE.evidence.find((e) => e.decisive)!
  const box = h('div', 'story')
  box.appendChild(h('h3', undefined, '사건의 전말 — 다섯 단계'))

  /**
   * 고정 사건은 5단계를 직접 소유한다 (gc001 — 정본 §18 을 5단계로 옮긴 것).
   * 아래 기본 5단계는 호텔 생성기의 사건 모양(접근 복도·직원계단·카드키)에 묶여 있어서
   * 월드 사건에 그대로 쓰면 거짓 재구성이 된다.
   */
  if (CASE.ending) {
    for (const [k, t] of CASE.ending.beats) {
      const row = h('div', 'beat')
      row.appendChild(h('span', 'beat-k', k))
      row.appendChild(h('span', 'beat-t', t))
      box.appendChild(row)
    }
    return box
  }

  const beats: [string, string][] = [
    // 조사는 josa() 로 붙인다 — 이름이 매 판 바뀌므로 '와(과)' 같은 회피 표기는 쓰지 않는다.
    // relation 은 "피해자에게 큰돈을 빌려줬다" 같은 절이라 피해자 이름을 겹쳐 부르면 안 된다
    // (실플레이에서 "남기훈과 피해자에게" 로 읽혔다).
    ['발단', `${josa(c.name, '은/는')} ${c.relation}. ` +
             `그리고 ${josa(CASE.motive, '이/가')} ${josa(CASE.victim.name, '과/와')}의 사이에 남아 있었다.`],
    // 전개 — 접근. 궤적의 실제 이동(범행 직전 시각)을 쓴다
    ['전개', `${SLOT_L(1)}, ${josa(PLACE_L(c.truth[1]!), '을/를')} 지나 12층으로 향했다. ` +
             `아무도 그 걸음의 뜻을 몰랐다.`],
    ['위기', `${SLOT_L(CRIME_SLOT)}, ${CASE.venue.room}. 문이 열렸고, 그 시각 그 방에 있었던 사람은 둘 — ` +
             `나온 사람은 하나뿐이었다.`],
    // 도구는 사건마다 '준비된 것' 일 수도 있어 단정하지 않는다 — 이름만 놓는다
    ['절정', `그리고 ${josa(CASE.weapon, '이/가')} 쓰였다. 검시 소견의 흔적이 그 순간의 기록이다.`],
    // keyLabel 은 "복제 의심 (미등록 사본)" 처럼 괄호로 끝나 조사가 안 붙는다 — 인용으로 놓는다
    ['결말', `${josa(PLACE_L(c.truth[3]!), '으로/로')} 빠져나갔지만 카드키 기록은 남았다 — ` +
             `발급 구분 '${d.keyLabel ?? '불명'}'. ${persona.confession}`],
  ]
  for (const [k, t] of beats) {
    const row = h('div', 'beat')
    row.appendChild(h('span', 'beat-k', k))
    row.appendChild(h('span', 'beat-t', t))
    box.appendChild(row)
  }
  return box
}

function renderResultSheet(
  r: ReturnType<typeof submit>,
  sub: { culprit: SuspectId; motive: string; weapon: string },
): void {
  // 판이 끝났다 — 여정을 닫고 남긴다. **로컬에만 쌓이고 서버로 가지 않는다.**
  mark({ k: 'submit', who: sub.culprit, correct: r.correct.culprit, score: r.total })
  saveTrace(ui.journey)

  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet casefile')
  // 붉은 인장은 '확정' 의 색이다. 못 맞혔으면 색을 빼야 한다 — 색이 곧 판정이다.
  play(r.correct.culprit ? 'solved' : 'filed')
  sheet.appendChild(fileHeader(r.correct.culprit ? '사건\n해결' : '미제\n편철', !r.correct.culprit))
  /**
   * **판정을 네 등급으로 나눠 이름을 준다** (QA 5.6).
   * "범인을 맞혔습니다 / 아닙니다" 두 칸뿐이면, 범인을 찾고도 사건의 전모를 놓친 판과
   * 아무것도 못 한 판이 같은 문장으로 끝난다. 3축(범인·동기·도구)을 갈라서 부른다.
   */
  const fullStory = r.correct.motive && r.correct.weapon
  const grade = r.correct.culprit
    ? (fullStory ? { t: '사건 완전 해결', k: 'ok' } : { t: '범인은 잡았으나 사건의 전모가 어긋납니다', k: 'ok half' })
    : (r.correct.motive || r.correct.weapon
        ? { t: '방향은 옳았으나 대상이 틀렸습니다', k: 'no half' }
        : { t: '수사 실패', k: 'no' })
  sheet.appendChild(h('div', `verdict ${grade.k}`, grade.t))

  /**
   * **맞힌 것과 좁힌 것은 다르다.**
   * 후보가 넷 남은 채 찍어 맞힌 판과 기록으로 한 사람까지 몬 판이
   * 같은 문장으로 끝나고 있었다 (자동 리뷰 major/feedback).
   * 점수 눈금(60/50/40)은 ADR 022 에서 버렸지만 — 3축에서는 셋 다 찍어 맞힐 확률이
   * 1/125 라 눈금 없이도 찍기가 배제된다 — 서사는 남긴다: 무엇을 한 판인지 정확히 적는다.
   */
  const endCands = candidatesFrom(CASE, new Set(ui.game.cards))
  if (r.correct.culprit) {
    sheet.appendChild(h('div', endCands.length === 1 ? 'contradiction' : 'hintline',
      endCands.length === 1
        ? '기록만으로 한 사람까지 좁힌 뒤 지목했습니다 — 추리가 완성된 판입니다.'
        : `다만 기록으로는 아직 ${endCands.length}명이 남아 있었습니다 — 좁혀서 맞힌 것이 아니라 ` +
          `남은 후보 중에서 고른 것입니다. ` +
          `${SLOT_L(CRIME_SLOT)} 기록을 더 열었다면 지목이 필연이 됐을 것입니다.`))
  } else if (endCands.length > 1) {
    sheet.appendChild(h('div', 'hintline',
      `제출 시점에 기록으로 좁혀진 후보는 ${endCands.length}명이었습니다. ` +
      `사람을 지우는 건 ${SLOT_L(CRIME_SLOT)} 기록뿐입니다 — 진술과 인장은 의심의 근거이지 소거가 아닙니다.`))
  }
  /**
   * ## 지목 정확도 — 3축 각각에 O·X (ADR 022)
   * 등급 한 줄로는 "무엇이 맞고 무엇이 어긋났는지" 가 안 보인다.
   * 오답 엔딩에서도 축별 판정 자체는 보여준다 — 정답은 diagnosis 가 끝까지 감춘다.
   */
  const axes = h('div', 'axes')
  const axisRow = (label: string, picked: string, ok: boolean): void => {
    const row = h('div', `axis ${ok ? 'ok' : 'no'}`)
    row.appendChild(h('span', 'axis-m', ok ? '○' : '✕'))
    row.appendChild(h('span', 'axis-k', label))
    row.appendChild(h('span', 'axis-v', picked))
    axes.appendChild(row)
  }
  axisRow('범인', `${CASE.suspects[sub.culprit].name} (${CASE.suspects[sub.culprit].job})`, r.correct.culprit)
  axisRow('동기', sub.motive, r.correct.motive)
  axisRow(WEAPON_AXIS, sub.weapon, r.correct.weapon)
  sheet.appendChild(axes)

  /**
   * ## 오답이면 **진범을 밝히지 않는다** (QA 5.7)
   *
   * "오답은 정답 공개 화면이 아니라 재수사를 위한 진단 화면이어야 한다."
   * 즉시 범인을 공개하면 같은 사건에 다시 도전할 이유가 사라진다.
   * 대신 **무엇을 놓쳤는지**를 정답을 노출하지 않고 짚어 준다.
   */
  if (r.correct.culprit) {
    /**
     * 자백 — 페르소나별 결정론 템플릿 (ADR 022, LLM 아님).
     * 마지막 화면이 폴백으로 끝나면 게임 전체가 폴백으로 기억된다.
     */
    const k = CASE.suspects[CASE.culprit]
    const confess = h('div', 'confess')
    confess.appendChild(h('div', 'confess-who', `${k.name}의 자백`))
    // 고정 사건은 자백도 직접 소유한다 (GC001 계약 §2) — 아니면 페르소나 결정론 템플릿
    confess.appendChild(h('div', 'confess-t', CASE.ending
      ? `“${CASE.ending.confession}”`
      : `“${confessionFor(k.personaId, {
      name: k.name,
      victim: CASE.victim.name,
      time: SLOT_L(CRIME_SLOT),
      room: CASE.venue.room,
      motive: CASE.motive,
      weapon: CASE.weapon,
    })}”`))
    sheet.appendChild(confess)
    sheet.appendChild(storyBlock())
  } else {
    sheet.appendChild(diagnosis(r))
  }

  /**
   * 축별 해설은 **범인을 맞혔을 때만** 편다 (QA 5.7).
   * 동기·도구의 정답 언급은 오답 화면에선 정답 유출이다 —
   * 진단 화면을 조심스럽게 써 놓고 옆문으로 정답을 흘리는 셈이 된다.
   */
  if (r.correct.culprit) {
    if (!r.correct.weapon) {
      const hadAutopsy = CASE.evidence.some((e) => e.kind === 'autopsy' && ui.game.cards.includes(e.id))
      const trace = CASE.world?.autopsyText ?? WEAPON_TRACE[CASE.weapon]
      sheet.appendChild(h('div', 'hintline',
        hadAutopsy
          ? `${josa(WEAPON_AXIS, '은/는')} ${AUTOPSY_NAME}에 적혀 있었다 — "${trace}" 이 판정이 가리키는 것은 ${josa(CASE.weapon, '이다/다')}.`
          : `${josa(WEAPON_AXIS, '은/는')} ${josa(CASE.weapon, '이었다/였다')}. ${AUTOPSY_NAME} 기록을 확보했다면 판독할 수 있었다.`))
    }
    if (!r.correct.motive) {
      sheet.appendChild(h('div', 'hintline',
        `동기는 ${josa(CASE.motive, '이었다/였다')} — ${CASE.suspects[CASE.culprit].name}의 사정이다. ` +
        `다섯 사정 중 살인까지 간 것이 무엇인지는 심문이 말해준다.`))
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
        `${SLOT_L(i as Slot)}  ${k.name} — ${PLACE_L(place)}${i === CRIME_SLOT ? '   ← 범행' : ''}`)
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
  line('동기', r.breakdown.motive)
  line(WEAPON_AXIS, r.breakdown.weapon)
  line(`남은 현장 조사 ${Math.max(0, ui.game.investigationsLeft)}회`, r.breakdown.efficiency)
  // 통찰 = 잠긴 카드키 기록(결정적 증거)을 실제로 열었는가 (ADR 022 — 채점 축에서 보너스로 강등)
  line('결정적 증거 확보', r.breakdown.insight)
  line('합계', r.total, 'tot')
  sheet.appendChild(sc)
  sheet.appendChild(h('p', undefined, `최소 ${generated.validation.solve.minActions}번의 행동이면 풀 수 있었습니다.`))

  // 판 기록 — 다음 판이 이전 판에 대한 응답이 되게 한다
  const st = record(CASE.seed, r.total, r.correct.culprit)
  const isNewBest = r.total >= st.best && st.bestSeed === CASE.seed
  sheet.appendChild(h('div', isNewBest ? 'candline' : 'tally',
    isNewBest
      ? `최고 기록입니다 — ${st.best}점. 통산 ${st.plays}판 중 ${st.solved}건 해결.`
      : `통산 ${st.plays}판 중 ${st.solved}건 해결 · 최고 ${st.best}점` +
        (st.bestSeed !== null ? ` (사건번호 ${String(st.bestSeed).padStart(5, '0')})` : '')))

  /**
   * Retry 두 갈래 (ADR 022) — 같은 seed 재도전과 새 사건.
   * 오답 엔딩이 진범을 감추는 이유가 곧 [같은 사건 다시] 의 존재 이유다:
   * 재수사할 수 있어야 감춘 보람이 있다. 둘 다 URL 재로드로 푼다 —
   * 상태를 손으로 리셋하는 코드는 언젠가 하나를 빼먹는다.
   */
  const retry = h('button', undefined, '같은 사건 다시') as HTMLButtonElement
  retry.onclick = () => {
    // 고정 사건은 ?case=, 월드 사건은 ?world=&seed= 로 돌아온다 — 옷까지 같아야 같은 사건이다
    const target = IS_GC001 ? `${location.pathname}?case=gc001`
      : WORLD_ID && WORLD_PACKS[WORLD_ID] ? `${location.pathname}?world=${WORLD_ID}&seed=${CASE.seed}`
      : `${location.pathname}?seed=${CASE.seed}`
    // 같은 URL 이면 href 대입이 항상 재로드를 보장하지 않는다 — reload 로 못박는다
    if (location.pathname + location.search === target) location.reload()
    else location.href = target
  }
  sheet.appendChild(retry)

  const fresh = h('button', undefined, '새 게임') as HTMLButtonElement
  fresh.style.marginLeft = '8px'
  /**
   * 새 게임 = **다음 무대** (P1 로테이션). 호텔 → 경매장 → 방송국 → 극장 → 호텔.
   * 시드는 지운다 — 로드 시 검증된 풀에서 새로 뽑힌다 (ADR 012).
   * 다음 무대 이름을 버튼이 미리 말해주면 스포일러가 아니라 초대가 된다.
   */
  fresh.onclick = () => {
    const cur = IS_GC001 ? null : (WORLD_ID && WORLD_PACKS[WORLD_ID] ? WORLD_ID : null)
    const next = WORLD_ROTATION[(WORLD_ROTATION.indexOf(cur) + 1) % WORLD_ROTATION.length]!
    const target = next ? `${location.pathname}?world=${next}` : location.pathname
    if (location.pathname + location.search === target) location.reload()
    else location.href = target
  }
  sheet.appendChild(fresh)

  ov.appendChild(sheet)
  document.body.appendChild(ov)
}

/**
 * 사건 파일 서식 머리 — 브리핑·제출·결과가 **같은 서류철**로 읽히게 한다.
 * 사건번호는 시드다. 재현 가능한 게임이라는 사실이 세계관 안에서도 말이 된다.
 */
function fileHeader(stamp: string, cold = false): HTMLElement {
  const hd = h('div', 'filehd')
  hd.appendChild(h('div', 'kicker', `사건번호 ${CASE_NO} · 강력 3팀`))
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
    `어젯밤 ${SLOT_L(CRIME_SLOT)}, ${CASE.venue.name} ${CASE.venue.room}에서 ` +
    `${CASE.victim.title} ${josa(CASE.victim.name, '이/가')} 숨진 채 발견됐다. ` +
    // 장소 명사를 하드코딩하지 않는다 — 월드 사건(갤러리 등)에서도 같은 문장이 성립해야 한다
    `${CASE.venue.name}에는 다섯 사람이 남아 있었고, 그중 한 명이 범인이다.`))
  sheet.appendChild(h('p', undefined,
    '다섯 명 모두 "그 시간엔 다른 곳에 있었다"고 말한다. ' +
    '그러나 거짓말하는 사람이 곧 범인은 아니다 — 저마다 숨기고 싶은 사정이 따로 있다.'))

  sheet.appendChild(h('h2', undefined, '당신이 할 일'))
  const ol = h('ol', 'steps')
  for (const [t, d] of [
    ['현장을 조사한다 — 기록 조회 5회',
      `기록철에서 다섯 번만 조회할 수 있다. ${josa(AUTOPSY_NAME, '은/는')} ${josa(WEAPON_AXIS, '을/를')}, ` +
      `${SLOT_L(CRIME_SLOT)} 기록은 사람을 말한다 — 무엇을 포기할지 고르는 것이 곧 수사다.`],
    ['기록으로 후보를 지운다 — 이게 승리 경로다',
      `${SLOT_L(CRIME_SLOT)} 기록에 현장이 아닌 곳으로 찍힌 사람은 소거된다. ` +
      '표 위의 "남은 후보" 가 줄어드는 걸로 확인하라. 진술은 거짓일 수 있어 사람을 지우지 못한다.'],
    ['조사가 끝나면 심문이 열린다',
      `다섯 사람 각각과 대화 ${TALK_CAP}회까지 — 상한이지 의무가 아니다. 심문하면 그 사람의 나머지 시각이 표에 채워지고, ` +
      '관계를 캐물으면 저마다의 사정이 드러난다.'],
    ['기록과 진술을 맞춰 붉은 인장을 찍는다',
      '기록 한 장과 표의 칸 하나를 누르면 대조된다. 어긋나면 인장이 찍힌다. 대조는 무료이고, ' +
      '인장은 누구를 의심할지 정하는 근거다.'],
    ['(선택) 증거를 들이밀어 잠긴 기록을 연다',
      '흔들리면 자물쇠가 풀린다. 헛짚으면 그 사람과의 대화 1회만 잃는다. ' +
      '잠긴 현장 기록을 열면 통찰 보너스 +10 — 범인을 맞히는 데 필수는 아니다.'],
    ['범인·동기·도구를 지목한다',
      '누가(60점) · 왜(15점) · 무엇으로(15점). 세 가지가 모두 맞아야 사건이 완전히 닫힌다.'],
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
      `통산 ${st.plays}판 중 ${st.solved}건 해결 · 최고 ${st.best}점. 이번 판은 사건번호 ${CASE_NO} 입니다.`))
  }

  const go = h('button', undefined, '수사를 시작한다') as HTMLButtonElement
  go.style.marginTop = '10px'
  go.onclick = () => {
    wake()
    // 음성 엔진 예열 — 여기서 안 깨우면 첫 심문에서만 소리가 ~800ms 늦는다
    void initVoice()
    // 어떤 공급자가 실제로 살아 있는지 — 없는 걸 있는 것처럼 그리지 않기 위해
    void probeProviders().then(() => { if (ui.dash) render() })
    // 서버 음성을 쓸 수 있는지만 확인한다. 목소리·감정 배정은 배역표가 안다.
    void probeKey()
    fadeOut(ov)   // 브리핑 → 보드 전환은 페이드로 (P2-2) — 수첩 펼침 연출과 0.4초쯤 겹친다
    /**
     * **수첩이 펼쳐지며 수사가 시작된다.**
     *
     * 닫힌 상태를 기본으로 두고 눌러야 열게 하지는 않았다 — 이 게임의 상황판은
     * 항상 보여야 하는 물건이라(QA §5.4 가 지적한 바로 그것), 한 번 누르는 만큼
     * 정보가 멀어진다. 그래서 **첫 진입에 한 번만** 펼쳐지고 그 뒤로는 펼쳐진 채다.
     * 연출은 벌지 않고 은유만 완성한다.
     */
    /**
     * **물건을 먼저 보여주고 펼친다.** 3D 수첩이 한 박자 서고(1.1초),
     * 그 다음 DOM 수첩이 펼쳐진다. 에셋이 없거나 모션을 끈 사람에게는
     * `showJournal()` 이 즉시 resolve 하므로 예전과 똑같이 바로 펼쳐진다.
     */
    /**
     * **물건이 먼저 서고, 그 위에서 수첩이 펼쳐진다.**
     * `showJournal` 은 3D 가 걷히기 시작하는 순간 이 콜백을 부른다 — 끝난 뒤가 아니다.
     * 그래서 두 연출이 0.45초쯤 **겹치고**, 잘라 붙인 두 화면이 아니라 한 물건이 된다.
     * 에셋이 없거나 못 그리는 상황에서도 이 콜백은 반드시 한 번 불린다.
     */
    void showJournal(() => {
      ui.opening = true
      render()
      play('paper')
      setTimeout(() => { ui.opening = false; render() }, 1000)
    })
  }
  sheet.appendChild(go)

  ov.appendChild(sheet)
  document.body.appendChild(ov)
  queueMicrotask(() => go.focus())
}

/* ─────────── 다음 할 일 코치 ─────────── */
/**
 * 상태를 보고 "지금 뭘 하면 되는지" 한 줄로 알려준다. 규칙 설명이 아니라 **다음 행동** 이다.
 * ADR 022 이후 챕터가 둘이므로 코치도 둘로 갈린다 — 1장은 무엇을 조회할지, 2장은 누구를 캐물을지.
 */
function coachLine(): string {
  const g = ui.game
  const hasEvidence = g.cards.some((id) => CASE.evidence.some((e) => e.id === id))

  // ── 1장: 현장 조사 — 디에게틱 독백체 (P2-3). 명료성(숫자·다음 행동)은 유지한다.
  if (!fieldDone(g)) {
    if (!hasEvidence) {
      return `① 현장 조사 ${FIELD_BUDGET}회 — 기록철에서 다섯 번만 꺼내 볼 수 있다. 무엇을 포기할지가 수사다.`
    }
    const hasCrimeRecord = CASE.evidence.some((e) => g.cards.includes(e.id) && e.slot === CRIME_SLOT)
    if (!hasCrimeRecord && availableEvidence(g).some((e) => e.slot === CRIME_SLOT && e.kind !== 'autopsy')) {
      return `② 사람을 지우는 건 ${SLOT_L(CRIME_SLOT)} 기록뿐이다 — 남은 ${g.investigationsLeft}번 중 하나는 거기 쓴다.`
    }
    return `② 기록철을 ${g.investigationsLeft}번 더 열 수 있다 — 버리는 기록을 정하는 것도 수사다. 조사가 끝나면 취조실이 열린다.`
  }

  // ── 2장: 심문 ──
  const interviewed = SUSPECTS.some((s) => (ui.chats[s]?.length ?? 0) > 0)
  if (!interviewed) return '③ 취조실이 열렸다 — 대조표의 이름을 눌러 데려온다. 한 사람과 나눌 수 있는 말은 열 마디뿐이다.'
  if (g.foundContradictions.length === 0) return '③ 기록 한 장과 진술 한 칸을 맞대 본다 — 종이는 공짜고, 어긋나면 인장이 찍힌다.'
  const sceneLocked = lockedRecords(g).some((l) => l.evidence.decisive)
  if (sceneLocked) {
    return '④ 모순이 걸린 사람에게 그 종이를 들이민다 — 흔들리면 잠긴 기록의 자물쇠가 풀린다.'
  }
  return '④ 근거는 모였다 — [최종 추론]에서 누가, 왜, 무엇으로. 세 줄이면 사건이 닫힌다.'
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
  // 챕터 게이트에 막힌 순간의 안내 — 코치와 별개다. 코치는 다음 행동을, 이건 방금 막힌 이유를 말한다.
  if (ui.gateMsg) app.appendChild(h('div', 'gatenote', ui.gateMsg))
  if (ui.dash) app.appendChild(dashboard(() => render()))

  /**
   * **펼친 수첩 2단** (ADR 018). 3단 껍데기(25/45/30)를 교체한 것이지 추가한 게 아니다.
   *
   * 우면은 모드와 무관하게 고정이고, 좌면만 책상(격자)과 취조실(3D) 사이를 오간다.
   * 그래서 3D 호스트 폭이 두 모드에서 같아지고(둘 다 62%), 기록철이 탭 뒤로
   * 내려가지 않아 격자와 조회 목록이 오늘처럼 계속 동시에 보인다.
   * 사라지는 것은 용의자 열 하나뿐이고 그 폭은 격자로 간다 — 45% → 62%.
   */
  const nb = h('div', `nb${ui.opening ? ' opening' : ''}`)
  nb.appendChild(deskOrRoom())
  nb.appendChild(h('div', 'nb-spine'))
  nb.appendChild(rightPage())
  app.appendChild(nb)

  const cols2 = app.querySelectorAll('.col')
  scrolls.forEach((top, i) => { if (top) cols2[i]?.scrollTo({ top }) })

  if (keep) restoreFocus(keep)
}

// 파이프라인 단계가 바뀌면 칩만 갱신하면 되지만, 이 앱은 전체 재렌더 구조다.
// 심문 중에만 바뀌는 값이라 재렌더 비용(측정 0.8ms)이 문제되지 않는다.
onStage(() => { if (ui.active) render() })

/* ─────────── 시작 페이지 (ADR 022) ─────────── */
/**
 * 게임은 **자동으로 시작되지 않는다.** 로드 즉시 카툰이 돌던 구조를
 * 어두운 시작 화면 뒤로 옮겼다. 이유는 둘이다:
 * ① 브라우저 오디오 정책 — 사용자 제스처 없이는 소리가 죽는다. [사건 시작] 클릭이
 *    wake() 를 겸하므로 인트로부터 소리가 산다.
 * ② 심리적 문턱 — 추리 게임은 "시작하겠다" 는 선언과 함께 열려야 한다.
 *    URL 을 열자마자 사건이 쏟아지면 그건 게임이 아니라 탭이다.
 */
function showStartPage(): void {
  const ov = h('div', 'startpage')
  const box = h('div', 'startbox')
  box.appendChild(h('div', 'start-kicker', `사건번호 ${CASE_NO} · 강력 3팀`))
  box.appendChild(h('h1', 'start-title', 'FIVE ALIBIS'))
  box.appendChild(h('div', 'start-sub', '다섯 사람이 남아 있었고, 다섯 개의 알리바이가 있다. 하나는 거짓이다.'))
  const go = h('button', 'start-go', '사건 시작') as HTMLButtonElement
  go.onclick = () => {
    wake()          // 이 클릭이 오디오를 깨운다 — 인트로 카툰부터 소리가 살게
    ov.classList.add('leave')
    setTimeout(() => ov.remove(), 380)
    void playIntro(CASE).then(openBriefing)
  }
  box.appendChild(go)
  // 골든 케이스 001 진입 — 시드 사건이 아니라 작성된 사건(라음 사립 갤러리)의
  // 발단 카툰으로 연다. 본게임 데이터 연결 전까지는 발단만 gc001 이다.
  const onGc = new URLSearchParams(location.search).get('case') === 'gc001'
  const alt = h('button', 'start-alt',
    onGc ? '시드 사건으로 돌아가기' : '골든 케이스 001 — 옮겨진 상자의 사각') as HTMLButtonElement
  alt.onclick = () => {
    location.href = onGc ? location.pathname : `${location.pathname}?case=gc001`
  }
  box.appendChild(alt)
  ov.appendChild(box)
  document.body.appendChild(ov)
  queueMicrotask(() => go.focus())
}

render()
showStartPage()
