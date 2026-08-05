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
  availableEvidence, connect, createGame, interview, lookupEvidence,
  presentEvidence, submit, type GameState,
} from './engine/game'
import { cardSummary, renderCard } from './ui/cards'
import { josa } from './ui/josa'
import { personaById } from './data/personas'
import { ask } from './api'
import {
  CRIME_SLOT, PLACE_LABEL, SLOT_LABEL, SUSPECTS,
  type CaseFile, type Slot, type SuspectId,
} from './types'
import { METHODS } from './data/config'

const PRESETS = [
  '사건 시간에 어디 계셨습니까?',
  '피해자와 어떤 관계였습니까?',
  '그걸 증명해 줄 사람이 있습니까?',
  '왜 그 사실을 먼저 말하지 않았습니까?',
]

interface Chat { q: string; a: string; fallback: boolean; tell: string }

interface UI {
  game: GameState
  active: SuspectId | null
  chats: Record<string, Chat[]>
  selected: string[]
  busy: boolean
  flash: string | null
}

const app = document.querySelector<HTMLDivElement>('#app')!
const seed = Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Date.now() % 100000)

const generated = generateValidCase(seed)
const CASE: CaseFile = generated.case

const ui: UI = {
  game: createGame(CASE),
  active: null,
  chats: Object.fromEntries(SUSPECTS.map((s) => [s, [] as Chat[]])),
  selected: [],
  busy: false,
  flash: null,
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
  for (let i = 0; i < 6; i++) budget.appendChild(h('i', `pip${i < ui.game.investigationsLeft ? '' : ' spent'}`))
  bar.appendChild(budget)

  const btn = h('button', undefined, '범인 지목') as HTMLButtonElement
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
    const choose = (): void => { ui.active = s; render() }
    card.onclick = choose
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }

    const row = h('div', 'row')
    row.appendChild(h('div', 'face', '👤'))
    const info = h('div')
    info.appendChild(h('div', 'name', sus.name))
    info.appendChild(h('div', 'job', sus.job))
    row.appendChild(info)
    card.appendChild(row)
    card.appendChild(h('div', 'relation', sus.relation))
    card.appendChild(h('div', 'claim',
      `"${SLOT_LABEL[CRIME_SLOT]}엔 ${PLACE_LABEL[sus.claim[CRIME_SLOT]!]}에 있었습니다."`))

    const gauge = h('div', 'gauge')
    const fill = h('i')
    fill.style.width = `${ui.game.pressure[s]}%`
    gauge.appendChild(fill)
    card.appendChild(gauge)
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
    box.appendChild(h('div', 'empty',
      '왼쪽에서 용의자를 선택해 심문을 시작하십시오. 조사는 6회뿐이고, 카드 연결과 모순 확인은 무료입니다.'))
    col.appendChild(box)
    return col
  }

  const s = ui.active
  const sus = CASE.suspects[s]
  const persona = personaById(sus.personaId)
  const tense = ui.game.pressure[s] >= 60

  const p = h('div', 'portrait')
  p.appendChild(h('div', `big${tense ? ' tense' : ''}`, tense ? '😰' : '🙂'))
  const meta = h('div')
  meta.appendChild(h('div', 'name', `${sus.name} · ${sus.job}`))
  meta.appendChild(h('div', 'hint', `읽힌 성향: ${persona.label} — ${persona.hint}`))
  p.appendChild(meta)
  box.appendChild(p)

  const log = h('div', 'log')
  for (const c of ui.chats[s]!) {
    log.appendChild(h('div', 'bubble q', c.q))
    const a = h('div', `bubble a${c.fallback ? ' fallback' : ''}`)
    a.appendChild(h('div', undefined, c.a))
    if (c.tell !== 'none') a.appendChild(h('div', 'tell', tellLabel(c.tell)))
    log.appendChild(a)
  }
  if (ui.busy) log.appendChild(h('div', 'bubble a', '…'))
  box.appendChild(log)
  box.appendChild(askBox(s))
  col.appendChild(box)
  queueMicrotask(() => { log.scrollTop = log.scrollHeight })
  return col
}

