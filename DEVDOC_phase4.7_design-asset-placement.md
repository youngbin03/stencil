# 개발 문서 — Phase 4.7: Claude 기반 디자인 에셋 배치 (Design Asset Placement)

> Stencil 확장편 · 메인 `DEVDOC.md`(v4) + `DEVDOC_phase4.5_relation-graph.md` 위에 선다.
> 성격: 개발 사양서. 구현 코드 미포함. 에이전트 구조·프롬프트 설계·데이터 계약·루프·시스템·검증을 정확히 정의한다.
> **범위 정정:** 이 문서는 **픽셀 이미지 생성이 아니다.** Claude가 디자인 시스템의 에셋(텍스트·이미지 슬롯·장식)을 슬라이드에 **어떻게 배치·구성·그려낼지** 결정하는 단계다. 새 픽셀을 합성하지 않는다.

---

## 0. 한 줄 요약 & 역할 분리

**Claude를 "디자인 디렉터 에이전트"로 세팅해, 관계 그래프(4.5)와 디자인 시스템을 근거로 에셋을 슬라이드에 배치한다.** 어떤 블록을 몇 개, 어느 영역에, 어떤 정렬·강조·결합으로 둘지 Claude가 결정하고, **정확한 좌표는 솔버가 관계를 풀어 계산하며, 픽셀은 만들지 않는다.**

| 능력 | 담당 | 비고 |
|---|---|---|
| 의미 판단·배치 결정·비평 | **Claude** (opus) | tool use, 좌표·색·폰트크기 출력 금지 |
| 좌표/피팅 (결정론) | **solver** | 관계→선형제약→좌표. 같은 입력 → 같은 출력 |
| 합성/렌더 | **renderer(composite)** | 장식 + 텍스트 + (바인딩된)이미지 |
| 이미지 픽셀 | **없음(배치만)** | 이미지 슬롯엔 사용자 업로드/기존 에셋을 바인딩. 신규 픽셀 생성은 비목표 |

핵심: Phase 4.7은 **배치(arrangement)** 다. "이미지를 그려낸다"는 *슬라이드를 시각적으로 구성한다*는 뜻이지 픽셀을 만든다는 뜻이 아니다.

---

## 1. 무엇을 푸는가 (문제)

Phase 3까지: 프롬프트 → 레이아웃 선택 + 슬롯 텍스트 → **고정 슬롯에 그대로** 배치 → 렌더. 한계:
1. **배치가 경직.** 콘텐츠 수가 슬롯과 다르면(KPI 3↔5) 대응 못 함. 텍스트 길이가 변하면 축소/겹침(Phase 4 증상).
2. **관계를 모른다.** 정렬·결합·강조·장식 회피 같은 디자인 의도를 무시하고 bbox에 박는다.
3. **이미지 슬롯 배치가 단순.** 크롭·정렬·장식과의 관계가 없다.

Phase 4.7이 푸는 것: **관계 보존 배치** — 4.5 관계 그래프를 만족시키며 콘텐츠 변형(블록 복제, 길이 변동, 이미지 유무)에도 정렬·결합·강조·장식 회피를 유지한다. + **비전 비평 루프**로 결과를 디자인 문법에 비추어 자기교정한다.

---

## 2. 에이전트 아키텍처 (Claude 세팅)

2개의 역할 분리된 Claude 호출(멀티에이전트). 단일 거대 프롬프트보다 안정적(리서치: 역할 분담이 프롬프트 단순화·확장성).

```
[구성 IR (Phase 3)] + [디자인 시스템 + 관계 그래프 (4.5)]
        │
        ▼
 (1) 배치 디렉터 (Claude, tool use)
     관계 그래프 + 콘텐츠 + 이미지 슬롯(있으면 바인딩될 에셋 메타) →
     배치 계획(PlacementPlan): 어떤 블록을 몇 개, 어느 영역/순서로, 어떤
     관계를 유지하며, 이미지 슬롯을 어떻게(크롭·정렬·우선순위) 배치할지. 좌표 없음.
        │
        ▼
 [solver] 관계 + 배치계획 → 좌표/피팅 (결정론, 관계→선형제약)
        │
        ▼
 [renderer] 장식 + 텍스트 + 바인딩 이미지 → 슬라이드 SVG → (검수용) PNG
        │
        ▼
 (2) 비평가 (Claude 비전, evaluator-optimizer)
     렌더 PNG를 디자인 문법·관계에 비추어 평가 → 수정 지시(패치) → (1)로 환류.
     최대 N=2회. circuit breaker. 수렴 시 종료.
        │
        ▼
 [최종 슬라이드]
```

