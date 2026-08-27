/** V0.2 수사일지 — 관찰을 기록하고, 플레이어가 직접 가설과 연결을 편집한다. */
import '../styles/inquiry.css'
import type {
  ClaimState, EvidenceState, Hypothesis, HypothesisStatus, InquiryState,
} from '../engine/inquiry'
import type { SuspectId } from '../types'

export type InquiryTab = 'overview' | 'evidence' | 'testimony' | 'timeline' | 'deduction'

export interface InquiryClaimRow {
  id: string; speaker: SuspectId; speakerName: string; text: string; at?: string
  state: ClaimState; revisedById?: string
}
export interface InquiryFactRow { id: string; text: string; source: string }
export interface InquiryEvidenceRow { id: string; label: string; state: EvidenceState }
export interface InquiryClueRow {
  id: string; kind: 'CLAIM' | 'FACT' | 'EVIDENCE'; label: string; detail?: string
}
/**
 * 탭별 알림 배지 — 3.2.13 「새로운 정보가 들어온 탭에는 NEW, 숫자, 알림 표시」.
 * `newCount` 는 「마지막으로 그 탭을 본 뒤에 늘어난 항목 수」로 파생된다.
 * 0 이면 알림이 없다.
 */
export type TabBadges = Partial<Record<InquiryTab, number>>

export interface InquiryView {
  claims: InquiryClaimRow[]
  facts: InquiryFactRow[]
  evidence: InquiryEvidenceRow[]
  clues: InquiryClueRow[]
  shaky: string[]
  suspect: SuspectId | null
  people: { id: SuspectId; name: string }[]
  memo: string
  hypotheses: Hypothesis[]
  links: [string, string][]
  activeTab: InquiryTab
  /** 탭별 새 항목 수 (0 이면 생략 가능) */
  tabBadges: TabBadges
}
export interface InquiryHandlers {
  changeTab(tab: InquiryTab): void
  pickSuspect(id: SuspectId | null): void
  setMemo(text: string): void
  saveHypothesis(h: Hypothesis): void
  removeHypothesis(id: string): void
  addLink(a: string, b: string): void
  removeLink(a: string, b: string): void
  openProof(): void
}

export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  KNOWN: '들었다', QUESTIONABLE: '확인이 필요하다', CHALLENGED: '추궁했다',
  REVISED: '고쳐 말했다', CONFIRMED: '기록과 맞는다', DISPROVED: '기록과 어긋난다',
}
const EV_STATE_LABEL: Record<EvidenceState, string> = {
  AVAILABLE: '아직 못 봤다', DISCOVERED: '확보', UNDERSTOOD: '의미 확인',
}
const HYPOTHESIS_LABEL: Record<HypothesisStatus, string> = {
  DRAFT: '초안', SUPPORTED: '지지됨', CONTESTED: '반론 있음', DISPROVED: '기각', PROVEN: '입증',
}
/**
 * 탭 순서·라벨 — 정본 3.2.4·3.2.13 에 맞춘다.
 * 「사건 개요 · 용의자 증언 · 증거 · 타임라인 · 추론」
 * id 는 상태·테스트·외부 참조가 쓰므로 바꾸지 않는다. 바뀌는 것은 보이는 순서와 라벨.
 */
export const TABS: { id: InquiryTab; no: string; label: string }[] = [
  { id: 'overview', no: '01', label: '사건 개요' },
  { id: 'testimony', no: '02', label: '용의자 증언' },
  { id: 'evidence', no: '03', label: '증거' },
  { id: 'timeline', no: '04', label: '타임라인' },
  { id: 'deduction', no: '05', label: '추론' },
]

/**
 * 각 탭의 현재 항목 수를 InquiryState 에서 파생한다.
 * 새 상태를 만들지 않는다 — 이미 있는 것만 센다.
 */
export function tabItemCounts(s: InquiryState): Record<InquiryTab, number> {
  const discoveredEvidence = Object.values(s.evidence).filter((st) => st !== 'AVAILABLE').length
  return {
    overview: s.facts.length,
    testimony: Object.keys(s.claims).length,
    evidence: discoveredEvidence,
    timeline: Object.keys(s.claims).length, // 타임라인은 진술에서 시각이 있는 것만이지만, 목록 길이로 갱신 판단
    deduction: s.hypotheses.length,
  }
}

