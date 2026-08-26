# GC-001 Hypothesis 중심 구현 명세 V0.2

## 0. 문서 목적

본 문서는 앞서 공유한 **Core Loop 변경안에 대한 구현 명세**이다.

기존 QA 피드백 문서와는 별개로 관리한다.

QA 피드백은 현재 구현의 UI/UX/연출/사용성 개선을 다루고, 본 문서는 GC-001의 핵심 플레이 루프를 다음 방향으로 변경하기 위한 개발 기준을 정의한다.

```text
Evidence Unlock 중심
→
Question / Hypothesis / Verification / Proof 중심
```

본 문서부터는 방향 제안이 아니라 **구현 기준**으로 사용한다.

---

# 1. 변경 목표

## 기존 구조

```text
질문
→ 정해진 진술 획득
→ Evidence 해금
→ 특정 Evidence를 특정 인물에게 제시
→ 다음 Evidence 해금
→ 결정적 Evidence 획득
→ 범인 판정
```

## 변경 구조

```text
질문 / 조사
→ Claim · Fact · Evidence 획득
→ 정보 비교
→ 의문 발생
→ Hypothesis 형성
→ 추가 조사 / 심문
→ Hypothesis 강화 · 반박 · 수정
→ 근거 연결
→ Proof 구성
→ 범인 입증
```

핵심 목표는 다음과 같다.

> **플레이어에게 다음 정답을 해금시키는 것이 아니라, 다음 질문이 생기게 만든다.**

그리고

> **Evidence를 얻어서 범인을 발견하는 것이 아니라, Evidence와 증언을 연결해 자신의 범인 가설을 증명한다.**

---

# 2. 변경하지 않는 영역

GC-001의 사건 Truth는 변경하지 않는다.

- 범인: 류나린
- 사건 시각: 21:16
- 범행 방식: 고의적 직접 물리력
- 사건 전말
- 인물별 실제 행동
- 인물별 숨긴 사실
- 기존 Evidence의 객관적 내용
- 사건 Timeline

기존 GC-001에서도 류나린이 21:04 실제로 통과한 것이 아니라 문만 연 사실, 문소라의 21:09 상자 이동, 21:18 반입대 작업, 같은 시각의 라벨 변경 등이 이미 Locked Truth로 구성되어 있다.

변경하는 것은 **이 Truth를 플레이어가 알아내고 증명하는 방식**이다.

---

# 3. 핵심 구현 원칙

1. 사건의 Truth는 항상 고정한다.
2. AI는 새로운 사건 Fact, Evidence, 범인, 동기, 알리바이를 생성하지 않는다.
3. Evidence는 NPC 대화를 통해 생성되지 않는다.
4. Evidence는 사건 세계에 처음부터 존재하며 플레이어가 발견한다.
5. Claim은 Fact로 취급하지 않는다.
6. NPC가 거짓말했다고 시스템이 즉시 플레이어에게 알려주지 않는다.
7. 심문의 성공 조건을 `NEW EVIDENCE 획득`으로 정의하지 않는다.
8. 플레이어는 결정적 Evidence를 얻기 전에도 범인 Hypothesis를 세울 수 있다.
9. 범인을 의심하는 것과 범인을 입증하는 것을 분리한다.
10. 최종 판정은 단일 Decisive Evidence가 아니라 Proof Proposition 조합으로 처리한다.
11. 같은 사건 Truth에 도달하는 Proof Path를 최소 2개 제공한다.
12. 비범인의 비밀은 핵심 진행을 여는 필수 Key로 사용하지 않는다.
13. 조사 순서가 달라도 동일한 사건 Truth에 도달할 수 있어야 한다.

---

# 4. 기존 진행 제한 폐기

기존 Golden Case의 다음 규칙은 신규 플레이 진행 제한으로 사용하지 않는다.

```text
actionBudget: 6
maxFreeQuestions: 2
6-action Canonical Solution Path
```

기존 데이터에 해당 값이 남아 있다면 Legacy 필드로 처리하거나 신규 플레이 로직에서 참조하지 않는다.

