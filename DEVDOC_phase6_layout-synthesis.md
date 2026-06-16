# Phase 6 — 레이아웃 합성 (진짜 재합성)

> SSOT 보강 문서. 본 문서는 "원본 프레임 통째 재사용 + 글자 교체"에서
> **디자인 시스템 에셋을 조합해 원본에 없던 페이지를 생성**하는 단계로의 전환을 정의한다.
> DEVDOC.md(v4)의 ③구성·④조립을 대체하지 않고, 그 위에 **합성 경로**를 추가한다.

---

## 0. 점검 결과 — 현재 무엇이 "재합성"이 아닌가 (증거)

- `composer/compose.ts:planOutline` 은 **기존 layoutId만 선택**하고 미존재 id를 버린다(`valid.has`).
  → 출력 슬라이드 = 원본 프레임 1장.
- `director.planSlide` → 그 프레임 슬롯/카드에 **내용만** 채움. `solver.solveDeckSlide` → **그 한 프레임 내부**에서만 재배치. 장식은 통째.
- `system.blocks`(테마별 5~7 반복 카드 패턴)를 **읽는 코드가 0개**. 합성에 미사용.
- 레이아웃을 새로 조립하는 함수 부재. `solveDeckSlide(layout: Layout, ...)` 는 항상 기존 Layout 하나가 입력.
- **결론**: 현재는 "스마트 템플릿 필러". 카드 개수 변형(M≠원본)만이 유일한 구조 변형이고 그마저 프레임 내부 한정.

### 합성 재료는 충분하다 (실측)
- **blocks**: colorful 5 / black 7 / green 5. 예) `card_kpi_caption`, `card_headline_label_body`, `card_kpi_label_body`, `card_headline_body` — 역할·bbox 포함, repeatable.
- **grammar**: alignmentGrid(margin 31/128/100, xGuides 14~18, yGuides 16~25), spacingRhythm(tight/normal/loose/section), hierarchy(role→size).
- **decoration**: 레이아웃별 background/emphasis/image_holder/accent/divider + bbox/salience/z.

### 핵심 제약 (점검에서 확인)
- decoration SVG의 element id(`Frame`,`Decorative`,`Line`)와 decorationModel id(`emphasis_1/2`)가 **불일치**. 모델은 path에서 bbox/kind만 추출하고 **SVG 기하를 버린다**.
  → **장식 조각 단위 재배치 불가**. 이를 위해선 decorationModel이 각 요소의 SVG fragment(+transform)를 보관해야 한다(6.3).

---

## 1. 목표와 출력 계약

**목표**: 슬라이드 의도(purpose) + 콘텐츠가 주어지면, **조합 아키타입(스켈레톤) + 블록 + 장식 treatment + grammar**로 좌표를 생성해 **원본 어떤 프레임과도 같지 않은** 페이지를 만든다. 온브랜드(토큰·그리드·리듬·위계 준수) 보장.

**불변 원칙(유지)**: LLM은 좌표/색/폰트크기 미출력 — 아키타입·블록·콘텐츠·장식 vibe만 판단. 좌표는 결정론 엔진이 생성. 무작위성 없음(동일 입력→동일 출력). 원본 SVG 미조회(에셋만).

**출력**: 기존 `RenderSlide`(렌더러가 그대로 소비). 중간 산출 `SynthLayout`(슬롯+영역+장식조각 참조)을 도입해 기존 solver/renderer 경로를 최대 재사용.

```
SynthPlan (director, 좌표-free)         SynthLayout (placement engine, 좌표 확정)
{                                       {
  archetype: "metric-row",               slots: PlacedSlot[]      // 좌표 확정
  blocks: [{block:"card_kpi_caption",    regions: Region[]
            count:3, content:[...]}],     decoration: DecoFragment[]  // 배치된 장식 조각
  singles: { title, eyebrow, ... },      background: string
  decoration: { intent:"corner-accent" } canvas
}                                       }  → solveSynth() → RenderSlide → renderComposite()
```

