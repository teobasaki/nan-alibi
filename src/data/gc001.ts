/**
 * 골든 케이스 001 「갤러리의 사각지대」 — 생성기를 타지 않는 **수제 CaseFile**.
 *
 * 정본: docs/content/GC001-골든케이스-정본.md (팀 설계 문서)
 * 매핑: docs/content/GC001-엔진-어댑테이션-계약.md — 이 파일은 그 계약의 구현이다.
 *
 * ## 이 사건이 호텔 생성 사건과 구조적으로 다른 두 가지
 * 1. **결정적 기록이 범행 시각이 아니라 은폐 시각(21:18, slot3)에 있다.**
 *    범행 순간이 아니라 라벨을 바꾼 순간이 범인을 가리킨다 — 그래서 solver 의
 *    후보 계산은 decisive 플래그로 못박는다 (C1 커밋에서 일반화).
 * 2. E8·E9 의 `requires` 는 V0.1 호환 메타데이터로 남지만, V0.2 실제 플레이에서는
 *    **독립 조사 대상**이다. 두 기록을 함께 읽어 문소라의 대리 가능성을 지우는 것은
 *    Proof의 논리이지 다음 기록을 생성하는 자물쇠가 아니다 (ADR 031·AC-04~07).
 *
 * ## 수단·신체·도구 묘사 금지 (정본 §4)
 * 검시 흔적·도구명·유혈 서술을 전부 추상 분류("고의적 직접 물리력")로 대체한다.
 * tests/gc001.test.ts 의 금칙어 스캔이 이 규칙을 잠근다.
 *
 * 모든 인물·기관은 정본 그대로의 **완전한 허구**다. 실제 사건·인물·기관 참조 없음.
 */

import { CRIME_PLACE, CRIME_SLOT, type CaseFile, type Trajectory } from '../types'

/** 시작 페이지·서류 머리에 찍히는 사건번호 — 시드가 아니라 케이스 id 다 */
export const GC001_CASE_NO = 'GC-001'