신규 심문 제한은 다음 정책으로 통일한다.

> **각 용의자별 최대 10회 질문**

---

# 5. 질문 횟수 정책

각 용의자는 최대 10회까지 심문할 수 있다.

## 질문 횟수 차감

플레이어가 질문을 제출하고 시스템이 정상적인 NPC 응답을 반환했다면 **1회를 차감한다.**

질문의 품질은 차감 여부에 영향을 주지 않는다.

따라서 다음 질문도 모두 1회 차감한다.

- 추리에 도움이 되지 않는 질문
- 사건과 관련성이 낮은 질문
- 모호한 질문
- 이미 물어본 질문
- NPC가 답을 모르는 질문
- 플레이어가 잘못된 가정을 전제로 한 질문
- 결과적으로 새로운 정보를 얻지 못한 질문

예:

```text
플레이어 질문 제출
↓
NPC: "그 부분은 제가 알 수 없습니다."
↓
질문 횟수 -1
```

이는 정상적인 게임 행동의 결과이다.

## 질문 횟수 차감하지 않음

다음처럼 **시스템 문제 때문에 정상적인 응답 자체가 제공되지 않은 경우**에는 차감하지 않는다.

- 네트워크 오류
- AI API 오류
- 서버 오류
- Persona Adapter timeout
- malformed response
- 응답 Validator 실패 후 fallback도 실패
- 기타 시스템 오류

기준은 다음과 같다.

```text
잘못된 질문
= 플레이어의 선택
= 비용 발생

시스템 실패
= 플레이어 책임 아님
= 비용 발생 X
```

---

# 6. 전체 시스템 구조

```text
CASE TRUTH
     ↓
   CLUE
     ↓
INVESTIGATION QUESTION
     ↓
 HYPOTHESIS
     ↓
PROOF PROPOSITION
     ↓
FINAL VERDICT
```

Persona AI는 Truth 구조를 결정하지 않는다.

```text
PLAYER QUESTION
      ↓
QUESTION INTENT
      ↓
RULE ENGINE
      ↓
허용 Claim / Fact 결정
      ↓
PERSONA AI
      ↓
자연어 응답
```

---

# 7. Clue 통합 모델

추리에 사용하는 정보를 `Clue`라는 상위 개념으로 취급한다.

```ts
type ClueType =
  | "CLAIM"
  | "FACT"
  | "EVIDENCE";
```

## CLAIM

인물이 한 말.

예:

```text
류나린
"21시 4분에 반입문으로 나갔습니다."
```

Claim 자체는 Truth가 아니다.

---

## FACT

객관적으로 확정된 사건 정보.

예:

```text
21:04
류나린의 배지로 반입문이 열렸다.

단, Door Open Event는
실제 통과를 의미하지 않는다.
```

실제 Golden Case에서도 21:04 기록은 문 열림만 의미하며 실제 통과를 증명하지 않는다.

---

## EVIDENCE

플레이어가 조사 가능한 기록·물리 정보.

기존 GC-001의 주요 Evidence는 그대로 유지한다.

- `E-GC001-01-DESK-RECORDS`
- `E-GC001-02-PLINTH-CONDITION`
- `E-GC001-03-CRATE-MOVE`
- `E-GC001-04-STAFF-TIMELINE`
- `E-GC001-05-CAMERA-SLICE`
- `E-GC001-06-REVISION-SEAL`

기존에는 이 Evidence들이 질문과 증거 제시의 순차적 Reveal 대상으로 사용됐다.

V0.2에서는 이 역할을 변경한다.

---

# 8. Evidence 상태

Evidence는 NPC가 생성하지 않는다.

사건 시작 시 World에 존재한다.

```ts
type EvidenceState =
  | "AVAILABLE"
  | "DISCOVERED"
  | "UNDERSTOOD";
```

## AVAILABLE

사건 세계에는 존재하지만 플레이어가 아직 발견하지 않음.

## DISCOVERED

플레이어가 기록·증거를 확보함.

## UNDERSTOOD

플레이어가 관련 정보와 비교하거나 세부 내용을 확인하여 의미를 파악함.

중요:

```text
NPC A 심문
→ E03 생성
```

같은 구조를 핵심 Evidence에 사용하지 않는다.

---

# 9. 심문의 역할

심문은 Evidence Generator가 아니다.

심문의 결과는 다음 중 하나 이상일 수 있다.

- 새로운 Claim 획득
- 기존 Claim 구체화
- 특정 시간·장소 정보 획득
- 다른 사람 언급
- 기존 Claim 수정
- 기존 Hypothesis 강화
- 기존 Hypothesis 약화
- 새로운 의문 발생
- Red Herring 해소
- 아무 새로운 정보를 얻지 못함

따라서

```text
NEW EVIDENCE 없음
=
심문 실패
```

가 아니다.

---

# 10. Question Intent

자유 질문은 정확한 문장 Match가 아니라 의미 단위 Intent로 처리한다.

GC-001에서는 다음 Intent를 사용한다.

| Intent | 의미 |
|---|---|
| `ASK_RELATIONSHIP` | 피해자와의 관계 |
| `ASK_TIMELINE` | 사건 당일 전체 행적 |
| `ASK_LOCATION_AT_TIME` | 특정 시각의 위치 |
| `ASK_DEPARTURE` | 퇴장·재입장 |
| `ASK_CRATE_MOVEMENT` | 운송 상자 이동 |
| `ASK_CAMERA_STATUS` | 카메라 상태 |
| `ASK_ACCESS_PANEL` | 반입문·출입 기록 |
| `ASK_PLINTH_CONDITION` | 받침대 상태 |
| `ASK_LABEL_CHANGE` | 라벨 변경 |
| `ASK_REVISION_PERMISSION` | Revision 권한 |
| `ASK_PRIVATE_ACTIVITY` | 개인 행동 |
| `ASK_REASON_FOR_LIE` | 기존 진술이 달라진 이유 |
| `CHALLENGE_CLAIM` | 기존 Claim 추궁 |
| `PRESENT_CLUE` | 특정 Clue를 근거로 질문 |

예:

```text
"9시 4분에 진짜 나간 겁니까?"

"21시 4분 이후 밖에 있었습니까?"

"반입문으로 실제 나간 게 맞아요?"
```

모두:

```text
ASK_DEPARTURE
```

로 해석할 수 있다.

---

# 11. Intent 결과

```ts
type QuestionIntentResult = {
  intent: QuestionIntent;
  subjectId?: string;
  time?: string;
  referencedClueIds?: string[];
  confidence: number;
};
```

Intent Interpreter의 역할은 여기까지다.

게임 Truth를 판단하지 않는다.

---

# 12. Intent 인식이 불완전한 질문

질문이 애매하거나 시스템이 의도를 완벽히 파악하지 못해도, Persona가 정상적인 응답을 제공했다면 질문 횟수는 차감한다.

예:

```text
PLAYER
"그때 그거 어떻게 된 거예요?"

NPC
"어떤 일을 말씀하시는 건지 정확히 모르겠습니다."
```

정상적인 게임 응답이므로:

```text
질문 횟수 -1
```

Intent 해석 실패 자체를 플레이어에게 무료 Retry로 제공하지 않는다.

단, 기술적 오류로 응답 자체가 생성되지 않았다면 차감하지 않는다.

---

# 13. Claim 상태

```ts
type ClaimState =
  | "KNOWN"
  | "QUESTIONABLE"
  | "CHALLENGED"
  | "REVISED"
  | "CONFIRMED"
  | "DISPROVED";
```

## KNOWN

NPC에게서 해당 진술을 들었다.

Truth 여부는 알 수 없다.

## QUESTIONABLE

다른 Clue와 충돌할 가능성이 생겼다.

시스템은 `거짓말`이라고 확정하지 않는다.

## CHALLENGED

플레이어가 해당 Claim을 직접 재질문하거나 관련 Clue를 근거로 추궁했다.

## REVISED

NPC가 기존 Claim을 변경하거나 구체화했다.

## CONFIRMED

객관적인 Fact/Evidence와 일치한다.

## DISPROVED