/**
 * 탭 배지를 계산한다 — 「마지막으로 그 탭을 본 뒤에 늘어났는가」.
 * @param current - tabItemCounts() 결과
 * @param seen - UI 가 기억하는 「마지막으로 그 탭을 봤을 때의 항목 수」
 */
export function computeTabBadges(
  current: Record<InquiryTab, number>,
  seen: Record<InquiryTab, number>,
): TabBadges {
  const badges: TabBadges = {}
  for (const tab of TABS) {
    const diff = (current[tab.id] ?? 0) - (seen[tab.id] ?? 0)
    if (diff > 0) badges[tab.id] = diff
  }
  return badges
}

export interface InquirySource {
  claim(id: string): { speaker: SuspectId; text: string; at?: string; revisedTo?: string } | undefined
  fact(id: string): { text: string; source: string } | undefined
  suspectName(id: SuspectId): string
  evidenceLabel(id: string): string
  people: { id: SuspectId; name: string }[]
}

export function inquiryView(
  s: InquiryState, src: InquirySource, shaky: string[],
  activeTab: InquiryTab = 'overview', tabBadges: TabBadges = {},
): InquiryView {
  const claims: InquiryClaimRow[] = []
  for (const [id, track] of Object.entries(s.claims)) {
    const def = src.claim(id); if (!def) continue
    claims.push({ id, speaker: def.speaker, speakerName: src.suspectName(def.speaker), text: def.text,
      ...(def.at ? { at: def.at } : {}), state: track.state,
      ...(def.revisedTo && s.claims[def.revisedTo] ? { revisedById: def.revisedTo } : {}) })
  }
  const order = new Map(src.people.map((p, i) => [p.id, i]))
  claims.sort((a, b) => (order.get(a.speaker) ?? 9) - (order.get(b.speaker) ?? 9)
    || (a.at ?? '').localeCompare(b.at ?? ''))
  const facts = s.facts.map((id) => { const f = src.fact(id); return f ? { id, ...f } : null })
    .filter((x): x is InquiryFactRow => x !== null)
  const evidence = Object.entries(s.evidence).filter(([, st]) => st !== 'AVAILABLE')
    .map(([id, state]) => ({ id, label: src.evidenceLabel(id), state }))
  const clues: InquiryClueRow[] = [
    ...claims.map((c) => ({ id: c.id, kind: 'CLAIM' as const,
      label: `${c.speakerName}${c.at ? ` · ${c.at}` : ''} — "${c.text}"`, detail: CLAIM_STATE_LABEL[c.state] })),
    ...facts.map((f) => ({ id: f.id, kind: 'FACT' as const, label: f.text, detail: `출처 · ${f.source}` })),
    ...evidence.map((e) => ({ id: e.id, kind: 'EVIDENCE' as const, label: e.label, detail: EV_STATE_LABEL[e.state] })),
  ]
  return { claims, facts, evidence, clues, shaky, suspect: s.suspect, people: src.people,
    memo: s.memo, hypotheses: s.hypotheses, links: s.links, activeTab, tabBadges }
}

/* ────────────────────────────────────────────────────────────────────── */

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag); if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}
const cap = (title: string, tally?: string): HTMLElement => {
  const n = el('div', 'iq-cap', title); if (tally) n.appendChild(el('span', 'iq-cap-s', tally)); return n
}

/* ── 진술 ── */
function claimRow(r: InquiryClaimRow, isRevision: boolean): HTMLElement {
  const box = el('div', `iq-claim s-${r.state.toLowerCase()}${isRevision ? ' rev' : ''}`)
  const head = el('div', 'iq-claim-h')
  head.append(el('span', 'iq-who', isRevision ? '고친 말' : r.speakerName))
  if (r.at) head.append(el('span', 'iq-at', r.at))
  head.append(el('span', 'iq-state', CLAIM_STATE_LABEL[r.state]))
  box.append(head, el('div', 'iq-quote', `"${r.text}"`)); return box
}
function claimsSection(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('들은 말', `${v.claims.length}건`))
  if (!v.claims.length) sec.appendChild(el('div', 'iq-empty', '아직 아무 말도 듣지 못했다.'))
  const shown = new Set<string>()
  for (const r of v.claims) {
    if (shown.has(r.id)) continue; shown.add(r.id); sec.appendChild(claimRow(r, false))
    if (r.revisedById) { const rev = v.claims.find((x) => x.id === r.revisedById)
      if (rev) { shown.add(rev.id); sec.appendChild(claimRow(rev, true)) } }
  }
  return sec
}

