/**
 * 제출 시트 — **근거를 골라 사슬로 잇는다** (명세 V0.2 §31·§32·§34).
 *
 * 기존 제출은 `범인 + 동기 + 도구` 세 개의 드롭다운이었다. 그건 *답을 고르는* 화면이다.
 * V0.2 의 제출은 `범인 + 방식 + 근거 2~4개와 그 연결` 이고, 판정은
 * **"어떤 Evidence 를 골랐는가" 보다 "그 연결로 어떤 명제가 성립했는가"** 를 본다 (§31).
 *
 * ## 이 부품의 경계
 * - **판정하지 않는다.** `on.judge()` 로 엔진에게 물어보고 결과를 그린다.
 * - **정답을 알지 못한다.** 범인 id·명제 성립 조건이 이 파일에 없다. 그래서 화면을 뜯어
 *   읽어도 답이 새지 않는다 (이 저장소가 옆문 누출로 한 번 앓았다).
 * - 자기 CSS 를 자기가 import 한다.
 * - 선택 상태는 **부품 안에** 둔다. 전역 재렌더에 얹으면 고르는 동안 화면이 튄다.
 */

import '../styles/proof.css'
import { validateConnectionGraph, type DeductionSubmission, type ProofResult, type Verdict } from '../engine/proof'

export interface ProofClue {
  id: string
  kind: 'CLAIM' | 'FACT' | 'EVIDENCE'
  /** 한 줄 제목 */
  label: string
  /** 아래 붙는 부연 (없으면 안 그린다) */
  detail?: string
  /** 이 근거를 쓰면 모순이 되는가 (기록과 어긋난 진술) — 고를 수는 있게 두고 표시만 한다 */
  conflicted?: boolean
}

export interface ProofSheetData {
  people: { id: string; name: string; job: string }[]
  methods: string[]
  /** 손에 쥔 Clue 전부 — 여기서만 고를 수 있다 */
  clues: ProofClue[]
  pick: { min: number; recommended: number; max: number }
  /** 명제 목록 (판정 화면에서 상태와 함께 보여준다) */
  propositions: { id: string; statement: string }[]
  verdictLine: Record<Verdict, string>
  /** 수사일지에서 미리 이어 둔 연결 — 둘 다 선택됐을 때 제출 초안으로 들어온다 */
  draftConnections?: { fromId: string; toId: string }[]
}

export interface ProofSheetHandlers {
  /** 엔진에게 판정을 묻는다 — 부품은 규칙을 모른다 */
  judge(sub: DeductionSubmission): ProofResult
  /** 입증됐다 — 사건을 넘긴다 (결말로) */
  accept(sub: DeductionSubmission, r: ProofResult): void
  /** 수사로 돌아간다 */
  close(): void
}

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

const KIND_LABEL: Record<ProofClue['kind'], string> = {
  CLAIM: '진술', FACT: '사실', EVIDENCE: '기록',
}

/**
 * 시트를 만든다. 두 화면이 한 부품 안에 있다 — 고르는 면과 판정 면.
 * 판정 뒤에도 **되돌아올 수 있다**: 입증이 안 됐으면 수사가 끝나지 않는다 (§34).
 */