객관 정보와 양립할 수 없다.

---

# 14. Claim 상태 전이

```text
KNOWN
 │
 ├── 객관 정보와 일치
 │        ↓
 │    CONFIRMED
 │
 └── 충돌 가능 정보 발견
          ↓
     QUESTIONABLE
          ↓
      플레이어 추궁
          ↓
      CHALLENGED
       ↙       ↘
   REVISED   DISPROVED
```

`QUESTIONABLE → CHALLENGED`는 자동으로 처리하지 않는다.

플레이어가 행동해야 한다.

---

# 15. 기존 Claim 유지

NPC가 말을 바꿨다고 기존 Claim을 삭제하지 않는다.

예:

```text
[기존]
"상자를 옮기지 않았습니다."

[이후]
"사실 통로를 비우기 위해 잠깐 옮겼습니다."
```

수사일지에는 두 Claim을 모두 남긴다.

```text
초기 Claim
↓
변경된 Claim
```

이 변화 자체가 추리 정보다.

---

# 16. Persona Knowledge Rule

```ts
type PersonaKnowledgeRule = {
  suspectId: string;
  intent: QuestionIntent;

  baseClaimIds?: string[];
  availableFactIds?: string[];

  defensiveClaimIds?: string[];
  revisedClaimIds?: string[];

  requiredContextIds?: string[];

  reaction?: PersonaReaction;
};
```

Rule Engine이 현재 상황에서 Persona가 말할 수 있는 내용을 결정한다.

AI는 해당 범위 안에서 자연스러운 문장만 생성한다.

---

# 17. 류나린 예시

초기 Claim:

```text
CLM-GC001-RYU-LEFT

"21시 4분에 반입문으로 나갔습니다."
```

기존 GC-001에서도 류나린은 이를 초기 진술로 주장한다.

초기 상태:

```text
KNOWN
```

출입 기록을 확인하면:

```text
KNOWN
→ QUESTIONABLE
```

플레이어:

```text
"문이 열린 기록뿐인데
실제로 밖으로 나갔다는 걸 어떻게 증명합니까?"
```

→

```text
CHALLENGE_CLAIM
```

Claim:

```text
CHALLENGED
```

류나린이 여기서 범행을 인정할 필요는 없다.

심문의 목적은 자백 획득이 아니라 **퇴장 가설을 검증하는 것**이다.

---

# 18. 문소라 예시

초기 Claim:

```text
CLM-GC001-MUN-NO-MOVE

"폐관 뒤에는 운송 상자를 옮기지 않았습니다."
```

실제 원본에서는 문소라가 21:09 상자를 이동하고, 21:10 임시 표식을 남겼으며 이를 숨긴다.

E03 발견:

```text
KNOWN
→ QUESTIONABLE
```

플레이어가 E03을 근거로 재질문:

```text
CHALLENGED
```

이후 Truth Claim:

```text
CLM-GC001-MUN-MOVED
```

기존 Claim:

```text
DISPROVED
```

새 Claim:

```text
REVISED
```

문소라의 비밀을 밝히는 보상은 새로운 핵심 Evidence Unlock이 아니다.

> 왜 문소라가 거짓말했는지 이해하고, 범행과 무관한 거짓말일 가능성을 판단하는 것

이 보상이다.

---

# 19. 김하늘 예시

초기 Claim:

```text
CLM-GC001-GIM-BLOCKED

"21시 이후 카메라는 완전히 가려져
아무 장면도 남지 않았습니다."
```

카메라 기록 발견:

```text
KNOWN
→ QUESTIONABLE
```

재심문:

```text
CHALLENGED
```

Truth Claim:

```text
CLM-GC001-GIM-MISSED-FRAME
```

기존 GC-001에서도 김하늘은 패널 점검 중 열린 카메라 frame을 놓친 사실을 숨긴다.

이 과정에서 E05를 새로 생성하지 않는다.

E05는 별도의 조사 대상으로 이미 존재한다.

---

# 20. Investigation Question

GC-001 내부 수사 구조에는 다음 Investigation Question을 정의한다.

