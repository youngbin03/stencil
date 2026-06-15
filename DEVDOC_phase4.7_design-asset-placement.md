# 개발 문서 — Phase 4.7: Claude 기반 디자인 에셋 배치 & 이미지 생성

> Stencil 확장편 · 메인 `DEVDOC.md`(v4) + `DEVDOC_phase4.5_relation-graph.md` 위에 선다.
> 성격: 개발 사양서. 구현 코드 미포함. 에이전트 구조·프롬프트 설계·데이터 계약·루프·시스템·검증을 정확히 정의한다.
> 리서치 근거(2026): Claude는 픽셀 비생성(SVG/오케스트레이션) · Nano Banana Pro = 레퍼런스 기반 브랜드 일관 픽셀 엔진 · Reflection/Evaluator-Optimizer 패턴 +20%p · Context engineering · XML 구조 프롬프트.

---

## 0. 한 줄 요약 & 역할 분리

**Claude를 "디자인 디렉터 에이전트"로 세팅해, 관계 그래프(4.5)와 디자인 시스템을 근거로 ① 에셋을 배치/선택하고 ② 부족한 픽셀 에셋(사진·일러스트·목업)을 외부 이미지 모델로 생성·검수한다. 좌표는 솔버가, 픽셀은 nanobanana가, 판단·비평은 Claude가.**

| 능력 | 담당 | 비고 |
|---|---|---|
| 의미 판단·배치 결정·비평 | **Claude** (opus) | tool use, 좌표 출력 금지 |
| 픽셀 이미지(photo/illustration/mockup) | **Nano Banana Pro** (nanobanana MCP) | 레퍼런스 14장까지 → 브랜드 일관 |
| 좌표/피팅(결정론) | **solver** | 같은 입력 → 같은 출력 |
| 합성/렌더 | **renderer(composite)** | 장식 + 텍스트 + 이미지 |

핵심: **Claude에게 픽셀을 시키지 않는다(못한다). Claude는 "무엇을·어디에·어떤 스타일로"를 결정하고, 픽셀은 전용 엔진에 위임한다.**

---

## 1. 무엇을 푸는가 (문제)

Phase 3까지: 프롬프트 → 레이아웃 선택 + 슬롯 텍스트 → 고정 슬롯 배치 → 렌더. 한계:
1. **배치가 경직.** 콘텐츠가 슬롯과 안 맞으면 축소/겹침(Phase 4). 관계를 모름.
2. **이미지 슬롯이 빈다.** `image/photo/device_mockup/illustration` 슬롯을 채울 픽셀이 없다(사용자 업로드 의존).
3. **"디자인 시스템 기반 이미지"가 없다.** 끼워넣는 이미지가 테마와 따로 논다.

Phase 4.7이 푸는 것: **(A) 관계 보존 배치**(4.5 그래프를 써서 콘텐츠 변형에도 정렬·결합·강조 유지) + **(B) 테마 일관 이미지 생성**(디자인 시스템을 레퍼런스로 픽셀 생성) + **(C) 비전 비평 루프**(렌더 결과를 디자인 문법에 비추어 자기교정).

---

## 2. 에이전트 아키텍처 (Claude 세팅)

3개의 **역할 분리된 Claude 호출**(멀티에이전트 패턴, 각자 좁은 프롬프트·tool use). 단일 거대 프롬프트보다 안정적이다(리서치: 역할 분담이 프롬프트 단순화·확장성).