/* ── 사실 ── */
function factsSection(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('확인된 사실', `${v.facts.length}건`))
  if (!v.facts.length) sec.appendChild(el('div', 'iq-empty', '기록을 조회하거나 물어야 한다.'))
  for (const f of v.facts) { const row = el('div', 'iq-fact'); row.append(el('div', 'iq-fact-t', f.text), el('div', 'iq-fact-s', `출처 · ${f.source}`)); sec.appendChild(row) }
  return sec
}

/* ── 기록 ── */
function evidenceSection(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('확보한 기록', `${v.evidence.length}건`))
  if (!v.evidence.length) sec.appendChild(el('div', 'iq-empty', '아직 확보한 기록이 없다.'))
  for (const e of v.evidence) { const row = el('div', 'iq-ev'); row.append(el('span', 'iq-ev-t', e.label), el('span', 'iq-ev-s', EV_STATE_LABEL[e.state])); sec.appendChild(row) }
  return sec
}

/* ── 의심 인물 ── */
function suspectSection(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const sec = el('section', 'iq-sec iq-suspect'); sec.appendChild(cap('지금 가장 의심되는 사람', '정답 제출이 아니다'))
  const list = el('div', 'iq-people')
  for (const p of v.people) {
    const active = v.suspect === p.id
    const b = el('button', `iq-person${active ? ' on' : ''}`) as HTMLButtonElement
    b.type = 'button'; b.setAttribute('aria-pressed', String(active))
    b.append(el('span', 'iq-radio', active ? '●' : '○'), el('span', undefined, p.name))
    b.onclick = () => on.pickSuspect(active ? null : p.id)
    list.appendChild(b)
  }
  sec.appendChild(list); return sec
}

/* ── 메모 ── */
function memoSection(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const sec = el('section', 'iq-sec'); sec.appendChild(cap('메모'))
  const ta = el('textarea', 'iq-memo') as HTMLTextAreaElement; ta.value = v.memo; ta.rows = 4
  ta.placeholder = '떠오른 것을 적어 둔다 — 시스템은 이것을 읽지 않는다.'
  ta.setAttribute('aria-label', '수사 메모')
  ta.onchange = ta.onblur = () => on.setMemo(ta.value); sec.appendChild(ta); return sec
}

/* ── 단서 선택 ── */
function clueSelect(v: InquiryView, placeholder: string, used: string[], add: (id: string) => void): HTMLSelectElement {
  const s = el('select', 'iq-clue-select') as HTMLSelectElement
  const first = document.createElement('option'); first.value = ''; first.textContent = placeholder; s.appendChild(first)
  for (const c of v.clues.filter((x) => !used.includes(x.id))) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; s.appendChild(o) }
  s.onchange = () => { if (s.value) add(s.value) }; return s
}
function clueTags(v: InquiryView, ids: string[], remove: (id: string) => void): HTMLElement {
  const box = el('div', 'iq-hyp-tags')
  for (const id of ids) { const c = v.clues.find((x) => x.id === id); const b = el('button', 'iq-hyp-tag', `${c?.label ?? id}  ×`) as HTMLButtonElement; b.type = 'button'; b.onclick = () => remove(id); box.appendChild(b) }
  return box
}