```text
IQ01
정말 사고였는가?

IQ02
사건은 언제 발생했는가?

IQ03
류나린은 정말 21:04에 나갔는가?

IQ04
문소라는 왜 상자를 옮겼는가?

IQ05
카메라는 정말 계속 가려져 있었는가?

IQ06
21:18 라벨을 바꾼 사람은 누구인가?

IQ07
배지호는 무엇을 숨기고 있는가?

IQ08
도율은 무엇을 숨기고 있는가?
```

이 목록은 내부 수사 구조다.

플레이어에게 Quest 목록처럼 자동 제공하지 않는다.

---

# 21. Hypothesis

```ts
type HypothesisStatus =
  | "DRAFT"
  | "SUPPORTED"
  | "CONTESTED"
  | "DISPROVED"
  | "PROVEN";

type Hypothesis = {
  id: string;
  subjectId?: string;
  proposition: string;

  supportClueIds: string[];
  counterClueIds: string[];

  proofPropositionIds: string[];

  status: HypothesisStatus;
};
```

예:

```text
HYP-GC001-RYU-STAYED

"류나린은 21:04 실제로 퇴장하지 않았을 수 있다."
```

Support:

```text
류나린 퇴장 Claim
+
Door Open Event는 통과를 증명하지 않는다는 Fact
```

이 Hypothesis 자체는 범인 Proof가 아니다.

---

# 22. 현재 의심 인물

플레이어는 수사 도중 언제든 현재 의심 인물을 직접 표시할 수 있다.

예:

```text
현재 가장 의심되는 인물

● 류나린
○ 배지호
○ 문소라
○ 도율
○ 김하늘
```

이 선택은 정답 제출이 아니다.

```text
CURRENT HYPOTHESIS
```

일 뿐이다.

새로운 정보를 얻은 뒤 플레이어가 의심 인물을 자유롭게 변경할 수 있어야 한다.

---

# 23. Player-facing Fact 추가

현재 Golden Case 내부 규칙 중 실제 추리에 필요한 정보를 플레이어가 확인할 수 있는 Fact로 승격한다.

## F-GC001-REVISION-OPERATOR-SCOPE

```text
정식 라벨 Revision Mode 사용 가능 담당자

- 류나린
- 문소라
```

기존 Golden Case에서도 전시 운영 담당과 운송 담당만 Revision Mode를 사용할 수 있도록 이미 정의되어 있다.

---

## F-GC001-MAIN-LOADING-TRAVEL-TIME

```text
메인 전시홀 ↔ 고정 반입대

최소 이동 시간:
2분
```

이 규칙 역시 기존 사건 내부에 이미 존재한다.

시스템이 자동으로 결론을 알려주지 않는다.

플레이어가 이 Fact를 다른 기록과 연결해야 한다.

---

# 24. Proof Proposition

최종 판정은 특정 Evidence ID가 아니라 **증명된 명제**를 기준으로 한다.

```ts
type ProofProposition = {
  id: string;
  statement: string;
  supportRules: SupportRule[];

  state:
    | "UNKNOWN"
    | "SUPPORTED"
    | "PROVEN";
};
```

---

# 25. GC-001 Proof Proposition

## PROP-01

**사건은 단순한 전시물 사고가 아니다.**

Support:

```text
20:40 받침대 정상
+
사건 후 상태 변화
```

---

## PROP-02

**21:18 메인홀에서 누군가 라벨을 교체했다.**

Support:

```text
E-GC001-05-CAMERA-SLICE
```

---

## PROP-03

**21:18 정식 라벨 변경 가능 인물은 제한되어 있다.**

Support Route A:

```text
F-GC001-REVISION-OPERATOR-SCOPE
```

Support Route B:

```text
REV-17 관련 권한 기록
```

---

## PROP-04

**문소라는 21:18 메인홀 라벨 변경자가 될 수 없다.**

Support:

```text
21:18 문소라 고정 반입대 작업
+
메인홀 ↔ 반입대 최소 이동시간 2분
```

---

## PROP-05

**21:18 라벨 변경자는 류나린이다.**

Derivation:

```text
PROP-02
+
PROP-03
+
PROP-04
```

