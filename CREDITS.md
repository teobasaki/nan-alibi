# 외부 에셋 · 오픈소스 출처

NAN 2026 제출 규정에 따라 외부 에셋의 출처와 라이선스를 명시한다.

> **출처가 확인되지 않은 에셋은 배포하지 않는다.** 확인되지 않은 것을 확인된 것처럼
> 적지 않고, 채우지 못하면 교체한다 — 실제로 그렇게 했다(아래).

## 교체하고 걷어낸 것 — 출처 미확인 캐릭터 3종

`secretary` · `housekeeping` · `nephew` 는 한때 Sketchfab 기성 모델을 썼는데
**원본 페이지 URL과 라이선스가 저장소에 남아 있지 않았다.** 2026-08-10 에
같은 배역의 **자체 생성본**(Meshy, 아래 "생성 에셋" 표)으로 되돌려 저작권 문제를 없앴다.

되돌린 김에 품질도 같이 해결됐다 — 그 세 모델은 리그 규약이 달라
`scripts/pose-seated.py` 의 착석 포즈가 아예 안 먹었고, 그중 하나(`nephew`)는
**누운 채** 배포되어 런타임 배율 4.03배가 얹혀 있었다.

교체 전 파일은 배포에서 빠졌고 `assets-src/*.sketchfab.glb` 에만 남아 있다.
**되살리려면 원본 URL과 라이선스를 먼저 확인해야 한다.**

