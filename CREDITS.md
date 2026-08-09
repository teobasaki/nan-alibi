# 외부 에셋 · 오픈소스 출처

NAN 2026 제출 규정에 따라 외부 에셋의 출처와 라이선스를 명시한다.

> **미확인 항목이 있다.** 확인되지 않은 것을 확인된 것처럼 적지 않는다 —
> 아래 “확인 필요” 표의 항목은 마감 전에 원본 페이지 URL과 라이선스를 채워야 하며,
> 채우지 못하면 해당 에셋을 교체하거나 제거한다.

## 확인 필요 — 3D 에셋 (Sketchfab)

취조실 1점과 기성 리깅 캐릭터 3종을 Sketchfab 에서 받아 사용했다.
현재 저장소에 **원본 페이지 URL과 라이선스 표기가 남아 있지 않다.**
다운로드 이력에서 회수해 아래 표를 채운다.

| 에셋 | 저장소 경로 | 원본 URL | 저작자 | 라이선스 |
|---|---|---|---|---|
| 캐릭터 — 비서 | `public/characters/secretary.opt.glb` | (확인 필요) | (확인 필요) | (확인 필요) |
| 캐릭터 — 하우스키핑 | `public/characters/housekeeping.opt.glb` | (확인 필요) | (확인 필요) | (확인 필요) |
| 캐릭터 — 조카 | `public/characters/nephew.opt.glb` | (확인 필요) | (확인 필요) | (확인 필요) |
## 확인 완료 — 3D 에셋

| 에셋 | 저장소 경로 | 원본 | 저작자 | 라이선스 |
|---|---|---|---|---|
| **취조실** | `public/room/room.opt.glb` | ["Interrogation Room"](https://sketchfab.com/3d-models/interrogation-room-56def55221f64eaebd1c05738269d81f) | **Jamie McFarlane** ([@jamiemcfarlane](https://sketchfab.com/jamiemcfarlane)) | **CC BY 4.0** |
| **수첩 (모델 + 가죽·종이 텍스처)** | `public/nb/journal.opt.glb` · `public/nb/leather.webp` · `public/nb/paper.webp` | ["A writer's journal"](https://sketchfab.com/3d-models/a-writers-journal-673dee6a48924080b1237f0f09eb4572) | **Valeria Gerontopoulos** ([@vgerontopoulos](https://sketchfab.com/vgerontopoulos)) | **CC BY 4.0** |

> **"Interrogation Room"** by **Jamie McFarlane** is licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 원저작물을 변형해 사용했다.
>
> **"A writer's journal"** by **Valeria Gerontopoulos** is licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). 원저작물을 변형해 사용했다.

**취조실 변형 내역:** 블렌더 헤드리스로 좌표계를 실측 정규화하고, `gltf-transform` 으로
Draco + WebP 압축했다(`scripts/`). 조명·재질은 런타임(`src/ui/stage3d.ts`)에서 다시 잡는다.

**수첩 변형 내역 (CC BY 4.0 은 변형을 허용하되 표시를 권한다):**
두 가지로 쓴다.
1. **텍스처** — 원본 GLB 의 baseColor 아틀라스에서 가죽 구역과 종이 구역을 잘라내
   거울 타일로 재구성하고 WebP 로 압축했다. DOM 수첩의 표면이다.
2. **모델** — `gltf-transform optimize` 로 텍스처 1024·WebP, Draco 압축했다
   (2.62MB → 308KB). 수사가 시작될 때 **1.1초 한 번** 화면에 선다
   (`src/ui/journal3d.ts`). 조명은 런타임에서 다시 잡는다.

상업 이용 허용 · 저작자 표기 필수 — 둘 다 충족한다.

`stylized_journal_book.glb` 는 검토했으나 **채택하지 않았고 저장소에 포함하지 않는다.**
(같은 닫힌 책이고 텍스처가 8MB 로 무거워, 펼쳐진 이 수첩이 은유에 더 맞았다.)

CC-BY 계열이면 저작자 표기로 충족된다. NC(비상업)·ND(변경 금지) 조건이면
**변형(리깅 수정·포즈·최적화)을 했으므로 재검토가 필요하다.**

## 생성 에셋 — 저작권이 이쪽에 있는 것

| 에셋 | 생성 도구 | 비고 |
|---|---|---|
| 캐릭터 5종 (`manager` · `security` · `investor` · `expartner` · `appraiser`) | Meshy (multi-image-to-3d + rigging) | 레퍼런스 이미지는 OpenAI `gpt-image-2` 로 생성 |
| 인물 레퍼런스 이미지 (`public/refs/`, `docs/refs/`) | OpenAI `gpt-image-2` | 3D 생성 입력용 |
| 인트로 · 엔딩 패널 (`public/intro/`, `public/outro/`) | OpenAI 이미지 생성 | 그림이 없어도 색면 폴백으로 동작 |
| 효과음 | Web Audio API 합성 (`src/ui/sound.ts`) | 외부 음원 파일 없음 |
| 음성 | Web Speech API (브라우저 내장) | 외부 TTS API 미사용 |

## 오픈소스

| 패키지 | 용도 | 라이선스 |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | 3D 심문실 렌더링 | MIT |
| [Vite](https://github.com/vitejs/vite) | 번들러 · 개발 서버 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 테스트 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 언어 | Apache-2.0 |
| [gltf-transform](https://github.com/donmccurdy/glTF-Transform) | glTF 최적화 (Draco · WebP) | MIT |
| [Draco](https://github.com/google/draco) 디코더 | 런타임 메시 압축 해제 (gstatic CDN) | Apache-2.0 |

정확한 버전은 [`package.json`](package.json) 과 `package-lock.json` 에 있다.

## 외부 서비스

| 서비스 | 용도 |
|---|---|
| OpenAI API | 용의자 페르소나 대사 생성 (런타임) · 레퍼런스 이미지 생성 (제작 시) |
| Meshy API | 3D 캐릭터 생성 및 리깅 (제작 시) |
| Cloudflare Pages · Functions | 배포 · API 프록시 |

API 키는 저장소에 없다. 로컬은 `.dev.vars`(gitignore), 배포는 Cloudflare Secrets 를 쓴다.