---

## PROP-06

**류나린에게 범행 기회가 존재한다.**

Support:

```text
21:04 Door Open Event
≠
실제 퇴장

+
범행 시간
```

---

## PROP-07

**류나린에게 사건 은폐 동기가 존재한다.**

Support:

```text
해임 통지
+
21:30 운영위원 보고 예정
```

동기는 강한 Support이지만 범인 Proof의 필수조건으로 사용하지 않는다.

```text
동기 존재
≠
범인 증명
```

---

# 26. 범인 Proof 기준

류나린을 최종적으로 입증하려면 최소 다음 두 축이 필요하다.

```text
범행 기회
+
범행 후 은폐 행동과 류나린 연결
```

즉 최소:

```text
PROP-05
+
PROP-06
```

을 충족해야 한다.

---

# 27. Proof Path A — Serial 중심

기존 Golden Case와 가장 가까운 경로.

```text
21:18 카메라 라벨 변경
+
REV-17-084
+
문소라 21:18 위치
↓
류나린
```

기존 사건에서 E06은 류나린을 직접 지지하지만, 문소라의 대리 사용 가능성 때문에 단독 확정은 되지 않는다.

이 논리는 그대로 유지한다.

---

# 28. Proof Path B — 권한·위치 중심

두 번째 정상 클리어 경로.

```text
21:18 라벨 변경
+
Revision 가능 인물
= 류나린 / 문소라
+
문소라 21:18 반입대 작업
+
최소 이동시간 2분
↓
문소라 제외
↓
류나린
```

이 Path에서는 `REV-17-084` Serial을 반드시 발견하지 않아도 된다.

즉:

```text
E06 미발견
=
게임 진행 불가
```

가 되어서는 안 된다.

---

# 29. REV-17의 역할 변경

기존:

```text
REV-17
=
Decisive Evidence
=
최종 정답 Evidence
```

신규:

```text
REV-17
=
류나린 Hypothesis와
Revision 관련 Proposition을
강하게 지지하는 Clue
```

매우 좋은 Evidence지만 **유일한 정답 Key는 아니다.**

---

# 30. 불완전한 Proof

다음은 범인 Proof로 인정하지 않는다.

## Case A

```text
류나린 해임 동기
+
21:04 퇴장 의심
```

결과:

```text
수상함
≠
증명
```

---

## Case B

```text
E05 CAMERA SLICE
```

결과:

> 은폐 행동 존재는 확인하지만 행위자 특정 불가.

---

## Case C

```text
E06 REVISION SEAL
```

결과:

> 류나린을 강하게 지지하지만 문소라 대리 가능성이 남음.

---

## Case D

```text
문소라의 거짓말
+
상자 이동
```

결과:

> 문소라가 거짓말했다는 사실은 확인하지만 살인과 연결되지 않음.

---

# 31. 최종 제출 구조 변경

기존:

```text
범인
+
범행 방식
+
결정적 Evidence 1개
```

변경:

## 1. 범인

5명 중 한 명 선택

## 2. 범행 방식

Method 선택

## 3. 추론 근거

확보한 Clue 중 2~4개 선택

그리고 Clue 사이의 연결 관계를 제출한다.

예:

```text
21:18 라벨 교체
      ↓
Revision 가능 인물
류나린 / 문소라
      ↓
문소라 21:18 반입대
      ↓
류나린
```

최종적으로 시스템은

> 어떤 Evidence를 골랐는가

보다

> 해당 Evidence와 Fact의 연결로 어떤 Proposition이 성립했는가

를 판정한다.

---

# 32. Submission 데이터

```ts
type DeductionSubmission = {
  culpritId: string;
  methodId: string;

  selectedClueIds: string[];

  connections: {
    fromId: string;
    toId: string;
  }[];
};
```

---

# 33. Proof Validator

Validator 처리 순서:

```text
1. 제출된 Clue 확인

2. Clue 간 Connection 확인

3. 각 Proposition의 Support Rule 평가

4. Proof Proposition 생성

5. Proposition 간 추론 Closure 계산

6. Culprit Proof 확인

7. Method Proof 확인

8. Verdict 반환
```

