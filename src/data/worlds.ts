/**
 * 월드 팩 — 시드 사건이 입는 라벨·이름 스킨 (사용자: "비슷한 월드 뽑아줘").
 *
 * ## 스킨이지 사건이 아니다
 * 생성기(caseGen)와 검증기(validate)는 한 글자도 안 바뀐다. 유일해 보장·궤적·증거 구조는
 * 전부 그대로이고, 여기서는 **이름만** 갈아입힌다: 직업·관계·장소 라벨·장소명·피해자 직함·제목.
 * 시각(22:00~22:40)·무기 5종·기록 종류(카드키·CCTV·영수증)는 기본을 유지한다 —
 * 1960년대 물건이라 경매장이든 방송국이든 극장이든 성립한다.
 *
 * ## 결정론
 * 같은 seed + 같은 world = 항상 같은 사건. 월드별 salt 를 섞은 파생 rng 만 쓰므로
 * 주 스트림(caseGen)은 건드리지 않는다 — `?seed=` 만 있는 기존 URL 은 바이트 단위로 그대로다.
 *
 * ⚠️ 새 월드를 추가하면: ① jobs 5종 전부 SLUG_BY_JOB 에 매핑 (tests/worlds.test.ts 가 잠금)
 * ② placeLabels[2] = 현장 = venue.room ③ 이 파일의 WORLD_IDS 에 등록.
 */

import {
  SLOT_LABEL, SUSPECTS,
  type CaseFile, type Suspect, type SuspectId,
} from '../types'
import { makeRng, pick, shuffle } from '../engine/rng'

export interface WorldPack {
  id: string
  /** 사람이 읽는 무대 이름 (로테이션 안내 등) */
  label: string
  /** 장소명 풀 — room 은 placeLabels[2](현장)와 같아야 한다 */
  venues: readonly { name: string; room: string }[]
  victimTitles: readonly string[]
  /** 정확히 5종 — 전부 SLUG_BY_JOB 에 매핑이 있어야 한다 */
  jobs: readonly { job: string; relation: string }[]
  /** index 2 가 범행 현장 */
  placeLabels: readonly [string, string, string, string, string]
  titles: readonly string[]
  /** 파생 rng 소금 — 월드마다 달라야 같은 시드가 월드마다 다른 옷을 입는다 */
  salt: number
}

export const WORLD_PACKS: Record<string, WorldPack> = {
  auction: {
    id: 'auction',
    label: '심야 옥션 하우스',
    venues: [
      { name: '단원 옥션 하우스', room: '경매홀' },
      { name: '서촌 야간 경매장', room: '경매홀' },
      { name: '청파 옥션', room: '경매홀' },
    ],
    victimTitles: ['수석 경매사', '옥션 대표', '위탁 수집가'],
    jobs: [
      { job: '경매 진행인', relation: '그날 밤 단상에 설 예정이었다' },
      { job: '감정 보조', relation: '출품작의 감정을 도왔다' },
      { job: '기록 담당', relation: '응찰 기록을 관리한다' },
      { job: '수장고 관리', relation: '출품작의 입출고를 쥔다' },
      { job: '야간 경비', relation: '폐장 뒤 출입을 지킨다' },
    ],
    placeLabels: ['프리뷰룸', '복도', '경매홀', '수장고', '하역장'],
    titles: ['유찰된 밤', '경매홀의 20분', '마지막 응찰', '봉인된 출품작', '자정의 낙찰봉'],
    salt: 0x41554354,
  },
  studio: {
    id: 'studio',
    label: '심야 방송국',
    venues: [
      { name: '한내 방송사 본관', room: '스튜디오' },
      { name: '한내 방송사 별관', room: '스튜디오' },
      { name: '한내 미디어 센터', room: '스튜디오' },
    ],
    victimTitles: ['보도국장', '간판 앵커', '제작 총괄'],
    jobs: [
      { job: '프로듀서', relation: '피해자와 개편안을 다퉜다' },
      { job: '진행자', relation: '같은 프로그램의 얼굴이었다' },
      { job: '음향 기사', relation: '부스에서 방송을 지켰다' },
      { job: '구성 작가', relation: '원고를 밤새 고쳐 왔다' },
      { job: '경비원', relation: '심야 출입을 관리한다' },
    ],
    placeLabels: ['대기실', '복도', '스튜디오', '조정실', '로비'],
    titles: ['생방송 20분 전', '꺼진 온에어 사인', '자정 뉴스', '마지막 큐시트', '조정실의 침묵'],
    salt: 0x53545544,
  },
  theater: {
    id: 'theater',
    label: '백야 극장',
    venues: [
      { name: '백야 극장', room: '무대 뒤' },
      { name: '백야 소극장', room: '무대 뒤' },
      { name: '백야 아트홀', room: '무대 뒤' },
    ],
    victimTitles: ['연출가', '원로 배우', '후원회장'],
    jobs: [
      { job: '극단 대표', relation: '피해자와 극단을 함께 세웠다' },
      { job: '주연 배우', relation: '개막을 앞두고 있었다' },
      { job: '무대 감독', relation: '무대 전환을 지휘한다' },
      { job: '의상 담당', relation: '의상실 열쇠를 쥔다' },
      { job: '매표 담당', relation: '그날 밤 정산을 맡았다' },
    ],
    placeLabels: ['분장실', '복도', '무대 뒤', '소품실', '매표소'],
    titles: ['막이 오르기 전', '커튼콜 없는 밤', '무대 뒤 20분', '마지막 리허설', '객석의 그림자'],
    salt: 0x54484541,
  },
}

/** '새 게임' 로테이션 순서 — null 이 호텔(기본)이다 */
export const WORLD_ROTATION: readonly (string | null)[] = [null, 'auction', 'studio', 'theater']

/**
 * 생성된 사건에 월드 스킨을 입힌다. 모르는 id 면 **원본 그대로** 돌려준다 —
 * URL 오타가 빈 화면이 되면 안 된다.
 *
 * 진실 구조(궤적·거짓말·증거·해금·채점 축)는 절대 건드리지 않는다.
 * tests/worlds.test.ts 가 "스킨 전후 진실 동일" 을 잠근다.
 */
export function applyWorld(c: CaseFile, worldId: string | null | undefined): CaseFile {
  if (!worldId) return c
  const pack = WORLD_PACKS[worldId]
  if (!pack) return c

  // 파생 rng — 주 스트림을 건드리면 기존 사건이 전부 다른 사건이 된다 (caseGen 의 그 함정)
  const rng = makeRng((c.seed ^ pack.salt) >>> 0)
  const venue = pick(rng, pack.venues)
  const title = pick(rng, pack.titles)
  const victimTitle = pick(rng, pack.victimTitles)
  // 직업 5종을 섞어 하나씩 — 시드마다 범인의 직업이 달라진다
  const jobs = shuffle(rng, pack.jobs)

  const suspects = {} as Record<SuspectId, Suspect>
  SUSPECTS.forEach((s, i) => {
    suspects[s] = { ...c.suspects[s], job: jobs[i]!.job, relation: jobs[i]!.relation }
  })

  return {
    ...c,
    title,
    venue: { ...venue },
    victim: { ...c.victim, title: victimTitle },
    suspects,
    world: {
      slotLabels: SLOT_LABEL,       // 시각은 기본 유지 — 어느 무대든 밤 10시는 밤 10시다
      placeLabels: pack.placeLabels,
      // 기록 종류·무기·검시 서술도 기본 유지: 1960년대 호텔 물건은 이 무대들에도 있다
    },
  }
}
