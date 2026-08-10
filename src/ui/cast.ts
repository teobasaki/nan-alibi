/**
 * **배역표 — 용의자 5명이 어떤 몸을 입는가.**
 *
 * ## 왜 직업(job)이 아니라 슬롯(S1~S5)인가
 * 예전에는 `SLUG_BY_JOB` 이 직업 이름으로 모델을 골랐다. 그 표는 월드가 늘 때마다
 * 직업 5종씩 손으로 추가해야 했고, 빠뜨리면 **3D 가 조용히 죽었다**(gc001 에서
 * 실제로 밟았다 — 경찰서 탭이 사라지고 취조실이 사진 폴백으로 떨어졌다).
 * 슬롯은 사건이 무슨 옷을 입든 언제나 정확히 다섯이다. 그래서 새 월드가 와도
 * **아무것도 추가할 게 없고, 배정이 빌 수가 없다.**
 *
 * ## 성별은 이름·나이가 정한 것을 따른다
 * 시드 사건의 이름 풀(도윤·세아·지후·민서…)은 전부 **중성 이름**이라 슬롯 고정 배정이
 * 어긋나지 않는다. 반면 골든 케이스는 대본에 성별이 박혀 있다(류나린 41 여 · 배지호 33 남
 * · 문소라 38 여 · 도율 52 남). 그런 사건만 `CAST_OVERRIDE` 로 배역을 바꿔 끼운다 —
 * **이름 생성기는 건드리지 않는다**(시드 풀 400개 결정론이 거기 걸려 있다).
 */

import { SUSPECTS, type SuspectId } from '../types'

export interface CastMember {
  /**
   * 에셋 태그 — 이 배우의 **모든** 에셋이 이 한 글자열에 매달린다.
   *   - 3D 몸: `public/characters/<tag>.{sit,idle}.opt.glb`
   *   - 초상:  `public/portraits/<tag>.webp` (같은 idle GLB 를 구운 것)
   *
   * 초상 파일명이 이 태그와 어긋나면 `portraitFor` 가 조용히 null 을 돌려주고
   * 카드월·취조실·조서가 한꺼번에 이니셜 명패로 떨어진다 — 실제로 배역을 이 다섯으로
   * 갈아엎었을 때 옛 태그(manager·security…)의 초상만 남아 그 일이 벌어졌다.
   * 태그를 바꾸면 **초상도 같이 다시 굽는다**: `scripts/render-portraits.py`.
   */
  tag: string
  gender: 'm' | 'f'
  /** 사람이 읽는 설명 (배역표·크레딧용) */
  note: string
}

/**
 * 채택 5종 — **자체 생성본(Meshy)으로 되돌렸다** (2026-08-10 사용자 결정).
 *
 * 기성 리깅 배우 5종(wong·carla·m1·f3·f1)은 Mixamo 착석 클립을 그대로 먹어
 * 이론상 더 나았지만, 실제 취조실에서 **팔이 머리 위로 뻗고 몸이 의자를 벗어나** 앉았다.
 * 원인은 CC_Base 계열 리그의 상완 본이 glTF 임포트에서 길이 13913 으로 깨져 들어오는
 * 것이었고(초상 굽기에서 실측), 이걸 마감 안에 고칠 수 없다고 판단했다.
 *
 * Meshy 본은 **정적 착석 포즈가 통째로 구워진 메시**라 리그가 무엇이든 상관없다 —
 * 재생할 클립이 없으니 어긋날 것도 없다. 화풍은 덜 사실적이지만 **앉아 있는다.**
 * 남은 시간을 3D 인체가 아니라 UI·UX 에 쓴다는 결정이 이 표다.
 *
 * 기성 배우 5종의 파일과 초상은 남아 있다 — 되돌리려면 이 표만 바꾸면 된다.
 */
export const CAST: readonly CastMember[] = [
  { tag: 'secretary', gender: 'f', note: '여 · 사무' },
  { tag: 'security', gender: 'm', note: '남 · 경비' },
  { tag: 'housekeeping', gender: 'f', note: '여 · 관리' },
  { tag: 'investor', gender: 'm', note: '남 · 정장' },
  { tag: 'expartner', gender: 'f', note: '여' },
] as const

/** 기본 배정 — 슬롯 고정. gc001 대본 성별(여/남/여/남/여)을 그대로 따른다. */
export const CAST_BY_SLOT: Record<SuspectId, string> = {
  S1: 'secretary',
  S2: 'security',
  S3: 'housekeeping',
  S4: 'investor',
  S5: 'expartner',
}

/**
 * 성별이 **대본에 박힌** 사건만 배역을 바꿔 끼운다.
 * gc001: S1 류나린(41·여) · S2 배지호(33·남) · S3 문소라(38·여) ·
 *        S4 도율(52·남) · S5 김하늘(29·여로 읽는다).
 * 배우 풀이 남 2 · 여 3 이라 이 배분과 정확히 맞아떨어진다.
 */
export const CAST_OVERRIDE: Record<string, Record<SuspectId, string>> = {
  gc001: { S1: 'secretary', S2: 'security', S3: 'housekeeping', S4: 'investor', S5: 'expartner' },
}

/** 이 슬롯이 입을 몸. 사건 id 가 배역을 지정했으면 그것이 이긴다. */
export function castTagFor(slot: SuspectId, caseId?: string | null): string {
  const over = caseId ? CAST_OVERRIDE[caseId] : undefined
  return over?.[slot] ?? CAST_BY_SLOT[slot]
}

/** 한 판의 배역 다섯 — 순서는 S1~S5 */
export function castOf(caseId?: string | null): string[] {
  return SUSPECTS.map((s) => castTagFor(s, caseId))
}

const BY_TAG = new Map(CAST.map((c) => [c.tag, c]))

export const castMember = (tag: string): CastMember | undefined => BY_TAG.get(tag)