export function gc001Case(): CaseFile {
  // 궤적. index = 장소: 0 큐레이터 데스크 · 1 갤러리 밖 · 2 메인 전시홀 · 3 반입문 앞 · 4 반입대
  // 류나린(범인): 내내 전시홀에 있었고 21:21 이후 반입 구역으로 — "21:04 나갔다" 는 거짓.
  const ryuTruth: Trajectory = [2, 2, 2, 2, 3]
  const ryuClaim: Trajectory = [2, 1, 1, 1, 3]
  // 배지호: 이직 통화를 하러 반입 쪽에 나가 있었다 — "데스크에서 도록 수정만" 은 거짓.
  const baeTruth: Trajectory = [0, 3, 3, 0, 2]
  const baeClaim: Trajectory = [0, 0, 0, 0, 2]
  // 문소라: 21:09 전시홀에서 상자를 옮겼다 — "옮기지 않았다" 는 거짓. 이후 반입대.
  const munTruth: Trajectory = [0, 2, 4, 4, 4]
  const munClaim: Trajectory = [0, 4, 4, 4, 4]
  // 도율·김하늘: 궤적은 정직하다 — 이들의 거짓은 위치가 아니라 관계·근무 태만의 은폐다.
  const doTruth: Trajectory = [2, 1, 1, 1, 1]
  const gimTruth: Trajectory = [3, 3, 3, 3, 2]

  return {
    seed: 1,   // 고정 — Retry(?case=gc001 재로드)는 자연히 같은 사건이다
    evidenceAccess: 'open', // V0.2: legacy requires 사슬은 실제 조회를 막지 않는다
    /**
     * 제목은 「옮겨진 상자의 사각」이었다. 팀 플레이테스트 지적 — **무슨 말인지
     * 이해가 안 되고 사건을 대표하지 못한다.** "사각(死角)"이 한 단어로는 안 읽혔고,
     * 옮겨진 상자는 이 사건의 계기이지 사건 자체가 아니다.
     * 「갤러리의 사각지대」는 카메라가 못 본 구간과 사람들의 맹점을 동시에 가리키면서
     * 읽는 즉시 이해된다 (2026-08-26 팀 피드백 1-(4)).
     */
    title: '갤러리의 사각지대',
    victim: { name: '한라온', title: '관장' },
    venue: { name: '라음 사립 갤러리', room: '메인 전시홀' },

    world: {
      // CRIME_SLOT=2(21:16) · CRIME_PLACE=2(메인 전시홀) — 구조 불변, 이름만 사건 것
      slotLabels: ['21:00', '21:10', '21:16', '21:18', '21:21'],
      placeLabels: ['큐레이터 데스크', '갤러리 밖', '메인 전시홀', '반입문 앞', '반입대'],
      kindLabels: {
        keycard: '수정 라벨 기록',
        receipt: '작업 기록',
        cctv: '카메라 기록',
        call: '통화 기록',
        autopsy: '현장 판정',
      },
      weaponAxisLabel: '수단',
      weaponOptions: [
        '고의적 직접 물리력',
        '전시 구조물 낙하 사고',
        '받침대 구조 결함',
        '약물에 의한 사고',
        '외부 침입자의 소행',
      ],
      // 정본 §4 — 상세 손상 기술은 기록하지 않는다. 유혈·신체·도구 어휘 금지.
      autopsyText:
        '구조화 현장 판정 — 고의적 직접 물리력 분류. ' +
        '받침대 사전 결함·우발적 구조 붕괴·약물 요인은 배제됐다. 상세 손상 기술은 기록하지 않는다.',
    },

    culprit: 'S1',
    motive: '반입 기록 조작이 발각돼 해임·감사를 앞두고 있었다',
    // 카드키 축의 후신 — 채점 축은 아니고 결정적 기록의 발급 구분(keyLabel)이 실체다
    method: 'REV-17-084 수정 라벨 세션',
    weapon: '고의적 직접 물리력',

    suspects: {
      S1: {
        id: 'S1', name: '류나린', age: 41, job: '전시 운영 책임자',
        relation: '반입 기록과 폐관 운영을 관장에게 보고해 왔다',
        background: [
          '라음 사립 갤러리의 전시 운영 책임자',
          '반입 기록과 폐관 운영을 피해자에게 보고하는 위치',
          '피해자와 8년 이상 협력해 온 운영 담당자',
        ],
        motive: '반입 기록 조작이 발각돼 해임·감사를 앞두고 있었다',
        // 통제형 — 증거 없는 추궁은 무시하고, 물증 앞에서만 태도가 바뀐다 (정본 DEFENSIVE)
        personaId: 'calculating',
        isCulprit: true,
        truth: ryuTruth, claim: ryuClaim, lieSlots: [1, 2, 3],
        lieReason: '범인이기 때문에',
        testimonies: [],
      },
      S2: {
        id: 'S2', name: '배지호', age: 33, job: '부큐레이터',
        relation: '관장의 일정과 도록을 맡아 왔다 — 피해자를 발견한 사람이다',
        background: [
          '관장 일정과 도록 수정을 담당하는 부큐레이터',
          '피해자를 발견한 사람이다',
          '전시 일정 변경과 도록 편집 전반을 담당',
        ],
        motive: '기증자와 몰래 이직 통화를 하고 있었다',
        // 동요형 (정본 SHAKEN) — 압박하면 말이 꼬이고, 안심시키면 정확해진다
        personaId: 'timid',
        isCulprit: false,
        truth: baeTruth, claim: baeClaim, lieSlots: [1, 2],
        lieReason: '기증자와 몰래 이직 통화를 했기 때문에',
        testimonies: ['T-BAE-NOTICE'],
      },
      S3: {
        id: 'S3', name: '문소라', age: 38, job: '작품 운송 담당',
        relation: '반입·철거 물품의 이동을 맡는다',
        background: [
          '반입·철거 물품의 이동을 맡는 작품 운송 담당',
          '목록대의 revision mode 사용 권한을 가진 eligible operator',
          '운송 상자와 전시 물품의 배치 전반을 담당',
        ],
        motive: '지시 없이 상자를 옮겨 라벨을 어긋나게 했다',
        // 불안형 (정본 ANXIOUS) — 특정 화제(상자)가 나오면 감정이 앞선다
        personaId: 'emotional',
        isCulprit: false,
        truth: munTruth, claim: munClaim, lieSlots: [1],
        lieReason: '지시 없이 상자를 옮긴 책임을 피하려 했기 때문에',
        testimonies: [],
      },
      S4: {
        id: 'S4', name: '도율', age: 52, job: '작품 보존 담당',
        relation: '전시 받침대의 상태 점검을 맡아 왔다',
        background: [
          '전시 받침대의 상태 점검을 맡아 온 작품 보존 담당',
          '받침대 구조 상태 점검과 보존 처리를 수행',
          '이전 점검 이력과 현재 상태 확인을 전담',
        ],
        motive: '지난 점검 누락을 덮어 달라 부탁한 적이 있다',
        // 방어적 (정본 DEFENSIVE) — 실수를 짚으면 자격부터 되묻는다
        personaId: 'authoritative',
        isCulprit: false,
        truth: doTruth, claim: [...doTruth] as Trajectory, lieSlots: [],
        lieReason: '',
        testimonies: ['T-DO-PLEA'],
      },
      S5: {
        id: 'S5', name: '김하늘', age: 29, job: '야간 보안 담당',
        relation: '폐관 뒤 출입과 카메라 감시를 맡는다',
        background: [
          '폐관 뒤 출입과 카메라 감시를 맡는 야간 보안 담당',
          '출입 패널 점검과 카메라 모니터링을 수행',
          '갤러리 폐관 이후 접근 통제를 전담',
        ],
        motive: '잠깐 열린 카메라 시야를 놓쳤다',
        // 회피형 — 자기가 못 본 것은 없었던 일로 취급한다
        personaId: 'egocentric',
        isCulprit: false,
        truth: gimTruth, claim: [...gimTruth] as Trajectory, lieSlots: [],
        lieReason: '',
        testimonies: [],
      },
    },

    /**
     * 기록 9건은 모두 독립 조사 대상이고, 현장 예산 5회로 전부 볼 수 없다 (선택이 곧 수사).
     * E8·E9 의 requires 는 V0.1 경로/solver 호환용이며 런타임은 `evidenceAccess: open`으로 무시한다.
     * 소거 목표(정본 §15): slot2 기록으로 도율·김하늘만 지워져 {류나린·배지호·문소라}가 남는다.
     * 문소라·배지호에게는 일부러 slot2 확정 기록을 주지 않았다.
     */
    evidence: [
      {
        id: 'E1', kind: 'call', slot: 0, place: 0, subjects: [], exhaustive: false, decisive: false,
        requires: [],
        note: '데스크 기록 — 20:55 해임 통지 출력, 21:30 운영위 보고 예약. 피해자는 21:15까지 통화 중이었다.',
      },
      {
        id: 'E2', kind: 'receipt', slot: 2, place: 1, subjects: ['S4'], exhaustive: false, decisive: false,
        requires: [],
        note: '외부 도착 확인 — 21:12 퇴장 기록과 이어진다.',
      },
      {
        id: 'E3', kind: 'receipt', slot: 1, place: 2, subjects: ['S3'], exhaustive: false, decisive: false,
        requires: [],
        note: '운송 상자 스캔 — 임시 위치 표식과 변경된 배치가 함께 찍혔다.',
      },
      {
        id: 'E4', kind: 'autopsy', slot: CRIME_SLOT, place: CRIME_PLACE, subjects: [], exhaustive: false,
        decisive: false, requires: [],
        // 소견 본문은 world.autopsyText 가 그린다 — 여기엔 사실만
      },
      {
        id: 'E5', kind: 'call', slot: 2, place: 1, subjects: [], exhaustive: false, decisive: false,
        requires: [],
        note: '사적 통화 기록 — 발신 위치를 고정하지 않는 회선이다. 이 기록만으로는 누구도 지울 수 없다.',
      },
      {
        id: 'E6', kind: 'receipt', slot: 3, place: 4, subjects: ['S3'], exhaustive: false, decisive: false,
        requires: [],
        note: '반입대 고정 작업 기록 — 반입대와 메인 전시홀은 최소 2분 거리다.',
      },
      {
        id: 'E7', kind: 'receipt', slot: 2, place: 3, subjects: ['S5'], exhaustive: false, decisive: false,
        requires: [],
        note: '반입문 출입 패널 점검 기록 — 21:15부터 21:19까지 이어졌다.',
      },
      {
        // 카메라 조각 — 세계에 이미 존재한다. 김하늘의 인정은 해석 경로이지 획득 열쇠가 아니다
        id: 'E8', kind: 'cctv', slot: 3, place: 2, subjects: [], exhaustive: false, decisive: false,
        requires: ['T-GIM-FRAME'],
        note: '좁은 시야 조각 — 얼굴 식별 불가. 어두운 랜야드를 건 인물이 목록대 라벨을 교체한다.',
      },
      {
        /**
         * 결정적 — **은폐 시각(21:18)의 수정 라벨 기록.**
         * 카메라 조각(E8)은 "라벨이 바뀌었다" 를, 반입대 작업 기록(E6)은
         * "그 시각 문소라는 2분 거리에 있었다" 를 준다. 둘의 연결은 Proof를 강하게 하지만,
         * E9를 획득하기 위한 순서 강제는 아니다 (V0.2 §29).
         */
        id: 'E9', kind: 'keycard', slot: 3, place: 2, subjects: ['S1'], exhaustive: false, decisive: true,
        keyLabel: 'REV-17-084 · 21:11 류나린 수정 권한 발급',
        requires: ['E8', 'E6'],
        note: '사후 라벨의 일련번호가 발급 기록과 일치한다.',
      },
    ],

    testimonies: [
      { id: 'T-BAE-NOTICE', from: 'S2', about: 'S1', text: '해임 통지의 수신자는 류나린이었다 — 관장님 책상에서 봤다.' },
      { id: 'T-DO-PLEA', from: 'S4', about: null, text: '지난 점검 누락을 고쳐 달라 부탁한 적은 있다. 그러나 당일 받침대는 정상으로 확인했다.' },
      { id: 'T-MUN-MOVED', from: 'S3', about: 'S3', text: '통로를 비우려 상자를 옮겼다. 라벨이 어긋난 건 내 탓이다.' },
      { id: 'T-GIM-FRAME', from: 'S5', about: null, text: '패널 점검 중에 잠깐 열린 카메라 시야를 놓쳤다. 그 구간의 기록이 남아 있을 것이다.' },
      { id: 'T-RYU-REV', from: 'S1', about: 'S1', text: 'REV-17-084 가 내 수정 권한으로 발급된 것은 맞다.' },
    ],

    // 선택적 제시 반응 (정본 §12). 진술을 얻지만 어떤 Evidence의 필수 획득 문도 아니다.
    presentUnlocks: [
      { evidenceId: 'E3', suspectId: 'S5', yieldsTestimonyId: 'T-GIM-FRAME' },
      { evidenceId: 'E6', suspectId: 'S5', yieldsTestimonyId: 'T-GIM-FRAME' },
      { evidenceId: 'E3', suspectId: 'S3', yieldsTestimonyId: 'T-MUN-MOVED' },
      { evidenceId: 'E8', suspectId: 'S1', yieldsTestimonyId: 'T-RYU-REV' },
    ],

    decisiveEvidenceId: 'E9',

    /**
     * 결말 오버라이드 — 자백·5단계 전부 결정론 (정본 §18 을 5단계로).
     * 페르소나 자백 템플릿은 호텔 사실(도구명)을 싣게 돼 있어 이 사건에선 쓸 수 없다 —
     * 도구명 자체가 금칙이기 때문이다.
     */
    ending: {
      confession:
        '해임 통보가 나온 날이었습니다. 21:30 보고가 올라가면 반입 기록은 더 덮을 수 없었죠. ' +
        '21:16, 메인 전시홀에서 제가 직접 했습니다 — 사고처럼 보이게 정리했고, 상자가 움직인 탓에 라벨을 새로 만들어야 했습니다. ' +
        'REV-17-084. 그 발급 기록까지 지울 권한은, 저에게 없더군요.',
      beats: [
        ['발단', '관장 한라온은 류나린의 반입 기록 조작을 확인하고 있었다. 3주에 걸친 대조가 끝나가고 있었다.'],
        ['전개', '당일 저녁 해임 통지가 출력되고 21:30 운영위 보고가 예약됐다. 류나린은 파티션으로 전시홀 시야를 가리고, 반입문을 열어 나간 듯한 기록만 남겼다.'],
        ['위기', '21:10 무렵 문소라가 예정에 없이 운송 상자를 옮겼다. 파티션이 밀려 카메라에 좁은 시야가 열렸고, 라벨은 실제 배치와 어긋났다.'],
        ['절정', '피해자가 통화 중이던 21:16, 메인 전시홀. 범행 뒤 현장은 전시 사고처럼 재배치됐고, 21:18 어긋난 라벨이 새것으로 바뀌었다.'],
        ['결말', '새 라벨에는 21:11 류나린의 권한으로 발급된 REV-17-084 가 남았다. 문소라의 반입대 작업 기록이 대리 사용 가능성마저 지웠다 — 남는 사람은 하나뿐이었다.'],
      ],
    },
  }
}
