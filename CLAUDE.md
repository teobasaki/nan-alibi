# nan-alibi

> 티어: light · 생성: 2026-08-05 · 표준: 공장 v5 ([CONVENTIONS_v5.md](../02.프로젝트_공장_표준/CONVENTIONS_v5.md))

## 문서 라우팅 (SSOT)

- 진입점: [docs/INDEX.md](docs/INDEX.md)
- 현재 상태: [docs/STATE.md](docs/STATE.md) — 세션 시작 시 훅이 자동 주입한다

## 세션 루틴 (필수)

1. **시작**: STATE.md 확인 (훅이 주입) → 필요 시 INDEX.md에서 상세 문서 탐색
2. **작업 중 — 이벤트 즉시 기록**:
   - 결정이 내려짐 → `docs/decisions/NNN-제목.md` ADR 추가 (000-템플릿 복사, 기존 ADR 수정 금지, **버린 대안** 필수)
   - 미해결 질문 발생 → `docs/QUESTIONS.md`에 추가
3. **종료**: `docs/journal/YYYY-MM-DD.md`에 오늘 한 일 append → `docs/STATE.md` 갱신 (덮어씀, "안 되는 것/막힌 것" 정직하게)

컨텍스트 압축 직후에는 훅이 지시를 주입한다 — 미기록 결정·진행·질문을 그 즉시 파일로 내려써라.

## 프로젝트 고유 규칙

(스택, 컨벤션, 금지사항을 여기에 추가)