```
[구성 IR (Phase 3)] + [디자인 시스템 + 관계 그래프 (4.5)]
        │
        ▼
 (1) 배치 디렉터 (Claude, tool use)
     관계 그래프 + 콘텐츠 → 배치 계획(placementPlan): 어떤 슬롯/블록을
     어떻게 배열·복제, 어떤 이미지 슬롯을 무슨 의도로 채울지. 좌표 없음.
        │
        ▼
 (2) 이미지 디렉터 (Claude, tool use) ──► Nano Banana Pro (nanobanana MCP)
     이미지 슬롯별 생성 브리프(프롬프트 + 레퍼런스 선택 + ratio) 작성 →
     픽셀 생성 → 슬롯에 바인딩. 테마 레퍼런스로 일관성.
        │
        ▼
 [solver] 관계 + 배치계획 → 좌표/피팅 (결정론)
        │
        ▼
 [renderer] 장식 + 텍스트 + 생성이미지 → 슬라이드 SVG/PNG
        │
        ▼
 (3) 비평가 (Claude 비전, evaluator-optimizer)
     렌더 PNG를 디자인 문법·관계에 비추어 평가 → 수정 지시(패치) →
     (1)/(2)로 환류. 최대 N=2회. circuit breaker.
        │ (수렴 또는 상한)
        ▼
 [최종 슬라이드]
```

각 에이전트는 **별도 system 프롬프트 + 좁은 tool schema**. 모델은 opus(품질) / 비평은 비전 opus.

---

## 3. 데이터 계약

### 3.1 배치 계획 — `PlacementPlan` (배치 디렉터 출력, 좌표 없음)
```json
{
  "layoutId": "colorful_Frame-13",
  "blocks": [
    { "block": "stat_card", "repeat": 3,
      "items": [
        { "slots": { "kpi": "+38%",  "caption": "Revenue YoY" } },
        { "slots": { "kpi": "120K",  "caption": "New users" } },
        { "slots": { "kpi": "-5.2pp","caption": "Churn" } }
      ] },
    { "block": "title", "items": [ { "slots": { "subtitle": "Q1 Results" } } ] }
  ],
  "imageSlots": [
    { "slot": "image_1", "intent": "abstract data-growth visual, on-brand",
      "mediaKind": "illustration", "ratio": "1:1" }
  ],
  "relationOverrides": []
}
```
- 배치 디렉터는 **관계 그래프를 만족하는 배열·복제**만 결정. `repeat`로 repeatable 블록 인스턴스 수 지정(콘텐츠 수 ≠ 슬롯 수 해결).
- 좌표·색·폰트크기 **금지**(불변).

### 3.2 이미지 생성 브리프 — `ImageBrief` (이미지 디렉터 출력)
```json
{
  "slot": "image_1",
  "prompt": "abstract upward-flowing data ribbons, minimal, lots of negative space",
  "negative": "text, logos, busy background",
  "ratio": "1:1",
  "references": ["palette_swatch.png", "decoration_colorful_Frame-13.png", "theme_hero.png"],
  "styleNotes": "match palette #237267/#5FA0FB/#F3F3F3; calm, corporate, flat"
}
```
- `references` = **디자인 시스템에서 자동 합성한 레퍼런스 묶음**(4.3). Nano Banana Pro에 최대 14장 전달.
- 결과 픽셀 → Storage → `asset_id` → 슬롯 바인딩(메인 8.5와 동일 경로).

### 3.3 비평 패치 — `CritiquePatch` (비평가 출력)
```json
{
  "verdict": "revise",
  "issues": [
    { "severity": "high", "target": "Subtitle", "problem": "overlaps emphasis circle", "fix": "anchor left, avoids emph_1" },
    { "severity": "low",  "target": "image_1",  "problem": "too saturated vs palette", "fix": "regenerate calmer, lower saturation" }
  ]
}
```
- `fix`는 관계/브리프 수정 지시로 환원(좌표 아님) → (1)/(2) 재실행.
- `verdict: accept`면 종료.

---

## 4. 핵심 로직

### 4.1 배치 디렉터 (관계 보존 배치)
- **입력 컨텍스트(context engineering):** 레이아웃의 관계 그래프(4.5) + 슬롯 역할/제약 + 블록 정의 + 콘텐츠. XML 태그로 구조화.
- **출력:** `PlacementPlan`(tool use 강제). 규칙:
  - repeatable 블록은 콘텐츠 수에 맞춰 `repeat`.
  - 관계(`aligned/coupled/row/avoids`)는 보존 — 디렉터는 "어떤 블록을 몇 개, 어느 영역에"만 정하고, 정확 좌표는 솔버가 관계를 선형 제약으로 풀어 배치.
