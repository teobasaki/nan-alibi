/**
 * 역할(job) → 에셋 slug. 사진과 3D 가 **같은 표**를 쓴다.
 * 두 곳에 따로 두면 한쪽만 고쳐서 어긋난다 (이미 한 번 그럴 뻔했다).
 *
 * ⚠️ **새 월드의 직업은 반드시 이 표에 추가하라.** 매핑이 빠지면 3D 가 조용히 죽는다 —
 * gc001 에서 실제로 밟았다: 갤러리 직업 5종이 표에 없어 경찰서 탭이 사라지고
 * 취조실이 사진 폴백으로만 떴다. tests/worlds.test.ts 가 "모든 월드 직업은 매핑이 있다"
 * 를 잠근다 — 새 월드를 만들면 그 테스트가 먼저 빨간불을 켠다.
 *
 * 모델 외형(scripts/gen-characters.mjs 의 프롬프트 기준):
 *   manager 50대 남 정장 · security 40대 남 제복 · secretary 30대 여 정장 ·
 *   appraiser 30대 후반 안경 · investor 50대 남 고급 정장 · expartner 40대 남 낡은 코트 ·
 *   housekeeping 40대 여 유니폼·앞치마 · nephew 20대 남 재킷
 */
export const SLUG_BY_JOB: Record<string, string> = {
  // ── 호텔 (시드 생성 사건) ──
  '호텔 지배인': 'manager',
  '보안 팀장': 'security',
  '피해자의 비서': 'secretary',
  '보석 감정사': 'appraiser',
  '투자자': 'investor',
  '전 동업자': 'expartner',
  '객실 담당': 'housekeeping',
  '피해자의 조카': 'nephew',

  // ── GC-001 갤러리 — 이름 성별·연령과 어울리게 ──
  '전시 운영 책임자': 'secretary',    // 류나린(41·여) — 정장 여성
  '부큐레이터': 'nephew',             // 배지호(33·남) — 젊은 남성
  '작품 운송 담당': 'housekeeping',   // 문소라(38·여) — 작업 유니폼
  '작품 보존 담당': 'appraiser',      // 도율(52·남) — 안경 낀 전문가
  '야간 보안 담당': 'security',       // 김하늘(29) — 제복이 직군을 말한다

  // ── 월드 팩: 단원 경매장 ──
  '경매 진행인': 'manager',
  '감정 보조': 'appraiser',
  '기록 담당': 'secretary',
  '수장고 관리': 'expartner',
  '야간 경비': 'security',

  // ── 월드 팩: 한내 방송사 ──
  '프로듀서': 'expartner',
  '진행자': 'investor',
  '음향 기사': 'nephew',
  '구성 작가': 'secretary',
  '경비원': 'security',

  // ── 월드 팩: 백야 극장 ──
  '극단 대표': 'manager',
  '주연 배우': 'nephew',
  '무대 감독': 'expartner',
  '의상 담당': 'housekeeping',
  '매표 담당': 'secretary',
}