---

## 2. 아키텍처 — 4개 구성요소

### 2.1 Composition Archetype (스켈레톤) — 보편 조합 패턴
원본 프레임이 아니라 **범용 디자인 패턴**을 grammar로 파라미터화한 것. 예:
- `hero` (대형 타이틀 + 서브, 한쪽 정렬, 반대편 장식)
- `hero-visual` (타이틀/본문 + 대형 이미지 분할)
- `metric-row` (eyebrow/title + KPI 카드 N개 가로 분배)
- `two-column` (타이틀 + 본문 컬럼)
- `list` (타이틀 + 번호/불릿 항목 N)
- `comparison` (좌우 대비 N)
- `quote` (대형 인용 + 출처 + 아바타)
- `section` (챕터 타이틀, 여백 중심)

각 아키타입 = **영역(region) 슬롯 정의 + 블록 슬롯 + 장식 앵커 + 정렬 규칙**, 모두 grammar 변수로 표현(절대좌표 X). 신규성은 ① 블록 선택 ② 콘텐츠 개수 ③ 장식 treatment ④ 아키타입 다양성에서 나온다. 이것은 "더 많은 템플릿"이 아니라 **테마 에셋으로 파라미터화되는 생성 규칙**이다(Beautiful.ai/Gamma 모델).

### 2.2 Block Library — `system.blocks` 활성화
이미 추출된 blocks를 합성 입력으로 사용. 블록 = 역할 세트 + 내부 상대배치(템플릿 dx/dy/role/size from `CardTemplateSlot`) + bbox. 아키타입의 블록 슬롯에 매칭(역할 호환). 개수 N은 director가 결정, placement engine이 가로/세로 분배(reflowCards 일반화).

### 2.3 Placement Engine — grammar 기반 좌표 생성 (핵심)
입력: 아키타입 + 선택 블록/콘텐츠 + grammar + canvas. 출력: PlacedSlot[] + Region[].
- **v1 (결정론·그리드)**: 아키타입이 영역을 grammar로 정의(margin·xGuides 스냅·rhythm gap·hierarchy size). 영역 안에서 블록/싱글을 흐름 배치 + 기존 fitText/push-down/safeArea 재사용. 빠르고 통제 가능, 온브랜드 보장.
- **v2 (제약 솔버)**: 관계(above/aligned/gap=rhythm/inside/avoids)를 선형 제약으로 표현 → kiwi.js(Cassowary)로 좌표 해. 가변 콘텐츠·자유 배치에 강함. v1의 아키타입 영역 정의를 제약으로 승격.
- **결정**: v1으로 시작하되 영역/관계를 **제약으로 승격 가능한 형태**로 설계(관계 그래프 어휘 재사용). "relations first, coordinates last" 유지.

### 2.4 Decoration Treatment Library — 장식 재합성
- **v1 (통째 재결합)**: 테마의 한 프레임 장식을 **콘텐츠 합성과 분리**해 선택. 예: 합성한 metric-row 콘텐츠 + Frame-21 blob 장식(배경). 페이지는 원본과 다름(콘텐츠 구성이 생성됨). 장식 앵커(아키타입)와 호환되는 장식만 선택(코너/하단엣지/풀블리드/타이틀배경 분류).
- **v1.5 (조각 단위)**: decorationModel을 확장해 **각 요소의 SVG fragment(+accumulated transform)** 보관(6.3). 조각을 앵커에 맞춰 transform/recolor 배치 → 0~2개 조합. 진짜 장식 재합성.

---

## 3. 필요한 코드 변경

### 3.1 신규 패키지 `packages/synthesizer`
- `archetypes.ts`: 아키타입 카탈로그(영역·블록슬롯·장식앵커·정렬규칙, grammar 변수 기반).
- `place.ts`: placement engine(grammar→좌표). reflow/fit/selfcheck 재사용.
- `synthesize(system, synthPlan) → SynthLayout`.
- `solveSynth(synthLayout, tokens, canvas) → RenderSlide` (solveDeckSlide 일반화).