/* ── 가설 카드 ── */
function hypothesisCard(v: InquiryView, h: Hypothesis, on: InquiryHandlers): HTMLElement {
  const card = el('article', 'iq-hyp')
  const top = el('div', 'iq-hyp-top'); top.appendChild(el('span', 'iq-hyp-id', h.id))
  const status = el('select', 'iq-hyp-status') as HTMLSelectElement
  for (const st of Object.keys(HYPOTHESIS_LABEL) as HypothesisStatus[]) { const o = document.createElement('option'); o.value = st; o.textContent = HYPOTHESIS_LABEL[st]; o.selected = h.status === st; status.appendChild(o) }
  status.setAttribute('aria-label', '가설 상태'); status.onchange = () => on.saveHypothesis({ ...h, status: status.value as HypothesisStatus }); top.appendChild(status)
  const del = el('button', 'iq-hyp-del', '삭제') as HTMLButtonElement; del.type = 'button'; del.onclick = () => on.removeHypothesis(h.id); top.appendChild(del); card.appendChild(top)
  const ta = el('textarea', 'iq-hyp-text') as HTMLTextAreaElement; ta.value = h.proposition; ta.rows = 2; ta.setAttribute('aria-label', '가설 내용'); ta.onchange = () => on.saveHypothesis({ ...h, proposition: ta.value }); card.appendChild(ta)
  const who = el('select', 'iq-hyp-who') as HTMLSelectElement; const none = document.createElement('option'); none.value = ''; none.textContent = '관련 인물 없음'; who.appendChild(none)
  for (const p of v.people) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; o.selected = h.subjectId === p.id; who.appendChild(o) }
  who.onchange = () => { const id = who.value as SuspectId; const next = { ...h }; if (id) next.subjectId = id; else delete next.subjectId; on.saveHypothesis(next) }; card.appendChild(who)
  const roles: ['supportClueIds' | 'counterClueIds', string, string][] = [
    ['supportClueIds', '지지 근거', '+ 지지 근거'], ['counterClueIds', '반대 근거', '+ 반대 근거'],
  ]
  for (const [key, label, placeholder] of roles) { const box = el('div', `iq-hyp-role ${key === 'supportClueIds' ? 'support' : 'counter'}`); box.appendChild(el('div', 'iq-hyp-role-k', label)); box.appendChild(clueTags(v, h[key], (id) => on.saveHypothesis({ ...h, [key]: h[key].filter((x) => x !== id) })))
    box.appendChild(clueSelect(v, placeholder, [...h.supportClueIds, ...h.counterClueIds], (id) => on.saveHypothesis({ ...h, [key]: [...h[key], id] }))); card.appendChild(box) }
  return card
}

/* ── 추론 탭 ── */
function deduction(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const wrap = el('div', 'iq-deduction')
  const hs = el('section', 'iq-sec'); const hd = cap('내 가설', `${v.hypotheses.length}개`)
  const add = el('button', 'iq-add', '+ 가설 세우기') as HTMLButtonElement; add.type = 'button'; add.onclick = () => { let n = 1; while (v.hypotheses.some((h) => h.id === `H-${n}`)) n += 1; on.saveHypothesis({ id: `H-${n}`, proposition: '새 가설', supportClueIds: [], counterClueIds: [], proofPropositionIds: [], status: 'DRAFT' }) }; hd.appendChild(add); hs.appendChild(hd)
  if (!v.hypotheses.length) hs.appendChild(el('div', 'iq-empty', '가설을 세우고 지지 근거와 반대 근거를 직접 붙인다.'))
  for (const h of v.hypotheses) hs.appendChild(hypothesisCard(v, h, on)); wrap.appendChild(hs)
  const ls = el('section', 'iq-sec iq-links'); ls.appendChild(cap('단서 연결', `${v.links.length}개`))
  const row = el('div', 'iq-link-new'); let a = ''; let b = ''
  const aSel = clueSelect(v, '첫 단서', [], (id) => { a = id }); const bSel = clueSelect(v, '둘째 단서', [], (id) => { b = id })
  const linkBtn = el('button', 'iq-link-add', '연결') as HTMLButtonElement; linkBtn.type = 'button'; linkBtn.onclick = () => { a = a || aSel.value; b = b || bSel.value; if (a && b && a !== b) on.addLink(a, b) }; row.append(aSel, el('span', 'iq-link-arrow', '↔'), bSel, linkBtn); ls.appendChild(row)
  for (const [aId, bId] of v.links) { const r = el('div', 'iq-link'); r.append(el('span', undefined, v.clues.find((c) => c.id === aId)?.label ?? aId), el('span', 'iq-link-arrow', '↔'), el('span', undefined, v.clues.find((c) => c.id === bId)?.label ?? bId)); const x = el('button', undefined, '끊기') as HTMLButtonElement; x.type = 'button'; x.onclick = () => on.removeLink(aId, bId); r.appendChild(x); ls.appendChild(r) }
  wrap.appendChild(ls)
  const proof = el('button', 'iq-proof', '이 연결로 최종 논증을 짠다') as HTMLButtonElement; proof.type = 'button'; proof.onclick = () => on.openProof(); wrap.appendChild(proof)
  return wrap
}

