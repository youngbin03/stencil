# 개발 문서 — Phase 4.5: 관계 그래프 추출 (Relation Graph Extraction)

> Stencil 확장편 · 메인 `DEVDOC.md`(v4)의 **에셋화(②)** 를 심화한다.
> 성격: 개발 사양서. 구현 코드 미포함. 로직·데이터 계약·시스템·검증을 정확히 정의한다.
> 영감: AlphaFold2의 "관계(pair) 예측 → 좌표는 마지막 투영". 사용자 RCE 아이디어 반영.

---

## 0. 한 줄 요약 & 위치

**디자인 시스템 에셋에 "요소 간 조합 관계"를 1급 데이터로 추가한다.** 지금 에셋은 슬롯 배치(bbox·폰트)와 약한 그룹 관습만 가진다. 여기에 **장식의 구조**와 **타입된 관계 그래프**(슬롯↔슬롯, 슬롯↔장식)를 더해, 생성/배치(Phase 4.7)와 향후 제약 솔버(v2)가 디자인 의도를 보존하며 변형할 수 있게 만든다.

- 위치: 실행 5단계 중 **② 에셋화** 내부의 추가 산출물. 굽기(템플릿당 1회)에 속한다.
- 불변 준수: 결정론 우선(기하 측정), 비전은 보강만, 결과 영속·사람 검토.
- 비목표: 제약 솔버로 좌표를 새로 푸는 것(= v2 RCE 생성부). 4.5는 **추출만** 한다.

---

## 1. 왜 필요한가 (문제 정의)

현재 에셋의 관계 표현은 두 가지뿐이다:
1. `grammar.groups` — "어떤 역할들이 붙어다닌다"는 빈도 통계(`kpi+label`). 타입이 없다.
2. `layout.slots[].groupId` — 슬라이드 내 근접 묶음. 방향·정렬·강조 관계가 없다.

그리고 **장식(decoration)은 텍스트만 뺀 SVG 통짜**라, 그 안의 의미 구조(배경/강조 곡선/포인트 도형/이미지 홀더/차트)와 텍스트 슬롯의 관계가 **전혀 없다.**

결과적으로 조립(④)은 "슬롯 bbox에 콘텐츠를 박는" 수준에 머문다. 콘텐츠 수가 슬롯과 다르거나(KPI 3→5), 텍스트 길이가 변하거나, 장식과의 조화가 필요할 때 **디자인 의도를 모른 채** 깨진다(Phase 4에서 본 겹침·축소가 그 증상).

**해결:** 템플릿이 이미 담고 있는 관계를 추출해 저장한다. 좌표가 아니라 *관계*를 저장하면, 콘텐츠가 달라져도 관계를 만족시키는 새 좌표를 (4.7/솔버가) 안정적으로 풀 수 있다.

---

## 2. 산출물 개요 (무엇을 추가하나)

에셋(`DesignSystemIR`)에 레이아웃별로 두 가지를 추가한다.

1. **장식 구조(`decorationModel`)** — 장식 SVG를 의미 요소로 분해한 목록.
2. **관계 그래프(`relationGraph`)** — 노드(슬롯 + 장식요소) + 타입된 엣지.

테마 레벨에는 **관계 관습(`relationConventions`)** — 여러 슬라이드에서 반복되는 관계 패턴 — 을 집계해 둔다(Claude 어휘로 사용).

---

## 3. 데이터 계약 (스키마)

### 3.1 장식 구조 — `DecorationModel`

장식 SVG를 통짜로 두되, **그 위에 "의미 영역" 인덱스**를 얹는다(원본 SVG는 변형하지 않는다 — 불변 원칙).

```json
{
  "layoutId": "colorful_Frame-14",
  "decorationRef": "…/decorations/colorful_Frame-14.svg",
  "elements": [
    { "id": "bg",        "kind": "background", "bbox": {…}, "color": "#237267", "z": 0 },
    { "id": "emph_1",    "kind": "emphasis",   "bbox": {…}, "color": "#5FA0FB", "shape": "circle", "z": 1, "salience": 0.9 },
    { "id": "accent_1",  "kind": "accent",     "bbox": {…}, "color": "#FF542D", "shape": "blob", "z": 1, "salience": 0.4 },
    { "id": "imgholder_1","kind": "image_holder","bbox": {…}, "ratio": "1:1", "z": 1 },
    { "id": "chart_1",   "kind": "chart",      "bbox": {…}, "chartType": "pie", "z": 1 },
    { "id": "divider_1", "kind": "divider",    "bbox": {…}, "orientation": "horizontal", "z": 1 }
  ]
}
```

- `kind` 닫힌 집합: `background | emphasis | accent | image_holder | chart | divider | frame | texture`.
- `salience`(0~1): 시각 무게(면적 × 색 대비). 강조 영역 식별/배치 회피에 사용.
- `z`: 그리기 순서(배경 0 → 전경). 텍스트는 항상 그 위.
- `id`는 안정적(재추출에도 동일하도록 bbox 해시 기반 권장).