### 3.2 director 확장 — `planSynthSlide`
"프레임 선택" → "페이지 설계": 아키타입 + 블록(+개수) + 콘텐츠(singles/cards) + 장식 intent. 좌표-free 유지. 기존 planSlide는 호환용으로 존치.

### 3.3 composer 확장 — `outlineSynthDeck`
덱 서사를 **아키타입 시퀀스**로 계획(기존 layoutId 선택 대신 archetype 선택). cover→…→closing.

### 3.4 renderer 확장
`renderComposite(slide, decorationSvg)` → 합성 장식(조각 배열/조립된 SVG)도 받도록 오버로드. 텍스트/이미지/rect 합성 로직은 그대로.

### 3.5 (v1.5) 에셋화 보강 — decorationModel.elements[].svg
`relations.ts` 분해 시 각 요소의 SVG fragment 문자열 + accumulatedTransform 저장. 조각 추출/재배치 가능화. **점검에서 확인된 누락 보강.**

---

## 4. 품질 게이트 (재사용)
- 결정론: `selfcheck`(대비·겹침·오버플로·경계·휑함) + safeArea 클램프 + 수직 push-down.
- 비전: `critic.critiqueSlide` accept/revise(N≤2). 합성 페이지는 신규 배치이므로 비평 가치 ↑.
- grammar 준수(그리드 스냅·rhythm·hierarchy)로 "신규지만 온브랜드" 보장.

---

## 5. PoC 범위 (Phase 6.0) — 가능성 검증
**목표**: 한 아키타입·한 테마에서 **원본 프레임과 다른 페이지 1장** 생성·렌더·육안 검증.
1. `metric-row` 아키타입 1개 정의(colorful): eyebrow/title 영역 + `card_kpi_caption` 블록 ×N 가로 분배 + 코너 장식 1개(통째 재결합 v1).
2. placement engine 최소 구현(grammar로 좌표) → SynthLayout → solveSynth → renderComposite → rasterize.
3. 하드코딩한 SynthPlan(콘텐츠 직접 주입, director 없이)으로 PNG 생성.
4. **검수**: 원본 어떤 colorful 프레임과도 골격이 다른가? 온브랜드인가? self-check 통과?
5. 성공 시 → director 연결(planSynthSlide) → 아키타입 2~3개 추가 → 웹앱 토글(필러 vs 합성).

**비범위(차후)**: 조각 단위 장식(v1.5), 제약 솔버(v2), 전 아키타입, 3테마 일반화.

---

## 6. 리스크와 완화
- **R1 신규 배치가 추함**: grammar 강제(그리드/리듬/위계) + self-check + 비전 비평. 아키타입은 검증된 패턴만.
- **R2 장식·콘텐츠 부조화**(v1 통째 재결합): 장식 앵커 분류로 호환 장식만 매칭. recolor는 팔레트 내.
- **R3 "또 다른 템플릿"으로 전락**: 아키타입은 절대좌표 0 — 전부 grammar 변수. 블록·개수·장식·테마 조합으로 조합 폭발. 원본 프레임 카탈로그 미참조.
- **R4 조각 추출 복잡도**(v1.5): transform 합성은 normalizer에 이미 존재(accumulatedTransform/applyBBox) — 재사용.
- **R5 회귀**: 합성 경로는 **추가**. 기존 필러 경로(outlineDeck/solveDeckSlide) 보존, 웹앱서 토글.

---

## 7. 단계
- **6.0 PoC**: 위 5장. (다음 작업)
- **6.1**: director 연결 + 아키타입 3~4개 + 웹 토글.
- **6.2**: decorationModel.svg 보강 → 조각 단위 장식(v1.5).
- **6.3**: 제약 솔버(kiwi) 도입(v2), 자유 배치.
- **6.4**: 3테마 일반화 + 비전 비평 루프 상시화.