- **검증:** 관계 모순(순환)·필수 슬롯 누락 → 1회 재요청.

### 4.2 솔버의 관계 기반 배치 (결정론, 4.7의 코어)
- 관계 엣지 → 선형 제약 변환:
  - `above(a,b)` → `a.bottom + gap(strength) ≤ b.top`
  - `aligned(left, [..])` → 동일 x + 가장 가까운 `alignmentGrid.x_guides` 스냅
  - `row(equal)` → 가로 균등 분배 + `same_size`
  - `avoids(slot, deco)` → 슬롯 bbox ∩ deco bbox = ∅ (강조 도형 회피)
  - `anchored_to(region)` → 슬롯 박스를 region으로 제한
- v1(4.7 초기): 경량 제약 충족(그리디 + 스냅). v2: 진짜 제약 솔버(kiwi.js)로 격상. **둘 다 결정론.**
- 과소제약 → 문법 기본값 보충, 과대제약 → 우선순위(필수/선호) 완화.

### 4.3 이미지 디렉터 (테마 일관 픽셀 생성) — 가장 중요한 신규
**디자인 시스템을 레퍼런스로 주입**해 Nano Banana Pro로 생성한다(리서치: 최대 14 레퍼런스로 브랜드 일관).

레퍼런스 자동 합성(생성 시):
1. **팔레트 스와치 PNG** — 테마 `tokens.palette`를 색 블록 이미지로 렌더.
2. **장식 조각 PNG** — 해당 레이아웃 decoration을 래스터(분위기·질감 전달).
3. **테마 대표 슬라이드 1~2장 PNG** — 이미 잘 분류된 슬라이드(예: cover) 래스터.
4. (선택) 사용자 제공 브랜드 자산.

이미지 디렉터 프롬프트(XML 구조): `<intent>` + `<palette>`(hex) + `<style_notes>`(테마 무드: 미니멀/플랫/코퍼릿) + `<constraints>`(no text, negative space, ratio). → `ImageBrief` → nanobanana 호출(references 첨부).

생성 후 **즉시 슬롯 ratio로 커버 크롭** + 비평가가 팔레트 적합성 검사. 부적합 → 재생성(상한).

> mediaKind별 전략: `photo`=실사 무드, `illustration`=플랫/추상(텍스트 슬라이드와 충돌 적음, 권장 기본), `device_mockup`=목업 안에 스크린샷 합성(중첩 생성), `avatar`=인물(주의: 실존 인물 금지, 프로필 placeholder), `chart`=데이터 기반은 네이티브 SVG 차트가 더 정확(이미지 생성 비권장).

### 4.4 비평-재정제 루프 (evaluator-optimizer)
1. 렌더 → PNG.
2. **비전 Claude**에 PNG + (디자인 문법 요약 + 관계 그래프)를 기준선으로 제시: "이 템플릿은 좌측 헤비·여백 큼·강조 도형 우측. 현재 슬라이드가 이를 따르나? 겹침/잘림/대비/균형 점검."
3. `CritiquePatch` → high 이슈는 배치(4.1)·이미지(4.3) 재실행, low는 옵션.
4. **종료:** `accept` 또는 N=2회(리서치: 2-3회 후 수익 체감). circuit breaker(토큰/시간 상한) → 마지막 유효 상태 반환.

---

## 5. 프롬프트 / 컨텍스트 엔지니어링 (정확한 세팅)

리서치 반영. 모든 Claude 호출 공통:
1. **XML 구조 프롬프트.** `<role>`, `<design_system>`, `<relations>`, `<content>`, `<task>`, `<constraints>`, `<output_format>`. Opus 4.x는 XML 태그에 가장 잘 반응.
2. **Context engineering > 개별 프롬프트.** 에셋 카탈로그·관계·문법을 **압축 요약**해 컨텍스트로 주입(토큰 상세는 제외, 어휘만). 토큰 절약 + 일관성.
3. **tool use로 출력 강제.** 산문 금지, 스키마(`PlacementPlan/ImageBrief/CritiquePatch`)로만.
4. **불변 명시.** "좌표·색값·폰트크기를 출력하지 말 것. 역할·관계·의도만." 프롬프트=계약.
5. **few-shot.** 잘 된 배치/브리프 예 1~2개를 예시로(테마에서 추출).
6. **결정론 격리.** 무작위성은 Claude 호출에만. 솔버·렌더러는 동일 입력 동일 출력. 비결정 산출은 영속 + 검토로 흡수.
7. **예산 가드.** 에이전트 루프별 토큰 상한 + circuit breaker + 캐싱(plan/brief 캐시).

