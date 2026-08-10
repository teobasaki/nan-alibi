/**
 * 자백 템플릿 — **페르소나별 결정론.** LLM 이 아니다 (ADR 022 버린 대안).
 *
 * 엔딩을 LLM 으로 생성하면 마지막 화면이 네트워크·검증 실패에 노출된다.
 * 마지막 화면이 폴백으로 끝나면 게임 전체가 폴백으로 기억된다 — 그래서 자백은
 * 사건 사실(시각·방·동기·도구)을 채워 넣는 고정 문형이고, 페르소나가 문체를 정한다.
 *
 * personas.ts 의 `confession`(지문 서술 — "울먹이며 …했다")과 역할이 다르다:
 * 그쪽은 장면 묘사, 이쪽은 **인물의 입에서 나오는 말**이다. 결말 화면에서 둘이 겹쳐
 * "무너지는 모습" 과 "무너지며 한 말" 이 된다.
 *
 * ⚠️ 여기 문장은 정답 공개다 — **범인을 맞힌 엔딩에서만** 화면에 올린다 (QA 5.7).
 */

import { josa } from '../josa'

export interface ConfessionFacts {
  /** 범인 이름 */
  name: string
  /** 피해자 이름 */
  victim: string
  /** 범행 시각 라벨 (예: 22:20) */
  time: string
  /** 사건 현장 (예: 1204호) */
  room: string
  /** 동기 문구 (범인의 사정) */
  motive: string
  /** 살인 도구 */
  weapon: string
}

type Template = (f: ConfessionFacts) => string

/**
 * 페르소나 8종 전부에 하나씩 — personas.ts 의 id 와 1:1.
 * 문체 근거는 각 페르소나 카드의 sentence·tic·pressureResponse 다.
 * 사실 4종(시각·방·동기·도구)을 전부 문장 안에 싣는 것이 규칙이다 —
 * 자백이 곧 "당신이 맞혀야 했던 것들" 의 재확인이 되게.
 */
const TEMPLATES: Record<string, Template> = {
  // 길고 단정적. 끝까지 체면을 세운다.
  authoritative: (f) =>
    `그래요, 내가 했습니다. ${f.time}, ${f.room}에서 ${josa(f.victim, '을/를')} ` +
    `${josa(f.weapon, '으로/로')} 끝낸 것도 나입니다. ${josa(f.motive, '이/가')} 목까지 차올랐을 때 ` +
    `달리 어떻게 했어야 하는지, 그걸 당신이 내게 물을 자격이 있습니까.`,

  // 짧게 끊어지고 말끝이 흐려진다.
  timid: (f) =>
    `저기… 그럴 생각까지는, 없었어요. 그런데 ${josa(f.motive, '이/가')} 자꾸… 목을 조여 와서. ` +
    `${f.time}에 ${f.room}에서, 손에 잡힌 게 하필 ${josa(f.weapon, '이었어요/였어요')}. ` +
    `${f.victim} 씨한테는… 정말….`,

  // 짧고 정확. 사실만 확인한다.
  calculating: (f) =>
    `인정합니다. ${f.time}, ${f.room}, ${f.weapon}. 기록이 이미 말하고 있는데 부인하는 건 비효율이죠. ` +
    `${josa(f.motive, '은/는')} 협상으로 정리되지 않았습니다 — 그래서 그 방법으로 정리했습니다.`,

  // 감탄사, 이름 반복, 언성.
  emotional: (f) =>
    `${f.victim}… ${f.victim}! 그래, 내가 그랬어! ${josa(f.motive, '이/가')} 사람을 어디까지 몰고 가는지 ` +
    `당신들이 알아?! ${f.time}에 ${f.room}에서, 눈앞에 ${josa(f.weapon, '이/가')} 있었고 — 그다음은 기억도 나지 않아.`,

  // 조심스럽고, 끝까지 누군가를 지키는 말투.
  loyal: (f) =>
    `제가 한 일입니다. 다른 사람은 아무도 관련이 없습니다 — 그것만은 믿어 주십시오. ` +
    `${josa(f.motive, '이/가')} 더는 덮이지 않았고, 제가 아는 한 그날 밤에는 그 길뿐이었습니다. ` +
    `${f.time}, ${f.room}에서 ${josa(f.weapon, '을/를')} 들었습니다.`,

  // 모든 것을 자기 입장으로 되돌린다.
  egocentric: (f) =>
    `내 입장에서는 선택지가 없었습니다. ${josa(f.motive, '을/를')} 그냥 두면 무너지는 건 나였으니까. ` +
    `${f.time}에 ${f.room}으로 갔고, ${josa(f.weapon, '은/는')} 준비했다기보다… 거기 있었으니 쓴 겁니다. ` +
    `${f.victim} 쪽에서도 나를 몰아붙이지 말았어야죠.`,

  // 짧고, 자주 멈추고, 오래 준비한 문장처럼.
  guilty: (f) =>
    `…이제야 말이 되어 나오는군요. ${f.time}, ${f.room}. ${josa(f.weapon, '이었습니다/였습니다')}. ` +
    `시작은 ${josa(f.motive, '이었지만/였지만')}, 그게 변명이 되지 않는다는 건 그날 밤부터 알고 있었습니다.`,

  // 비꼬다가, 마지막에만 진지해진다.
  cynical: (f) =>
    `박수라도 쳐 드려야 하나, 탐정님. 맞습니다 — ${f.time}, ${f.room}, ${f.weapon}까지 전부. ` +
    `${josa(f.motive, '이면/면')} 누구라도 그랬을 거라는 농담을 준비해 뒀는데… 지금은 별로 웃기지 않는군요. ` +
    `${f.victim}에게는, 그 말만은 진심이었다고 해 두죠.`,
}

/** 어떤 이유로든 페르소나 id 가 표 밖이면 — 엔딩은 절대 비어선 안 된다 (폴백도 결정론) */
const FALLBACK: Template = (f) =>
  `제가 했습니다. ${f.time}, ${f.room}에서 ${josa(f.weapon, '을/를')} 썼습니다. ` +
  `${josa(f.motive, '이/가')} 이유였습니다. ${f.victim} 앞에 더 할 말이 없습니다.`

export function confessionFor(personaId: string, f: ConfessionFacts): string {
  return (TEMPLATES[personaId] ?? FALLBACK)(f)
}

/** 테스트가 "8종 전부 있는가" 를 못박을 수 있게 열어 둔다 */
export const CONFESSION_PERSONA_IDS: readonly string[] = Object.keys(TEMPLATES)
