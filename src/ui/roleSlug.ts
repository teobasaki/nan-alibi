/**
 * 역할(job) → 에셋 slug. 사진과 3D 가 **같은 표**를 쓴다.
 * 두 곳에 따로 두면 한쪽만 고쳐서 어긋난다 (이미 한 번 그럴 뻔했다).
 */
export const SLUG_BY_JOB: Record<string, string> = {
  '호텔 지배인': 'manager',
  '보안 팀장': 'security',
  '피해자의 비서': 'secretary',
  '보석 감정사': 'appraiser',
  '투자자': 'investor',
  '전 동업자': 'expartner',
  '객실 담당': 'housekeeping',
  '피해자의 조카': 'nephew',
}