각 에이전트는 별도 system 프롬프트 + 좁은 tool schema. 모델 opus / 비평은 비전 opus.

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
  "imagePlacements": [
    { "slot": "image_1", "assetId": "user_upload_42", "fit": "cover", "focus": "center",
      "respect": ["avoids: emph_1", "aligned: left with body"] }
  ],
  "keepRelations": ["row(equal): kpi×3", "coupled(tight): kpi+caption", "avoids: subtitle/emph_1"]
}
```
- `repeat` + `items`: repeatable 블록 인스턴스 수(콘텐츠 수 ≠ 슬롯 수 해결).
- `imagePlacements`: 이미지 슬롯에 **바인딩할 에셋(`assetId`)** + 배치 방식(crop fit·focus) + 지켜야 할 관계. **새 픽셀 생성 아님.**
- `keepRelations`: 솔버가 반드시 만족시킬 관계(4.5 그래프의 부분집합 또는 강조).
- 좌표·색·폰트크기 **금지**(불변).

### 3.2 비평 패치 — `CritiquePatch` (비평가 출력)
```json
{
  "verdict": "revise",
  "issues": [
    { "severity": "high", "target": "Subtitle", "problem": "overlaps emphasis circle", "fix": "anchor left, enforce avoids:emph_1" },
    { "severity": "med",  "target": "stat_card", "problem": "uneven gaps between cards", "fix": "row distribute=equal" }
  ]
}
```
- `fix`는 배치/관계 수정 지시로 환원(좌표 아님) → (1) 재실행.
- `verdict: accept`면 종료.

### 3.3 이미지 슬롯 바인딩 (배치만)
- 소스 우선순위: ① 사용자 업로드(`asset_id`) ② 기존 디자인 시스템 에셋(원본 장식의 이미지/목업 재사용) ③ 플레이스홀더(미지정).
- 배치 파라미터: `fit(cover|contain)`, `focus(center|top|…)`, ratio는 슬롯 `mediaKind/ratio` 따름.
- **신규 픽셀 생성은 이 단계 비목표.** (원한다면 외부 이미지 엔진을 v2 옵션 어댑터로 분리; 본 문서 범위 밖.)

---

## 4. 핵심 로직

### 4.1 배치 디렉터 (관계 보존 배치)
- **입력 컨텍스트(context engineering):** 레이아웃 관계 그래프(4.5) + 슬롯 역할/제약 + 블록 정의 + 콘텐츠 + (이미지 슬롯이면) 바인딩 가능한 에셋 메타. XML 태그로 구조화.
- **출력:** `PlacementPlan`(tool use 강제). 규칙:
  - repeatable 블록은 콘텐츠 수에 맞춰 `repeat`.
  - 관계(`aligned/coupled/row/avoids/emphasis_rank`)를 `keepRelations`로 명시 — 디렉터는 "무엇을 몇 개, 어느 영역, 어떤 관계 유지"만 정하고 정확 좌표는 솔버.
  - 이미지 슬롯은 바인딩 에셋·fit·focus·관계만.
- **검증:** 관계 모순(순환)·필수 슬롯 누락·존재하지 않는 assetId → 1회 재요청.

### 4.2 솔버의 관계 기반 배치 (결정론, 4.7의 코어)
관계 엣지 → 선형 제약 변환:
- `above(a,b)` → `a.bottom + gap(strength) ≤ b.top` (gap은 `spacingRhythm`)
- `aligned(left,[..])` → 동일 x + 가장 가까운 `alignmentGrid.x_guides` 스냅
- `row(equal)` → 가로 균등 분배 + `same_size`
- `avoids(slot, deco)` → 슬롯 bbox ∩ deco bbox = ∅ (강조 도형 회피)
- `anchored_to(region)` → 슬롯 박스를 region으로 제한
- `coupled(tight)` → 두 슬롯 gap = rhythm.tight, 함께 이동
- v1(4.7 초기): 경량 충족(그리디 + 스냅 + 회피 밀어내기). v2: 진짜 제약 솔버(kiwi.js). **둘 다 결정론.**
- 과소제약 → 문법 기본값 보충, 과대제약 → 우선순위(필수/선호) 완화.

### 4.3 이미지 슬롯 배치
- 바인딩 에셋을 슬롯 `ratio`로 **커버 크롭**(focus 기준 오프셋). 원본 보존.
- 관계 준수: `avoids/aligned`가 이미지 슬롯에도 적용(예: 텍스트가 이미지 위로 안 가게, 또는 의도적으로 over).
- 렌더러는 `<image>` + `clipPath`로 합성(메인 8.5 경로). 누락 시 플레이스홀더 + 경고.

### 4.4 비평-재정제 루프 (evaluator-optimizer)
1. 렌더 → PNG(resvg).
2. **비전 Claude**에 PNG + (디자인 문법 요약 + 관계 그래프)를 기준선으로 제시: "이 템플릿은 좌측 헤비·여백 큼·강조 도형 우측. 겹침/잘림/대비/균형/관계 위반 점검."
3. `CritiquePatch` → high 이슈는 배치(4.1) 재실행, med/low는 옵션.
4. **종료:** `accept` 또는 N=2회(리서치: 2-3회 후 수익 체감). circuit breaker(토큰/시간) → 마지막 유효 상태.

---

## 5. 프롬프트 / 컨텍스트 엔지니어링 (정확한 세팅)

리서치 반영. 모든 Claude 호출 공통:
1. **XML 구조 프롬프트.** `<role>`, `<design_system>`, `<relations>`, `<content>`, `<task>`, `<constraints>`, `<output_format>`. Opus 4.x는 XML 태그에 가장 잘 반응.
2. **Context engineering > 개별 프롬프트.** 관계 그래프·문법·블록을 **압축 어휘**로 주입(토큰 상세 제외).
3. **tool use로 출력 강제.** 산문 금지, 스키마(`PlacementPlan/CritiquePatch`)로만.
4. **불변 명시.** "좌표·색값·폰트크기를 출력하지 말 것. 블록·관계·배치 의도만." 프롬프트=계약.
5. **few-shot.** 잘 된 배치 예 1~2개(테마에서 추출).
6. **결정론 격리.** 무작위성은 Claude 호출에만. 솔버·렌더러는 동일 입력 동일 출력. 비결정 산출은 영속 + 검토로 흡수.
7. **예산 가드.** 에이전트 루프별 토큰 상한 + circuit breaker + 캐싱(plan 캐시).

---

## 6. 시스템 / 모듈
- `packages/director`: 배치 디렉터(Claude tool use → PlacementPlan). composer와 분리(composer=콘텐츠 작성, director=배치 결정).
- `packages/solver`: 관계 기반 배치 추가(4.2). 기존 고정 슬롯은 폴백.
- `packages/critic`: 비전 비평(evaluator). renderer(PNG) → CritiquePatch.
- 오케스트레이터: 구성(3) → 디렉터(4.1) → 솔버 → 렌더 → 비평(4.4) → 환류. 상한 관리.

---

## 7. 검증 (탁월함 지표)
1. **관계 보존율:** 콘텐츠 변형 시 정렬·결합·회피·강조 유지(자동 측정 + 시각).
2. **겹침/잘림 0:** 비평가/결정론 검사로 충돌 카운트.
3. **루프 수렴:** 평균 반복 ≤ 2, accept 비율.
4. **이미지 배치 적합:** 크롭 focus·관계 준수.
5. **A/B:** 4.7 on/off 덱을 사람이 선호 평가.

---

## 8. 단계적 도입
- **4.7-a:** 배치 디렉터 + 관계 기반 솔버(비평·이미지 없이). "콘텐츠가 슬롯과 달라도 관계를 지키며 깨지지 않는다."
- **4.7-b:** 이미지 슬롯 배치(바인딩·크롭·관계).
- **4.7-c:** 비전 비평 루프. "맞다 → 예쁘다로 수렴."
- 각 단계 끝에 입력→출력 한 바퀴.

---

## 9. 리스크 & 결정
1. **관계 충돌(과대제약)** → 필수/선호 우선순위로 완화, 문법 기본값 보충.
2. **비용/지연(다회 비평)** → 옵션화(고품질 모드), 캐싱, circuit breaker.
3. **비평 루프 발산** → N=2 상한, 마지막 유효 상태.
4. **이미지 부재** → 플레이스홀더 + 경고(생성 안 함; 사용자 업로드 유도).
5. **결정:** 비평 기준선 형식(구조 패치 권장), 솔버 격상 시점(그리디→kiwi.js), 신규 픽셀 생성 어댑터를 v2에 둘지(본 범위 밖).

---

## 10. 작업 지침
1. **Claude는 좌표·픽셀을 만들지 않는다.** 블록·관계·배치 의도만; 좌표=솔버, 픽셀=배치(바인딩)만.
2. **관계 우선.** 배치는 4.5 관계 그래프를 만족시키는 방향으로.
3. **결정론 격리 + 예산 가드.** 무작위·다회 호출은 상한·캐싱·circuit breaker.
4. **컨텍스트 엔지니어링.** XML 구조 + 압축 어휘 + tool use + few-shot.
5. **수직 슬라이스.** 4.7-a→b→c, 각 단계 한 바퀴.