같은 원칙으로 **필름 릴**(`ev-reel.opt.glb`)의 첫 모델(["Mysterious film reel"](https://sketchfab.com/3d-models/mysterious-film-reel-batim-inspired-model-b968ab624b644869b0a2f85e7014072d) by Jackj106)은
라이선스가 **CC BY-NC-SA(비상업)** 로 확인되어 2026-08-10 제거했고, 같은 날
**CC BY 인 다른 릴 모델로 교체했다**(아래 "확인 완료" 표의 Film Reel) — 경로·코드는 그대로다.
**범죄 현장 테이프** 묶음 에셋(`crimetape.opt.glb`)은 사용하지 않기로 결정해 같은 날 제거했다.

**용의자 배우 `f1`** 도 같은 사례다: 원본이 ["Beautiful Young Woman Wearing a floral Dress"](https://sketchfab.com/3d-models/beautiful-young-woman-wearing-a-floral-dress-63a4f41ef8b4493aa1296bd1adbc03ee)
(florah, **CC BY-NC**) 로 확인되었다 — 텍스처의 꽃무늬 원단으로 대조 판정.
**비상업 조건이므로 배포 전 교체가 필요하다** (아래 "출처 확인 필요" 표 참조).

## 확인 완료 — 3D 에셋

| 에셋 | 저장소 경로 | 원본 | 저작자 | 라이선스 |
|---|---|---|---|---|
| **취조실** | `public/room/room.opt.glb` | ["Interrogation Room"](https://sketchfab.com/3d-models/interrogation-room-56def55221f64eaebd1c05738269d81f) | **Jamie McFarlane** ([@jamiemcfarlane](https://sketchfab.com/jamiemcfarlane)) | **CC BY 4.0** |
| **수첩 (모델 + 가죽·종이 텍스처)** | `public/nb/journal.opt.glb` · `public/nb/leather.webp` · `public/nb/paper.webp` | ["A writer's journal"](https://sketchfab.com/3d-models/a-writers-journal-673dee6a48924080b1237f0f09eb4572) | **Valeria Gerontopoulos** ([@vgerontopoulos](https://sketchfab.com/vgerontopoulos)) | **CC BY 4.0** |
| **미술관(갤러리) 방** | `public/room/gallery.opt.glb` | ["Art Gallery"](https://sketchfab.com/3d-models/art-gallery-720b507d814740278c713d100def4c99) | **Zeps3D** | **CC BY 4.0** |
| 1970s 보안 카메라 | `public/props/ev-cctv.opt.glb` | ["Glowbox 1970s Security Camera"](https://sketchfab.com/3d-models/glowbox-1970s-security-camera-796be67fab614a729ea53d107de81cd0) | **Glowbox 3D** | **CC BY 4.0** |
| 앤티크 다이얼 전화기 | `public/props/ev-call.opt.glb` | ["Antique Rotary Phone"](https://sketchfab.com/3d-models/antique-rotary-phone-ad34704b79774788887a5c78ffc445b2) | **alelivaca** | **CC BY 4.0** |
| 서류 뭉치 | `public/props/ev-receipt.opt.glb` | ["Low Poly Stack of Papers"](https://sketchfab.com/3d-models/low-poly-stack-of-papers-d298c37be37c47a3be9c6f0e93bdf774) | **ZAKAT** | **CC BY 4.0** |
| 왕진 가방 | `public/props/ev-autopsy.opt.glb` | ["Doctor's bag"](https://sketchfab.com/3d-models/doctors-bag-9cb08f68851e4edb9d0e0c5604f0eba6) | **Dishido** | **CC BY 4.0** |
| 나무 운송 상자 | `public/props/crate.opt.glb` | ["A Wooden Crate"](https://sketchfab.com/3d-models/a-wooden-crate-4ae035ea89ea40bbaa82403b9c36afab) | **Krystian Zem** | **CC BY 4.0** |
| 금속 상자 | `public/props/ev-keycard.opt.glb` | ["Metal Box"](https://sketchfab.com/3d-models/metal-box-c7e4c17e948b42ed9bfdd6b8b7663890) | **LordCinn** | **CC BY 4.0** |
| 사망 위치 표시(현장 감식) | `public/props/fallscene.opt.glb` | ["Fall investigation scene"](https://sketchfab.com/3d-models/fall-investigation-scene-06a325ab494b4fa88a69c3d48a4ca68b) | **mira9** | **CC BY 4.0** |
| 용의자 배우 `carla` | `public/characters/carla.{sit,idle}.opt.glb` | ["Carla Rigged 001"](https://sketchfab.com/3d-models/carla-rigged-001-rigged-3d-business-women-acf520f450d14dd799f98a6fede3edf5) | **renderpeople** | **CC BY 4.0** |
| 용의자 배우 `wong` | `public/characters/wong.{sit,idle}.opt.glb` | ["Wong 3D Character Model Rigged"](https://sketchfab.com/3d-models/wong-3d-character-model-rigged-ab3eca7de3eb4ec38aaade89e73b4860) | **davisthegamelord** | **CC BY 4.0** |
| 용의자 배우 `m1` | `public/characters/m1.{sit,idle}.opt.glb` | ["Lixizhi"](https://sketchfab.com/3d-models/lixizhi-5eab478000164ee3b56e898a9d338b20) | **xizhi.li** | **CC BY 4.0** |
| 용의자 배우 `f3` | `public/characters/f3.{sit,idle}.opt.glb` | ["Rigged Standing Asian Female Character Idle Pose"](https://sketchfab.com/3d-models/rigged-standing-asian-female-character-idle-pose-b31b024797194829af4637fbfb6838b7) | **florah** | **CC BY 4.0** |
| 필름 릴 | `public/props/ev-reel.opt.glb` | ["Film Reel"](https://sketchfab.com/3d-models/film-reel-c099527235af42b4a30898e7ca66c565) | **sedayuzlu** | **CC BY 4.0** |

> 위 표의 모든 저작물은 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 으로
> 제공되며, 각 저작자의 원저작물을 **변형해** 사용했다 (This work is based on the works
> listed above, licensed under CC Attribution 4.0). 라이선스 표기는 2026-08-10
> Sketchfab 모델 페이지·공개 API(`api.sketchfab.com/v3/models/{uid}`) 기준으로 확인했다.

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

**공통 변형 내역 (갤러리·소품·배우):** 원본 GLB/FBX 를 `gltf-transform optimize` 로
Draco + WebP(≤2048) 압축했고, 용의자 배우의 착석·대기 동작은 Mixamo 클립을
자체 리타게팅 파이프라인(`scripts/retarget.py`)으로 구워 얹었다. 조명·배치는 런타임에서 잡는다.

CC-BY 계열이면 저작자 표기로 충족된다. NC(비상업)·ND(변경 금지) 조건이면
**변형(리깅 수정·포즈·최적화)을 했으므로 재검토가 필요하다** — 필름 릴이 그 사례로,
NC 조건이 확인되자 제거했다(위 "교체하고 걷어낸 것").

## 출처 확인 필요 — 배포 전 반드시 채울 것

| 에셋 | 저장소 경로 | 상태 |
|---|---|---|
| 용의자 배우 `f1` | `public/characters/f1.{sit,idle}.opt.glb` | **CC BY-NC 확인 — 교체 필요.** 원본은 florah 의 floral dress 모델(비상업 조건). CC BY 대체 모델 확보 전에는 배포에 포함하지 않는다. 슬러그·코드는 유지하고 에셋 파일만 갈아끼우면 된다 |

## 생성 에셋 — 저작권이 이쪽에 있는 것

| 에셋 | 생성 도구 | 비고 |
|---|---|---|
| ~~캐릭터 8종~~ (`manager` · `security` · `investor` · `expartner` · `appraiser` · `secretary` · `housekeeping` · `nephew`) | Meshy (multi-image-to-3d + rigging) | **2026-08-10 게임에서 걷어냈다** — 용의자는 기성 리깅 배우 5종으로 교체 (`carla`·`wong`·`m1`·`f3` 는 위 "확인 완료" 표, `f1` 은 NC 확인 — "출처 확인 필요" 표). 코드 참조 0 (글롭이 배역 5종만 짚는다). 원본은 `assets-src/` 에 보존 |
| 주인공 형사 `joe` (몸 + 걷기·달리기·집기·대기·착석 클립) | Adobe **Mixamo** 캐릭터·애니메이션 (네이티브 베이크) | Mixamo 이용약관에 따른 로열티 프리 사용. `public/characters/joe.*.opt.glb` |
| 걷기·달리기·집기·대기(Breathing Idle) 동작 | Mixamo 클립을 자체 리타게팅 (`scripts/retarget.py` + `scripts/strip-beta.mjs`) | 다리 축 보정은 런타임에서 한다 (ADR 021) |
| 인물 레퍼런스 이미지 (`public/refs/`, `docs/refs/`) | OpenAI `gpt-image-2` | 3D 생성 입력용 |
| 인트로 · 엔딩 만화 패널 (`public/intro/`, `public/outro/`) | ChatGPT(OpenAI) 이미지 생성 — 팀 계정 세션에서 생성 | 호텔 12장 + 골든 케이스 10장(`public/intro/gc001/`). 그림이 없어도 색면 폴백으로 동작 |
| 효과음 (`public/sfx/*.opus` 19종 + 앰비언스) | VARCO Text-to-Sound 생성 (해커톤 제공 크레딧) · `curtain` 1종은 로컬 ComfyUI + **Stable Audio 3 Small** (Stability AI Community License — 연매출 $1M 미만 상업 이용 허용, 생성물 권리는 생성자에게) | 프롬프트 정본 `src/ui/sfxSpec.ts` · 파일이 없으면 Web Audio 합성 폴백(`src/ui/sound.ts`) |
| 음성 | Supertone TTS API (`src/ui/tts/supertone.ts`, 심문 대사) | 키가 없으면 Web Speech API(브라우저 내장) 폴백 (`src/ui/voice.ts`) |

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
