# 손글씨 폰트 만들기

종이 템플릿에 쓴 손글씨를 사진으로 찍어 올리면 TTF·OTF·WOFF2 폰트가 되는 웹사이트.

**https://ayun-jeong.github.io/handwriting-font/**

- 사진 처리부터 폰트 생성까지 전부 브라우저 안(Web Worker)에서 한다. 서버, 계정, 방문 분석이 없다.
- 템플릿 칸의 위치가 곧 글자라서 OCR을 쓰지 않는다. 네 모서리 ArUco 표식으로 원근을 펴고, QR로 쪽을 알고, 칸마다 테두리를 다시 찾아 종이 휨을 보정한다.
- 한글은 자모 2쪽(157칸)만 쓰면 11,172자를 전부 조합한다. 자모 칸에는 쓸 부분만 진하게 그린 안내가 있어 그 위치에 따라 쓰고, 안 쓴 변형(예: 곽의 ㄱ)은 가장 가까운 자모를 위치에 맞게 옮겨 만든다. 직접 쓴 글자가 있으면 그게 우선이다.
- 템플릿 세트: 빠른(자모만) · 표준(+자주 쓰는 240자) · 정성(+480자, 기본) · 장인(+1,040자).
- 조합 글자는 TTF 합성 글리프로 저장해서 11,172자 TTF가 수백 KB다. 크기·높이는 같은 글자를 직접 쓴 것과 비교해 자동으로 맞춘다.
- 인식 후 자간·띄어쓰기 폭·줄 간격·굵기·한글/영문/조합 글자 크기와 높이, 글자별 위치·크기를 고치고 미리보기로 확인한 뒤 내려받는다.

## 개발

```sh
npm install
npm run dev      # http://localhost:5173/handwriting-font/
npm run build
```

`main`에 push하면 GitHub Actions가 빌드해 GitHub Pages에 올린다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/core/geometry.ts` | 템플릿 쪽 좌표(A4 300dpi). 템플릿 그리기와 사진 처리가 같이 쓴다 |
| `src/core/charsets.ts` | 쪽 구성(자모 2쪽, 한글 빈도순 13쪽, 영문 1쪽), 세트, QR 내용 |
| `src/core/compose.ts` | 자모 변형 만들기, 음절 조합 규칙 |
| `src/core/data/jamo-guides.json` | 자모 칸 안내 모양과 배치 영역. Pretendard Variable의 획을 초성·중성·종성으로 나눠 만들었다(스파이크 `jamo_guides.py`) |
| `src/core/glyphset.ts` | 폰트에 들어갈 글리프 목록(직접 쓴 글자 + 조합 글자 합성 글리프) |
| `src/fit.ts` | 사진이 들어올 때 크기 자동 맞춤 |
| `src/core/template.ts` | 템플릿 그리기, PDF 만들기 |
| `src/core/pipeline.ts` | 사진 → 칸별 잉크 (OpenCV.js) |
| `src/core/tracer.ts` | 잉크 → 곡선 윤곽 (윤곽 추출 + 모서리 검출 + 곡선 맞춤) |
| `src/core/layout.ts` | 사용자 조절값 적용 (미리보기와 내보내기가 같이 쓴다) |
| `src/core/font.ts`, `sfnt.ts` | TTF·OTF·WOFF2 만들기, name 테이블 직접 쓰기 |
| `src/worker/` | 무거운 처리를 맡는 Web Worker |
| `src/ui/` | 단계별 화면 |
| `tests/` | Node 점검(`scan-photos.ts`, `compose-check.ts`), 로컬 Chrome으로 돌리는 E2E(`e2e-*.mjs`) |

## 출처와 라이선스

- 한글 빈도순: 국립국어원 「현대 국어 사용 빈도 조사 2」(2005) 음절 통계
- 사용한 오픈소스: OpenCV.js(Apache-2.0), fonteditor-core(MIT), opentype.js(MIT), fit-curve(MIT), pdf-lib(MIT), qrcode-generator(MIT), idb-keyval(Apache-2.0), React(MIT)
- 자모 안내 모양: Pretendard (SIL OFL 1.1, © Kil Hyung-jin)
- 이 저장소의 코드는 오픈소스 라이선스로 배포하지 않는다. © 2026 ayun-jeong. All rights reserved.