AI는 판정 과정에 참여하지 않는다.

---

# 34. Verdict

```ts
type Verdict =
  | "PROVEN"
  | "CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE"
  | "METHOD_UNPROVEN"
  | "CONTRADICTORY_PROOF"
  | "UNPROVEN";
```

## PROVEN

범인과 Method 모두 충분히 입증.

## CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE

선택한 인물에 대한 추론은 가능하지만 다른 후보를 제거하지 못함.

플레이어 문구 예:

> 현재 추론만으로는 다른 가능성이 남아 있습니다.

## METHOD_UNPROVEN

범인 Proof는 충분하지만 범행 방식 Proof 부족.

## CONTRADICTORY_PROOF

서로 양립하지 않는 정보를 동시에 근거로 사용.

## UNPROVEN

선택 인물과 범행을 연결할 충분한 논리가 없음.

정답을 직접 알려주지 않는다.

---

# 35. Persona AI 처리

```text
PLAYER QUESTION
↓
Question Intent
↓
Rule Engine
↓
Allowed Response Payload
↓
Persona AI
↓
자연어 응답
↓
TTS(optional)
```

예:

```ts
{
  speakerId: "S-GC001-MUN-SORA",

  claimIds: [
    "CLM-GC001-MUN-MOVED"
  ],

  reaction: "ANXIOUS",

  forbiddenFactIds: [
    "F-GC001-CULPRIT"
  ]
}
```

Persona AI의 역할은 **표현**이다.

사건 Fact나 게임 진행 조건을 결정하지 않는다.

---

# 36. 수사일지 연동

Hypothesis 구조에 맞춰 수사일지는 다음을 지원해야 한다.

- Claim 확인
- 변경된 Claim 확인
- Fact 확인
- Evidence 확인
- Timeline 비교
- 관련 Clue 연결
- 현재 의심 인물 표시
- 플레이어 메모
- 추론 근거 선택
- 최종 Proof 구성

시스템이 자동으로

```text
"류나린이 거짓말했다"
```

또는

```text
"문소라는 범인이 아니다"
```

라고 결론내리지 않는다.

판단은 플레이어에게 맡긴다.

---

# 37. 기존 데이터 Migration

## 유지

- Locked Truth
- Event Timeline
- Suspect
- Claim
- Evidence 내용
- Contradiction의 객관적 관계
- Persona
- Reaction
- Fallback 응답

## 제거 또는 신규 플레이에서 미사용

```text
actionBudget: 6
maxFreeQuestions: 2
Canonical Solution Path 비용
특정 Evidence → 다음 Evidence 필수 Unlock
```

## 신규 추가

- `Clue`
- `EvidenceState`
- `ClaimState`
- `QuestionIntent`
- `InvestigationQuestion`
- `Hypothesis`
- `ProofProposition`
- `SupportRule`
- `DeductionSubmission`
- `Proof Validator`
- Player-facing Revision Operator Fact
- Player-facing Zone Travel Time Fact

---

# 38. Acceptance Criteria

## AC-01

각 용의자는 최대 10회 질문 가능하다.

---

## AC-02

잘못되거나 도움이 되지 않는 질문이라도 정상 NPC 응답이 반환되었다면 질문 횟수가 1회 차감된다.

---

## AC-03

네트워크·AI·서버 오류 등 시스템 문제로 정상 응답이 제공되지 않은 경우 질문 횟수를 차감하지 않는다.

---

## AC-04

김하늘에게 E03을 반드시 제시하지 않아도 카메라 조사로 E05를 발견할 수 있다.

---

## AC-05

류나린에게 E05를 반드시 제시하지 않아도 Revision 관련 정보를 다른 조사 경로로 확인할 수 있다.

---

## AC-06

`REV-17-084`를 발견하지 않은 플레이어도 Proof Path B로 사건을 입증할 수 있다.

---

## AC-07

문소라의 거짓말 해소가 모든 플레이의 필수 진행 Key가 되어서는 안 된다.