---

## 6. 시스템 / 모듈
- `packages/director` (배치 디렉터 + 이미지 디렉터): Claude tool use. composer와 분리(composer=콘텐츠, director=배치·이미지).
- `packages/imagegen`: nanobanana(Nano Banana Pro) 어댑터 + 레퍼런스 합성(팔레트 스와치·장식 래스터). 어댑터 경계(후속 다른 이미지 엔진 교체 가능).
- `packages/solver`: 관계 기반 배치 추가(4.2). 기존 고정 슬롯은 폴백.
- `packages/critic`: 비전 비평(evaluator). renderer(PNG) → 패치.
- 오케스트레이터(파이프라인): 구성(3) → 디렉터(4.1) → 이미지(4.3) → 솔버 → 렌더 → 비평(4.4) → 환류. 상한 관리.

---

## 7. 검증 (탁월함 지표)
1. **관계 보존율:** 콘텐츠 변형 시 정렬·결합·회피 유지(자동 측정 + 시각).
2. **겹침/잘림 0:** 비평가 또는 결정론 검사로 충돌 카운트.
3. **테마 일관 이미지:** 생성 이미지 평균 색이 팔레트와 ΔE 이내, 비전 비평 "on-brand" 통과율.
4. **루프 수렴:** 평균 반복 횟수 ≤ 2, accept 비율.
5. **A/B:** 4.7 on/off 덱을 사람이 선호 평가.

---

## 8. 단계적 도입
- **4.7-a:** 배치 디렉터 + 관계 기반 솔버(이미지·비평 없이). "콘텐츠가 슬롯과 달라도 깨지지 않는다."
- **4.7-b:** 이미지 디렉터 + nanobanana 테마 일관 생성. "이미지 슬롯이 브랜드에 맞게 채워진다."
- **4.7-c:** 비전 비평 루프. "맞다 → 예쁘다로 수렴."
- 각 단계 끝에 입력→출력 한 바퀴(수직 슬라이스).

---

## 9. 리스크 & 결정
1. **이미지 일관성 실패** → 레퍼런스 14장 풀 활용 + 팔레트 ΔE 검사 + 재생성 상한. illustration 우선(실사보다 충돌 적음).
2. **비용/지연 폭발**(이미지 + 다회 비평) → 옵션화(고품질 모드), 캐싱, 병렬, circuit breaker.
3. **비평 루프 발산** → N=2 상한, 마지막 유효 상태.
4. **실존 인물·저작권** → avatar는 생성 인물 placeholder만, 브랜드 로고는 생성 금지(재사용만).
5. **결정:** 이미지 엔진(Nano Banana Pro 고정 vs 어댑터로 복수), 비평 기준선의 형식(자유서술 vs 구조 패치 — 권장: 구조 패치), 차트를 이미지 생성 vs 네이티브 SVG(권장: 네이티브).

---

## 10. 작업 지침
1. **Claude는 픽셀을 만들지 않는다.** 배치·브리프·비평만. 픽셀=nanobanana.
2. **Claude는 좌표를 만들지 않는다.** 관계·의도만; 좌표=솔버.
3. **관계 우선.** 배치는 4.5 관계 그래프를 만족시키는 방향으로.
4. **결정론 격리 + 예산 가드.** 무작위·다회 호출은 상한·캐싱·circuit breaker.
5. **컨텍스트 엔지니어링.** XML 구조 + 압축 어휘 + tool use + few-shot.
6. **수직 슬라이스.** 4.7-a→b→c 순서, 각 단계 한 바퀴.