function askBox(s: SuspectId): HTMLElement {
  const wrap = h('div', 'ask')
  const chips = h('div', 'chips')
  const input = h('input') as HTMLInputElement
  input.placeholder = '직접 질문을 입력하십시오'
  input.maxLength = 200

  for (const q of PRESETS) {
    const c = h('button', 'chip', q) as HTMLButtonElement
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
  for (const e of avail) {
    // 기록실 색인처럼 **무엇을 여는지**는 보여주고 **누가 찍혔는지**는 감춘다.
    // 라벨이 전부 "영수증 조회" 로 같으면 플레이어는 찍기밖에 못 하고,
    // 그 순간 "무엇을 먼저 볼 것인가" 라는 이 게임의 전략이 사라진다.
    const label = `${labelOfKind(e.kind)} · ${SLOT_LABEL[e.slot]} ${PLACE_LABEL[e.place]}`
    const b = h('button', undefined, `${label} (조사 1회)`) as HTMLButtonElement
    b.disabled = ui.game.investigationsLeft <= 0 || ui.busy
    b.onclick = () => act(() => lookupEvidence(ui.game, e.id))
    lookup.appendChild(b)
  }
  col.appendChild(lookup)

  col.appendChild(h('h2', undefined, `발견한 모순 (${ui.game.foundContradictions.length})`))
  if (ui.game.foundContradictions.length === 0) {
    col.appendChild(h('div', 'hintline', '카드 두 장을 눌러 연결하십시오. 연결은 조사를 소모하지 않습니다.'))
  }
  for (const key of ui.game.foundContradictions) {
    const parts = key.split('|')
    const sid = parts[1] as SuspectId
    const slot = Number(parts[2]) as Slot
    col.appendChild(h('div', 'contradiction',
      `${CASE.suspects[sid].name}의 ${SLOT_LABEL[slot]} 진술이 ${parts[0]} 기록과 어긋난다.`))
  }

  col.appendChild(h('h2', undefined, `보유 카드 (${ui.game.cards.length})`))
  for (const id of ui.game.cards) {
    const card = renderCard(CASE, id)
    if (ui.selected.includes(id)) card.classList.add('sel')
    if (ui.flash === id) card.classList.add('flash')
    card.setAttribute('role', 'button')
    card.tabIndex = 0
    card.setAttribute('aria-pressed', String(ui.selected.includes(id)))
    card.setAttribute('aria-label', `${cardSummary(CASE, id)} — 연결하려면 선택`)
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
openBriefing()
  }
  ui.selected = [...ui.selected, id]
  if (ui.selected.length === 2) {
    const a = ui.selected[0]!
    const b = ui.selected[1]!
    const r = connect(ui.game, a, b)
    ui.game = r.state
    ui.flash = r.contradiction ? b : null
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

  ui.chats[s] = [...ui.chats[s]!, { q, a: r.reply.speech, fallback: r.fallback, tell: r.reply.tell }]
  ui.busy = false
  render()
  animateLast(r.reply.speech)
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

  ui.chats[s] = [...ui.chats[s]!, {
    q: `[증거 제시] ${cardSummary(CASE, evId)}`, a: r.reply.speech, fallback: r.fallback, tell: r.reply.tell,
  }]
  ui.busy = false
  ui.selected = []
  render()
  animateLast(r.reply.speech)
}

function animateLast(text: string): void {
  const bubbles = document.querySelectorAll('.bubble.a')
  const node = bubbles[bubbles.length - 1]?.firstElementChild
  if (node instanceof HTMLElement) typeInto(node, text)
}

/* ─────────── 제출 · 결과 ─────────── */
function openSubmit(): void {
  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet')
  sheet.appendChild(h('h2', undefined, '범인 지목'))
  sheet.appendChild(h('p', undefined, '범인만 맞혀도 부분 점수가 있습니다. 수단과 결정적 증거까지 맞히면 만점입니다.'))

  const opt = (v: string, t: string): HTMLOptionElement => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; return o
  }
  const who = h('select') as HTMLSelectElement
  for (const s of SUSPECTS) who.appendChild(opt(s, `${CASE.suspects[s].name} (${CASE.suspects[s].job})`))

  const method = h('select') as HTMLSelectElement
  for (const m of METHODS) method.appendChild(opt(m, m))

  const dec = h('select') as HTMLSelectElement
  const owned = ui.game.cards.filter((x) => CASE.evidence.some((e) => e.id === x))
  if (owned.length === 0) dec.appendChild(opt('', '(확보한 물증이 없다)'))
  for (const id of owned) dec.appendChild(opt(id, cardSummary(CASE, id)))

  sheet.appendChild(h('label', undefined, '범인')); sheet.appendChild(who)
  sheet.appendChild(h('label', undefined, '범행 수단')); sheet.appendChild(method)
  sheet.appendChild(h('label', undefined, '결정적 증거')); sheet.appendChild(dec)

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

  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet')
  sheet.appendChild(h('div', `verdict ${r.correct.culprit ? 'ok' : 'no'}`,
    r.correct.culprit ? '범인을 맞혔습니다.' : '범인이 아닙니다.'))
  sheet.appendChild(h('p', undefined,
    `진범은 ${CASE.suspects[CASE.culprit].name}(${CASE.suspects[CASE.culprit].job}). 동기는 ${CASE.motive}, 수단은 ${CASE.method}.`))

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

  const sc = h('div', 'score')
  const line = (label: string, v: number, cls?: string): void => {
    sc.appendChild(h('div', cls, label)); sc.appendChild(h('div', cls, String(v)))
  }
  line('범인', r.breakdown.culprit)
  line('범행 수단', r.breakdown.method)
  line('결정적 증거', r.breakdown.decisive)
  line(`남은 조사 ${ui.game.investigationsLeft}회`, r.breakdown.efficiency)
  line(`발견한 모순 ${ui.game.foundContradictions.length}건`, r.breakdown.insight)
  line('합계', r.total, 'tot')
  sheet.appendChild(sc)
  sheet.appendChild(h('p', undefined, `최소 ${generated.validation.solve.minActions}회면 풀 수 있었습니다.`))

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

/* ─────────── 오프닝 브리핑 (기획서 §5.1) ─────────── */
/**
 * 플레이 테스트 지적: "어디부터 해야 되는지, 뭘 조사해야 되는지 모르겠다."
 * 규칙을 툴팁으로 흩뿌리는 대신 **시작 전에 한 번** 사건과 목표를 세워준다.
 */
function openBriefing(): void {
  const ov = h('div', 'overlay')
  const sheet = h('div', 'sheet')

  sheet.appendChild(h('div', 'kicker', '사건 브리핑'))
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
    ['다섯 명의 진술을 읽는다', '왼쪽 카드에 각자의 22:20 주장이 적혀 있다. 무료다.'],
    ['심문하거나 기록을 조회한다', '조사는 총 6회뿐. 이게 이 게임의 유일한 자원이다.'],
    ['카드를 연결해 모순을 찾는다', '기록과 진술이 어긋나는 지점 — 연결은 몇 번을 해도 무료다.'],
    ['모순을 들이민다', '증거를 당사자에게 제시하면 새로운 진술이 열린다.'],
    ['범인·수단·결정적 증거를 지목한다', '범인만 맞혀도 점수는 있다. 남은 조사도 점수가 된다.'],
  ] as [string, string][]) {
    const li = h('li')
    li.appendChild(h('b', undefined, t))
    li.appendChild(h('span', undefined, d))
    ol.appendChild(li)
  }
  sheet.appendChild(ol)

  const go = h('button', undefined, '수사를 시작한다') as HTMLButtonElement
  go.style.marginTop = '10px'
  go.onclick = () => { ov.remove(); render() }
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
  if (g.investigationsLeft <= 2) return `④ 남은 조사 ${g.investigationsLeft}회. 슬슬 결론을 낼 때입니다.`
  return '④ 모순이 나온 인물에게 그 증거를 제시하면 새 진술이 열립니다.'
}

/* ─────────── 렌더 ─────────── */
function render(): void {
  app.replaceChildren()
  app.appendChild(topbar())
  app.appendChild(h('div', 'coach', coachLine()))
  const cols = h('div', 'cols')
  cols.appendChild(suspectColumn())
  cols.appendChild(stage())
  cols.appendChild(board())
  app.appendChild(cols)
}

render()
openBriefing()
