# AGENTS.md — Stencil

SVG 템플릿 기반 AI 프레젠테이션 생성 시스템. 사양은 `DEVDOC.md`가 SSOT다. 이 파일은 코드 컨벤션·작업 규약만 다룬다.

## 핵심 설계 불변 (위반 = 설계 위반)
1. 단방향 파이프라인: M0→M1→M2→M3→M4→M5→M6. 역방향 의존 금지.
2. LLM(M3)은 좌표·색·폰트크기를 출력하지 않는다. role/블록/콘텐츠만.
3. 결정론: M0·M4·M5는 같은 입력 → 같은 출력. 무작위성은 M3에만.
4. 원본 보존: v1 렌더러(inplace)는 베이스 템플릿의 비텍스트 요소를 변형하지 않는다. 슬롯 텍스트만 치환한다.
5. 계약 우선: 모듈 간 인터페이스는 `packages/ir`의 타입으로만. `ir` 변경은 cross-cutting 결정.

## 스택
- 전 구간 TypeScript (strict, ESM, NodeNext). Node ≥ 20.
- monorepo = npm workspaces. `packages/*`, `apps/*`.
- 프론트/API: Next.js 15. DB·스토리지: Supabase. LLM: Anthropic API (tool use).

## 패키지 경계
- `packages/ir` — DEVDOC 7장 데이터 계약(타입)의 단일 정의처. 다른 모든 패키지가 의존.
- `packages/normalizer` — M0: Figma SVG → 슬롯 매니페스트(실측) + 베이스 템플릿 보존.
- `packages/extractor` — M1·M2: 정규화 산출물 → 디자인 시스템 IR + 검증.
- `packages/composer` — M3: Claude tool use → 구성 IR.
- `packages/solver` — M4: 구성 IR → 좌표 + 텍스트 피팅.
- `packages/renderer` — M5: 렌더 트리 → SVG. 어댑터: `inplace`(v1) / `resynth`(v2).
- `apps/web` — M6: 업로드·정규화 보정·생성·뷰·다운로드.

(현재 존재: `ir`. 나머지는 Phase 도달 시 생성.)

## 입력 자산
- `templates/` = Figma SVG 시드(3테마: black 40 / colorful 32 / green 11, 16:9). DEVDOC의 `fixtures/templates`.
- 텍스트는 실측 `<text>`/`<tspan>`(font-family·size·weight·fill 보존). `data-*` 라벨 없음 — 역할은 `id`(Figma 레이어명)로 추론.
- black `Frame-26·30·33`은 `<text>` 없음(decoration-only). 31장은 래스터 `<image>` 포함.

## 코드 규약
- 주석·커밋·PR은 영어. 사용자 대면 출력은 한국어.
- 타입은 `ir`에서 import. 모듈 내부에서 계약 타입을 재정의하지 않는다.
- 빌드: `npm run build`(프로젝트 참조 빌드). 타입체크: `npm run typecheck`.
- 검증 없이 "완료" 선언 금지. Phase 종료 시 `templates/` 샘플로 한 바퀴 회귀.

## 현재 진행
- DEVDOC v3 = A안(원본 베이스 + 슬롯 텍스트 인플레이스 치환) 확정. 텍스트가 실측 `<text>`라 토큰(폰트·크기·색) 전부 실측.
- 다음: Phase 0 정규화 PoC — `colorfulldesign/Frame-0.svg` 1장을 슬롯 매니페스트(실측)로 읽고 베이스 템플릿 보존.