### 3.2 관계 그래프 — `RelationGraph` (레이아웃당)

```json
{
  "layoutId": "colorful_Frame-14",
  "nodes": [
    { "id": "Subtitle", "kind": "slot",       "role": "subtitle", "bbox": {…} },
    { "id": "Metric",   "kind": "slot",       "role": "kpi",      "bbox": {…} },
    { "id": "emph_1",   "kind": "decoration", "role": "emphasis", "bbox": {…} }
  ],
  "edges": [
    { "type": "above",        "a": "Subtitle", "b": "Metric" },
    { "type": "aligned",      "axis": "left",  "nodes": ["Subtitle", "Metric", "Caption"] },
    { "type": "coupled",      "a": "Metric",   "b": "Caption", "strength": "tight" },
    { "type": "row",          "nodes": ["Metric", "Metric_2", "Metric_3"], "distribute": "equal" },
    { "type": "same_size",    "nodes": ["Metric", "Metric_2", "Metric_3"] },
    { "type": "emphasis_rank","order": ["Subtitle", "Metric", "Caption"] },
    { "type": "reading_order","order": ["Subtitle", "Metric", "Caption", "Metric_2", "…"] },
    { "type": "anchored_to",  "slot": "Subtitle", "region": "left_half" },
    { "type": "avoids",       "slot": "Metric",   "decoration": "emph_1" },
    { "type": "over",         "slot": "Caption",  "decoration": "bg" }
  ]
}
```

#### 관계 어휘 (닫힌 집합)
- **공간:** `above, below, left_of, right_of, row, column, grid`
- **정렬:** `aligned(axis: left|center|right|top|baseline)`
- **결합:** `coupled(strength: tight|loose|section)` — gap 실값은 `grammar.spacingRhythm`에서 해석
- **크기:** `same_size, larger_than, proportional(ratio)`
- **순서/위계:** `reading_order, emphasis_rank`
- **분배:** `row/grid` 내부 `distribute(equal|space_between)`
- **장식 관계:** `anchored_to(region), inside(shape), over(decoration), avoids(decoration), beside(decoration)`
  - `region` 닫힌 집합: `left_half|right_half|top|bottom|center|left_third|right_third|…`

> 모든 관계 타입은 **선형 제약으로 환원 가능한 것만** 둔다(v2 제약 솔버 입력 호환). 표현력 vs 솔버 단순성의 경계를 어휘로 강제한다.

### 3.3 테마 관계 관습 — `relationConventions`

```json
{ "conventions": [
  { "pattern": ["coupled(tight): kpi+caption", "row(equal): kpi×N"], "support": 6 },
  { "pattern": ["above: title>body", "aligned(left): title,body"], "support": 9 }
]}
```
- 여러 슬라이드에서 반복된 관계 묶음 + 출현 횟수(`support`). Claude 어휘 요약·생성 가이드로.

### 3.4 IR 통합
`DesignSystemIR.layouts[i]`에 `decorationModel`, `relationGraph` 추가. `DesignSystemIR`에 `relationConventions` 추가. (기존 필드 불변, 추가만.)

---

## 4. 추출 로직 (정확한 알고리즘)

### 스테이지 A — 장식 구조 분해 (`decorationModel`)
장식 SVG를 파싱해 의미 요소를 식별한다. **결정론 1차 + 비전 보강.**

1. **요소 수집:** 장식 SVG의 도형 노드(`rect/path/circle/ellipsis/polygon/image/g[id]`)를 bbox·fill·자식수로 수집.
2. **결정론 분류(규칙은 후보만, 결정 아님):**
   - `background`: full-canvas rect(폭≥98% 캔버스).
   - `image_holder`: `<image>` 또는 체크무늬/단색 플레이스홀더 패턴 + 큰 bbox. `ratio`=bbox 비율.
   - `chart`: 한 그룹 내 다수 arc-path(pie) 또는 반복 rect(bar) 또는 axis 레이어.
   - `divider`: 가늘고 긴 rect/line(두께 ≤ 4px, 종횡비 극단).
   - `emphasis/accent`: 큰 accent-color 도형. `salience` = 면적 × |색-배경 대비|. 상위 = emphasis, 하위 = accent.
   - `texture/frame`: 반복 패턴·테두리.
3. **비전 보강(1회, 애매한 것만):** 장식 PNG + 후보 박스 번호 오버레이 → Claude 비전 tool use로 `kind` 확정(특히 emphasis vs accent vs texture, chart vs decoration). 결정론 confidence가 낮은 요소만 질의.
4. **출력:** `decorationModel.elements`(z = DOM 순서).

### 스테이지 B — 슬롯↔슬롯 관계 (결정론)
슬롯 bbox만으로 기하 측정. 무료·안정.