단, 플레이어가 선택한 Proof Path에서 문소라 위치 배제가 필요하다면 해당 Fact는 확보해야 한다.

---

## AC-08

류나린을 범인으로 선택했다고 즉시 정답 처리하지 않는다.

Proof가 부족하면:

```text
CULPRIT_PLAUSIBLE_PROOF_INCOMPLETE
```

또는 적절한 Unproven Verdict를 반환한다.

---

## AC-09

류나린에게 자백을 받지 않아도 객관적인 Clue와 Proof만으로 클리어할 수 있다.

---

## AC-10

심문을 통해 Evidence Unlock 없이도 유의미한 정보를 얻을 수 있다.

---

## AC-11

NPC가 모든 질문에 반복적으로

```text
모릅니다.
기억나지 않습니다.
말할 수 없습니다.
```

만 답하면서 사건 진행이 막히지 않는다.

인물이 실제로 알고 있으며 숨길 이유가 없는 일반 사실은 정상적으로 제공한다.

---

## AC-12

Claim과 객관 정보가 충돌해도 플레이어가 비교하기 전 시스템이 자동으로 범인성이나 거짓말 여부를 확정하지 않는다.

---

## AC-13

AI가 실패해도 규칙 기반 Fallback으로 사건을 계속 진행할 수 있다.

---

## AC-14

플레이어 A와 플레이어 B의 조사 순서가 달라도 Locked Truth는 동일하다.

---

## AC-15

최소 두 개의 서로 다른 Proof Path가 실제 테스트에서 `PROVEN`에 도달한다.

```text
Proof A
Serial 중심

Proof B
Revision 권한 + 위치 중심
```

---

# 39. 구현 시 금지 사항

다음 구조를 핵심 사건 진행에 다시 도입하지 않는다.

### 금지 1

```text
Evidence A 획득
→ Evidence B 생성
```

### 금지 2

```text
정확한 Evidence를
정확한 NPC에게 제시
→ 다음 핵심 단계
```

### 금지 3

```text
REV-17 발견
→ 범인 자동 확정
```

### 금지 4

```text
Claim과 Evidence 충돌
→ 시스템 자동 거짓말 판정
```

### 금지 5

```text
AI가 대화 상황을 보고
새로운 사건 Fact 생성
```

### 금지 6

```text
플레이어의 잘못된 질문
→ 무료 Retry
```

잘못된 질문도 정상적인 심문 행동이며 질문 횟수를 소비한다.

---

# 40. 기대 플레이 예시

## 플레이어 A

```text
문소라 심문
↓
상자 기록 확인
↓
문소라 Claim 의심
↓
카메라 확인
↓
21:18 라벨 변경 발견
↓
Revision 가능 인물 확인
↓
문소라 21:18 위치 확인
↓
류나린 가설
↓
거짓 퇴장 검증
↓
Proof
```

---

## 플레이어 B

```text
류나린 심문
↓
21:04 퇴장 주장
↓
출입 기록 확인
↓
퇴장 가설 의심
↓
카메라 확인
↓
Revision 권한 확인
↓
문소라 위치 비교
↓
류나린 가설 강화
↓
Proof
```

---

## 플레이어 C

```text
도율 심문
↓
받침대 사고설 검증
↓
사고설 약화
↓
배지호 심문
↓
해임 정보 확인
↓
류나린 동기 가설
↓
카메라 / 직원 위치 조사
↓
류나린 범인 가설
↓
Proof
```

세 플레이어가 서로 다른 순서와 정보 흐름으로 사건을 이해할 수 있어야 한다.

최종 사건 Truth는 동일하다.

---

# 41. 구현 기준 문장

구현 과정에서 판단이 필요한 경우 아래 두 문장을 기준으로 한다.

> **플레이어에게 다음 정답을 해금시키지 않는다. 플레이어에게 다음 질문이 생기게 만든다.**

> **Evidence를 얻어서 범인을 발견하는 것이 아니라, Evidence와 증언을 연결해 자신의 범인 가설을 증명한다.**

이 원칙과 충돌하는 기능은 기존 구현을 그대로 유지하지 않고 재검토한다.