/* ── 사건 타임라인 시각 바 ── */
function timelineBar(v: InquiryView): HTMLElement {
  const bar = el('div', 'iq-timeline-bar')
  bar.appendChild(el('div', 'iq-timeline-bar-title', '사건 타임라인'))
  const track = el('div', 'iq-timeline-track')
  // Collect unique times from claims
  const times = [...new Set(v.claims.filter((c) => c.at).map((c) => c.at!))]
    .sort((a, b) => a.localeCompare(b))
  if (times.length >= 2) {
    const min = times[0]!
    const max = times[times.length - 1]!
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0) }
    const range = toMin(max) - toMin(min) || 1
    for (const t of times) {
      const pct = ((toMin(t) - toMin(min)) / range) * 100
      const dot = el('div', 'iq-tl-dot')
      dot.style.left = `${pct}%`
      // Mark "21:16" as crime time (if present)
      if (t === '21:16') { dot.classList.add('crime') }
      track.appendChild(dot)
      const lbl = el('div', 'iq-tl-label', t)
      lbl.style.left = `${pct}%`
      if (t === '21:16') { lbl.classList.add('crime') }
      track.appendChild(lbl)
    }
  }
  bar.appendChild(track)
  return bar
}

/* ── 사건 개요: 핵심 사실 체크리스트 + 폴라로이드 자리 (시안 (가)+(나)) ── */
function overviewFactsCard(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec iq-overview-facts')

  // 폴라로이드 사진 자리 — 이미지 에셋은 만들지 않는다, placeholder 틀만 CSS 로 구성
  // InquiryView.facts 에 사진 URL 이 없으므로 자리만 남긴다
  const photo = el('figure', 'iq-photo-card')
  const placeholder = el('div', 'iq-photo-placeholder')
  placeholder.setAttribute('aria-hidden', 'true')
  photo.appendChild(placeholder)
  photo.appendChild(el('figcaption', undefined, '현장 사진'))
  sec.appendChild(photo)

  sec.appendChild(cap('핵심 사실', `${v.facts.length}건`))

  if (!v.facts.length) {
    sec.appendChild(el('div', 'iq-empty', '아직 확인된 사실이 없다.'))
  } else {
    const list = el('ul', 'iq-checklist')
    const MAX_VISIBLE = 4
    const visible = v.facts.slice(0, MAX_VISIBLE)
    for (const f of visible) {
      const li = document.createElement('li')
      li.textContent = f.text
      // 출처도 함께 표시 (시안: 체크문 아래에 작은 출처 한 줄)
      const src = el('span', 'iq-fact-s', `출처 · ${f.source}`)
      li.appendChild(src)
      list.appendChild(li)
    }
    sec.appendChild(list)
    if (v.facts.length > MAX_VISIBLE) {
      const more = el('button', 'iq-more', '더 보기') as HTMLButtonElement
      more.type = 'button'
      more.setAttribute('aria-label', `핵심 사실 ${v.facts.length - MAX_VISIBLE}건 더 보기`)
      more.onclick = () => {
        // 나머지 사실을 펼친다
        for (const f of v.facts.slice(MAX_VISIBLE)) {
          const li = document.createElement('li')
          li.textContent = f.text
          const src = el('span', 'iq-fact-s', `출처 · ${f.source}`)
          li.appendChild(src)
          list.appendChild(li)
        }
        more.remove()
      }
      sec.appendChild(more)
    }
  }

  // 확인이 필요한 진술 (shaky) — 시안에서 핵심 사실 아래에 배치
  if (v.shaky.length) {
    const shakyWrap = el('div', 'iq-sec iq-next')
    shakyWrap.appendChild(cap('확인이 필요한 진술', `${v.shaky.length}건`))
    const ul = el('ul', 'iq-shaky')
    for (const id of v.shaky) {
      const c = v.claims.find((x) => x.id === id)
      if (c) ul.appendChild(el('li', undefined, `${c.speakerName}${c.at ? ` · ${c.at}` : ''} — "${c.text}"`))
    }
    shakyWrap.appendChild(ul)
    sec.appendChild(shakyWrap)
  }

  return sec
}