export function renderProofSheet(d: ProofSheetData, on: ProofSheetHandlers): HTMLElement {
  const root = el('div', 'pf')

  /* ── 선택 상태는 부품 안에 ── */
  let culpritId = d.people[0]?.id ?? ''
  let methodId = d.methods[0] ?? ''
  /** 고른 순서가 곧 사슬의 순서다 (§31 의 예시가 사슬로 적혀 있다) */
  const picked: string[] = []
  let connections = [...(d.draftConnections ?? [])]
  let linkStart: string | null = null

  const body = el('div', 'pf-body')
  root.appendChild(body)

  const drawPick = (): void => {
    body.replaceChildren()

    /* ① 범인 */
    const s1 = el('section', 'pf-sec')
    s1.appendChild(el('h3', undefined, '① 누구인가'))
    const who = el('div', 'pf-who')
    for (const p of d.people) {
      const on1 = culpritId === p.id
      const b = el('button', `pf-chip${on1 ? ' on' : ''}`) as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('aria-pressed', String(on1))
      b.appendChild(el('span', 'pf-chip-t', p.name))
      b.appendChild(el('span', 'pf-chip-s', p.job))
      b.onclick = () => { culpritId = p.id; drawPick() }
      who.appendChild(b)
    }
    s1.appendChild(who)
    body.appendChild(s1)

    /* ② 방식 */
    const s2 = el('section', 'pf-sec')
    s2.appendChild(el('h3', undefined, '② 어떤 방식인가'))
    const met = el('div', 'pf-methods')
    for (const m of d.methods) {
      const on1 = methodId === m
      const b = el('button', `pf-chip wide${on1 ? ' on' : ''}`) as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('aria-pressed', String(on1))
      b.appendChild(el('span', 'pf-chip-t', m))
      b.onclick = () => { methodId = m; drawPick() }
      met.appendChild(b)
    }
    s2.appendChild(met)
    body.appendChild(s2)

    /* ③ 근거와 사슬 */
    const s3 = el('section', 'pf-sec')
    const cap = el('h3', undefined, '③ 무엇을 근거로 하는가')
    cap.appendChild(el('span', 'pf-count',
      `${picked.length} / ${d.pick.recommended} (최소 ${d.pick.min} · 최대 ${d.pick.max})`))
    s3.appendChild(cap)
    s3.appendChild(el('p', 'pf-hint',
      '고른 순서가 그대로 사슬이 된다. 판정은 무엇을 골랐는지가 아니라, 그 연결로 무엇이 성립했는지를 본다.'))

    // 연결 편집 — 두 단서를 차례로 눌러 선을 잇거나 끊는다. 목록에 함께 있는 것만으로는 증명이 아니다.
    const activeConnections = connections.filter((x) => picked.includes(x.fromId) && picked.includes(x.toId))
    const graph = validateConnectionGraph(picked, activeConnections)
    if (picked.length) {
      const chain = el('div', 'pf-chain pf-graph')
      chain.appendChild(el('div', 'pf-graph-h', linkStart
        ? '연결할 둘째 근거를 고른다' : '두 근거를 차례로 눌러 연결한다'))
      const nodes = el('div', 'pf-graph-nodes')
      for (const id of picked) {
        const c = d.clues.find((x) => x.id === id)
        const node = el('button', `pf-link${linkStart === id ? ' linking' : ''}`) as HTMLButtonElement
        node.type = 'button'; node.setAttribute('aria-pressed', String(linkStart === id))
        node.appendChild(el('span', 'pf-link-k', KIND_LABEL[c?.kind ?? 'FACT']))
        node.appendChild(el('span', 'pf-link-t', c?.label ?? id))
        node.onclick = () => {
          if (!linkStart) { linkStart = id; return drawPick() }
          if (linkStart === id) { linkStart = null; return drawPick() }
          const i = connections.findIndex((x) =>
            (x.fromId === linkStart && x.toId === id) || (x.fromId === id && x.toId === linkStart))
          if (i >= 0) connections.splice(i, 1)
          else connections.push({ fromId: linkStart, toId: id })
          linkStart = null; drawPick()
        }
        nodes.appendChild(node)
      }
      chain.appendChild(nodes)
      const edges = el('div', 'pf-edges')
      for (const edge of activeConnections) {
        const a = d.clues.find((x) => x.id === edge.fromId)?.label ?? edge.fromId
        const b = d.clues.find((x) => x.id === edge.toId)?.label ?? edge.toId
        const line = el('button', 'pf-edge', `${a}  →  ${b}  ×`) as HTMLButtonElement
        line.type = 'button'; line.onclick = () => { connections = connections.filter((x) => x !== edge); drawPick() }
        edges.appendChild(line)
      }
      chain.appendChild(edges)
      chain.appendChild(el('div', `pf-graph-state${graph.valid ? ' ok' : ''}`,
        graph.valid ? '연결 확인 — 하나의 논증이다' : '연결 필요 — 모든 근거가 한 덩어리여야 한다'))
      s3.appendChild(chain)
    }

    const list = el('div', 'pf-clues')
    if (d.clues.length === 0) {
      list.appendChild(el('div', 'pf-empty', '아직 근거로 낼 것이 없다. 기록을 조회하거나 사람을 만나야 한다.'))
    }
    for (const c of d.clues) {
      const on1 = picked.includes(c.id)
      const b = el('button', `pf-clue k-${c.kind.toLowerCase()}${on1 ? ' on' : ''}${c.conflicted ? ' bad' : ''}`) as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('aria-pressed', String(on1))
      const head = el('div', 'pf-clue-h')
      head.appendChild(el('span', 'pf-clue-k', KIND_LABEL[c.kind]))
      if (on1) head.appendChild(el('span', 'pf-clue-n', `${picked.indexOf(c.id) + 1}`))
      if (c.conflicted) head.appendChild(el('span', 'pf-clue-bad', '기록과 어긋난 진술'))
      b.appendChild(head)
      b.appendChild(el('div', 'pf-clue-t', c.label))
      if (c.detail) b.appendChild(el('div', 'pf-clue-d', c.detail))
      b.onclick = () => {
        const i = picked.indexOf(c.id)
        if (i >= 0) {
          picked.splice(i, 1)
          connections = connections.filter((x) => x.fromId !== c.id && x.toId !== c.id)
          if (linkStart === c.id) linkStart = null
        } else if (picked.length < d.pick.max) picked.push(c.id)
        drawPick()
      }
      // 상한을 넘겨 고르려 할 때는 **막되 이유를 보인다** — 조용히 무시하면 고장으로 읽힌다
      b.disabled = !on1 && picked.length >= d.pick.max
      list.appendChild(b)
    }
    s3.appendChild(list)
    body.appendChild(s3)

    /* 제출 */
    const foot = el('div', 'pf-foot')
    const go = el('button', 'pf-go', '이 논증을 제출한다') as HTMLButtonElement
    go.type = 'button'
    go.disabled = picked.length < d.pick.min || !culpritId || !methodId || !graph.valid
    if (picked.length < d.pick.min) {
      foot.appendChild(el('span', 'pf-need', `근거를 최소 ${d.pick.min}개 골라야 한다`))
    } else if (!graph.valid) {
      foot.appendChild(el('span', 'pf-need', '고른 근거를 모두 하나의 연결로 이어야 한다'))
    }
    go.onclick = () => {
      const sub: DeductionSubmission = {
        culpritId,
        methodId,
        selectedClueIds: [...picked],
        connections: activeConnections.map((x) => ({ ...x })),
      }
      drawVerdict(sub, on.judge(sub))
    }
    const back = el('button', 'pf-back', '아직 아니다') as HTMLButtonElement
    back.type = 'button'
    back.onclick = () => on.close()
    foot.appendChild(back)
    foot.appendChild(go)
    body.appendChild(foot)
  }

  /* ── 판정 면 ── */
  const drawVerdict = (sub: DeductionSubmission, r: ProofResult): void => {
    body.replaceChildren()
    const proven = r.verdict === 'PROVEN'

    const head = el('section', `pf-verdict v-${r.verdict.toLowerCase()}`)
    head.appendChild(el('div', 'pf-vk', proven ? '입증' : '미입증'))
    head.appendChild(el('div', 'pf-vt', d.verdictLine[r.verdict]))
    for (const line of r.reasons) head.appendChild(el('div', 'pf-vr', line))
    body.appendChild(head)

    /* 명제 표 — **무엇이 섰고 무엇이 비었는지**만 말한다. 정답은 말하지 않는다 */
    const sec = el('section', 'pf-sec')
    sec.appendChild(el('h3', undefined, '내 논증으로 성립한 것'))
    const table = el('div', 'pf-props')
    for (const p of d.propositions) {
      const st = r.propositions[p.id] ?? 'UNKNOWN'
      const row = el('div', `pf-prop s-${st.toLowerCase()}`)
      row.appendChild(el('span', 'pf-prop-m', st === 'PROVEN' ? '○' : st === 'SUPPORTED' ? '△' : '·'))
      row.appendChild(el('span', 'pf-prop-t', p.statement))
      row.appendChild(el('span', 'pf-prop-s',
        st === 'PROVEN' ? '성립' : st === 'SUPPORTED' ? '근거 부족' : '미성립'))
      table.appendChild(row)
    }
    sec.appendChild(table)
    body.appendChild(sec)

    const foot = el('div', 'pf-foot')
    if (proven) {
      const done = el('button', 'pf-go', '사건을 송치한다') as HTMLButtonElement
      done.type = 'button'
      done.onclick = () => on.accept(sub, r)
      foot.appendChild(done)
    } else {
      /**
       * **입증이 안 됐으면 수사는 끝나지 않는다.** 예전 제출은 한 번 누르면 판이 끝났다.
       * V0.2 의 제출은 논증이므로, 서지 않았다면 근거를 더 모아 오는 것이 정상 진행이다 (§34).
       */
      const again = el('button', 'pf-go', '논증을 다시 짠다') as HTMLButtonElement
      again.type = 'button'
      again.onclick = () => drawPick()
      const out = el('button', 'pf-back', '수사로 돌아간다') as HTMLButtonElement
      out.type = 'button'
      out.onclick = () => on.close()
      foot.appendChild(out)
      foot.appendChild(again)
    }
    body.appendChild(foot)
  }

  drawPick()
  return root
}