- `above/below/left_of/right_of`: 두 슬롯 bbox 중심·경계 비교(겹침 임계 포함).
- `aligned(axis)`: left-x(또는 center/right/top/baseline) 차이 ≤ `ALIGN_TOL`(8px) → 같은 축 정렬 집합으로 묶음.
- `coupled(strength)`: 같은 컬럼·인접 + gap을 `spacingRhythm`에 매핑(tight/loose/section).
- `row/column`: 같은 y(±tol) 다수 = row, 같은 x 다수 = column. `same_size`: bbox w/h 유사(±10%). `distribute`: 간격 균등성 검사.
- `emphasis_rank`: 폰트 size 내림차순(동률은 면적·상단좌측 우선).
- `reading_order`: 좌→우·위→아래 가중 정렬(Z 패턴), 그룹은 묶어서.

### 스테이지 C — 슬롯↔장식 관계 (기하 + 비전)
- `over(decoration)`: 슬롯 bbox가 장식요소 bbox 내부 → 그 위에 얹힘.
- `inside(shape)`: 슬롯이 emphasis/accent 도형 경계 안.
- `anchored_to(region)`: 슬롯 중심이 속한 캔버스 영역(좌/우/중앙/3분할) 라벨.
- `avoids(decoration)`: 같은 행 높이대에 큰 emphasis가 있고 슬롯이 그 반대편 → 회피 관계(가장 중요: 생성 시 텍스트가 강조 도형을 침범하지 않게).
- `beside(decoration)`: 인접하되 비겹침.
- 비전 보강: "이 KPI 묶음이 시각적으로 강조 원 안에 앉아있다" 같은 게슈탈트만.

### 스테이지 D — 테마 집계 (`relationConventions`)
레이아웃별 관계 그래프에서 **역할 기반 관계 패턴**(구체 id 제거)을 추출 → 빈도 집계 → `support` 높은 순. 예: `coupled(tight): kpi+caption`이 6개 슬라이드 → convention.

### 신호 융합 & 신뢰도
- 각 엣지에 `confidence`(0~1): 결정론은 측정 명확도, 비전은 모델 동의 여부. 두 신호 일치 → 1.0, 불일치 → 사람 검토 플래그.
- `confidence < 0.6` 엣지는 `review:true` → M6 보정 UI 노출.

---

## 5. 시스템 / 모듈

- 신규 패키지 `packages/relations`(또는 extractor 내 서브모듈): 입력 = 슬롯 매니페스트 + 장식 SVG + (선택) 비전 클라이언트, 출력 = `decorationModel` + `relationGraph`.
- extractor가 에셋화 파이프라인에서 호출(흡수→분류→**관계추출**→집계→저장). 비전은 의존성 주입(키 없으면 결정론만).
- 결정론 코어는 순수 함수(테스트 용이). 비전 보강은 옵션 레이어.
- 산출은 `system.json`에 인라인 + 검토용 시각화(inspect-assets에 관계 오버레이 추가: 슬롯/장식 박스 + 엣지 선).

---

## 6. 검증 (탁월함의 객관 지표)

1. **관계 정합성:** 추출된 엣지가 원본과 모순 없는가(순환 above 등 사전 탐지).
2. **재현 테스트:** 관계 그래프 + 원본 콘텐츠로 4.7/솔버가 배치 → 원본과 IoU(슬롯 bbox 겹침)·정렬 일치도 측정. 높을수록 추출이 옳다.
3. **변형 강건성:** 콘텐츠 수를 ±2 바꿔도 관계(정렬·결합·회피)가 유지되는가(시각 검수).
4. **사람 검토율:** `review:true` 비율이 낮을수록 자동 추출 품질 높음.

---

## 7. 리스크 & 결정
1. **장식 분해의 모호성**(emphasis vs 단순 장식) → 비전 보강 + salience 임계 + 사람 검토.
2. **관계 폭발**(N² 엣지) → 의미 있는 관계만(인접·정렬·강조), confidence 필터, 역할 관습으로 압축.
3. **어휘 표현력 한계** → 항상 선형 제약 환원 가능한 것만 점진 추가.
4. **결정:** `region` 분할 해상도(3분할 vs 9분할), `avoids` 판정 임계, 비전 보강 범위(전체 vs 저신뢰만 — 권장: 저신뢰만).

---

## 8. 작업 지침
1. **결정론 우선.** 기하로 측정 가능한 모든 관계는 결정론으로. 비전은 저신뢰 보강만.
2. **추출만.** 4.5는 좌표를 새로 풀지 않는다(그건 4.7/솔버).
3. **선형 제약 호환.** 모든 관계는 v2 제약 솔버 입력으로 환원 가능해야 한다.
4. **원본 불변.** 장식 SVG는 변형 금지. `decorationModel`은 그 위의 인덱스다.
5. **검토 게이트.** 저신뢰 관계는 사람 1회 보정(에셋화 1회성이라 영구 효과).