/* ── 관련 증거/증언 목록 (시안 (마)) ── */
function relatedEvidenceSection(v: InquiryView): HTMLElement {
  const sec = el('section', 'iq-sec iq-related')
  const total = v.evidence.length + v.claims.length
  sec.appendChild(cap('관련 증거 / 증언', `${total}건`))

  const list = el('div', 'iq-related-list')
  const MAX_VISIBLE = 4

  // Evidence items
  const items: { icon: string; text: string; kind: string }[] = []
  for (const e of v.evidence) {
    items.push({ icon: '📋', text: e.label, kind: '기록' })
  }
  // Claim items (confirmed/disproved only — significant ones)
  for (const c of v.claims.filter((x) => x.state === 'CONFIRMED' || x.state === 'DISPROVED' || x.state === 'REVISED')) {
    items.push({ icon: '💬', text: `${c.speakerName} — ${c.at ?? ''} 진술`, kind: '증언' })
  }

  const visible = items.slice(0, MAX_VISIBLE)
  for (const item of visible) {
    const row = el('div', 'iq-ev')
    const kindChip = el('span', 'iq-ev-kind', item.kind)
    row.append(kindChip, el('span', 'iq-ev-t', item.text))
    list.appendChild(row)
  }

  sec.appendChild(list)

  if (items.length > MAX_VISIBLE) {
    const more = el('button', 'iq-more', '모두 보기') as HTMLButtonElement
    more.type = 'button'
    more.setAttribute('aria-label', `관련 증거/증언 ${items.length - MAX_VISIBLE}건 더 보기`)
    more.onclick = () => {
      for (const item of items.slice(MAX_VISIBLE)) {
        const row = el('div', 'iq-ev')
        const kindChip = el('span', 'iq-ev-kind', item.kind)
        row.append(kindChip, el('span', 'iq-ev-t', item.text))
        list.appendChild(row)
      }
      more.remove()
    }
    sec.appendChild(more)
  }

  if (!items.length) {
    sec.appendChild(el('div', 'iq-empty', '아직 확보한 증거나 증언이 없다.'))
  }

  return sec
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 메인 렌더
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export function renderInquiry(v: InquiryView, on: InquiryHandlers): HTMLElement {
  const root = el('div', 'iq iq-notebook')

  /* ── 상단 5탭 ── */
  const nav = el('div', 'iq-tabs'); nav.setAttribute('role', 'tablist')
  for (const t of TABS) {
    const active = v.activeTab === t.id
    const badge = v.tabBadges[t.id] ?? 0
    const b = el('button', `iq-tab${active ? ' on' : ''}${badge > 0 ? ' has-new' : ''}`) as HTMLButtonElement
    b.type = 'button'; b.dataset.tab = t.id
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(active))
    if (badge > 0) {
      b.dataset.badge = String(badge)
      b.setAttribute('aria-label', `${t.label} — 새 항목 ${badge}건`)
    }
    b.append(el('span', 'iq-tab-no', t.no), el('span', 'iq-tab-label', t.label))
    if (badge > 0) {
      const dot = el('span', 'iq-tab-badge', String(badge))
      dot.setAttribute('aria-hidden', 'true')
      b.appendChild(dot)
    }
    b.onclick = () => on.changeTab(t.id)
    nav.appendChild(b)
  }
  root.appendChild(nav)

  /* ── 탭 페이지 ── */
  const page = el('div', `iq-page tab-${v.activeTab}`); page.setAttribute('role', 'tabpanel')

  if (v.activeTab === 'overview') {
    // ─── 사건 개요 탭 (시안 순서): 사진카드 + 핵심 사실 + 의심 인물 + 메모 + 관련 증거/증언 + 타임라인 ───

    // (가) 핵심 사실 체크리스트 + 우상단 폴라로이드 자리
    const factsCard = overviewFactsCard(v)
    page.appendChild(factsCard)

    // (나) 의심 인물 칩
    page.appendChild(suspectSection(v, on))

    // (다) 메모
    page.appendChild(memoSection(v, on))

    // (라) 관련 증거/증언 목록
    if (v.evidence.length || v.claims.length) {
      page.appendChild(relatedEvidenceSection(v))
    }

    // (마) 사건 타임라인 바 (하단)
    if (v.claims.some((c) => c.at)) page.appendChild(timelineBar(v))
  } else if (v.activeTab === 'evidence') {
    page.append(evidenceSection(v), factsSection(v))
  } else if (v.activeTab === 'testimony') {
    page.appendChild(claimsSection(v))
  } else if (v.activeTab === 'timeline') {
    const sec = el('section', 'iq-sec iq-timeline')
    sec.appendChild(cap('사건 타임라인', `${v.claims.filter((c) => c.at).length}개 시각`))
    for (const c of [...v.claims].filter((x) => x.at).sort((a, b) => a.at!.localeCompare(b.at!))) {
      const r = el('div', 'iq-time')
      r.append(el('time', undefined, c.at), el('span', 'iq-time-who', c.speakerName), el('span', 'iq-time-text', c.text))
      sec.appendChild(r)
    }
    page.appendChild(sec)
    // Timeline bar at bottom
    if (v.claims.some((c) => c.at)) page.appendChild(timelineBar(v))
  } else {
    page.appendChild(deduction(v, on))
  }

  root.appendChild(page)
  return root
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 심문 인라인 위젯 — stage() 안에서 쓰는 소형 부품 (3-3-(5) 3단계 · §22 · §36)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * 흔들리는 진술 인라인 힌트 (3-3-(5) 3단계).
 *
 * > "용의자가 답변을 지나치게 회피했을 경우, 플레이어가 다른 질문 방향을 찾을 수 있도록
 * > 작은 힌트를 제공하는 것도 고려한다."
 *
 * 답을 주지 않고 「어떤 진술이 흔들렸는지」만 말한다 — 무엇을 물을지는 플레이어가 정한다.
 * 엔진의 `shakyClaims()` 가 반환하는 id 에서 해당 인물 것만 필터해 보여준다.
 * 흔들리는 진술이 없으면 null 을 돌려 DOM 에 아무것도 넣지 않는다.
 */
export interface ShakyHintRow { id: string; speakerName: string; text: string; at?: string }

export function renderShakyHint(rows: ShakyHintRow[]): HTMLElement | null {
  if (!rows.length) return null
  const wrap = el('div', 'iq-stage-shaky')
  wrap.setAttribute('aria-live', 'polite')
  wrap.appendChild(el('span', 'iq-stage-shaky-k', '확인이 필요한 진술'))
  const list = el('ul', 'iq-stage-shaky-list')
  for (const r of rows) {
    list.appendChild(el('li', undefined,
      `${r.speakerName}${r.at ? ` · ${r.at}` : ''} — "${r.text}"`))
  }
  wrap.appendChild(list)
  return wrap
}

/**
 * 현재 의심 인물 인라인 표시 (명세 §22).
 *
 * > "플레이어는 수사 도중 언제든 현재 의심 인물을 직접 표시할 수 있다."
 * > "이 선택은 정답 제출이 아니다."
 *
 * 시스템이 범인을 가리키지 않는다 — 플레이어가 직접 지목한 대상을 되돌려 보여줄 뿐이다.
 * 이름이 없으면 "아직 없다"로 표시. 누르면 drower 를 열거나 changeTab 을 호출할 수 있도록
 * 클릭 핸들러를 받는다.
 */
export function renderSuspectIndicator(
  suspectName: string | null,
  onClick?: () => void,
): HTMLElement {
  const wrap = el('div', 'iq-stage-suspect')
  wrap.setAttribute('aria-label', '현재 의심 인물')
  const label = el('span', 'iq-stage-suspect-k', '의심 인물')
  const value = el('span', 'iq-stage-suspect-v', suspectName ?? '아직 없다')
  if (!suspectName) value.classList.add('empty')
  wrap.append(label, value)
  if (onClick) {
    wrap.style.cursor = 'pointer'
    wrap.setAttribute('role', 'button')
    wrap.tabIndex = 0
    wrap.onclick = onClick
    wrap.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }
  }
  return wrap
}

/**
 * 플레이어 메모 인라인 노출 (명세 §36).
 *
 * > "수사일지는 다음을 지원해야 한다 — (...) 플레이어 메모"
 *
 * 심문 중 메모가 있으면 한 줄 미리보기를 보여주고, 누르면 드로어를 열어 수정할 수 있게 한다.
 * 메모가 비어 있으면 null 을 돌려 DOM 에 넣지 않는다.
 */
export function renderMemoPreview(
  memo: string,
  onClick?: () => void,
): HTMLElement | null {
  if (!memo.trim()) return null
  const wrap = el('div', 'iq-stage-memo')
  wrap.setAttribute('aria-label', '내 메모')
  wrap.appendChild(el('span', 'iq-stage-memo-k', '메모'))
  // 미리보기는 첫 줄만 (길면 말줄임표)
  const preview = memo.split('\n')[0]!.slice(0, 60) + (memo.length > 60 ? '…' : '')
  wrap.appendChild(el('span', 'iq-stage-memo-v', preview))
  if (onClick) {
    wrap.style.cursor = 'pointer'
    wrap.setAttribute('role', 'button')
    wrap.tabIndex = 0
    wrap.onclick = onClick
    wrap.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }
  }
  return wrap
}
