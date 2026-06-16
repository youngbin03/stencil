# 개발 문서 — SVG 템플릿 기반 AI 프레젠테이션 생성 시스템

> 코드네임(임시): **Stencil**
> 문서 버전: **v4** · 대상 독자: 개발 에이전트(Claude Code) + 1인 개발자
> 성격: **개발 사양서.** 구현 코드는 포함하지 않는다. 아키텍처·워크플로우·주요 로직·데이터 계약을 정의한다.

---

## 0. 이 문서의 사용법

이 문서는 Claude Code가 프로젝트를 스캐폴딩하고 단계적으로 구현하기 위한 단일 진실 원천(SSOT)이다.

읽는 순서:
1. **1~3장**으로 무엇을/왜 만드는지와 핵심 개념을 잡는다.
2. **6장(데이터 계약)**을 가장 먼저 고정한다 — 모든 단계가 이 계약 위에서 동작한다.
3. **5·7장**으로 단계별 책임과 로직을 구현한다.
4. **11장 로드맵(Phase)**의 순서를 지킨다. 수평이 아니라 수직 슬라이스로 진행한다.

핵심 설계 철학 한 줄: **"템플릿을 한 번 구워 디자인 시스템 에셋으로 만들고, 생성할 때는 원본을 다시 보지 않고 에셋만 조합해 페이지를 만든다. LLM은 무엇을 어디에 둘지 결정하고, 조립기가 좌표를 푼다. LLM은 절대 좌표를 출력하지 않는다."**

### 용어 두 축 (혼동 방지)
- **"단계"** = 제품이 도는 **실행 흐름**: 흡수 → 에셋화 → 구성 → 조립 → 출력 (5단계, 4장).
- **"Phase"** = **개발 순서**(로드맵, 11장). 실행 단계와 1:1이 아니다.
- 과거 문서의 `M0~M7`, `Track`, `Stage` 표기는 **폐기**한다.

---

## 1. 프로젝트 개요

### 1.1 한 문장 정의
프레젠테이션 SVG 템플릿을 업로드하면 그 디자인을 **재사용 가능한 디자인 시스템 에셋**(토큰·블록·레이아웃·장식)으로 한 번 구축하고, 이후 사용자 프롬프트를 받을 때마다 **원본 템플릿을 다시 조회하지 않고 그 에셋만 조합**해 디자인 일관성을 유지한 새 슬라이드 덱을 생성·렌더링하는 시스템.

### 1.2 핵심 모델 — "한 번 굽고, 여러 번 찍는다"
- **굽기(템플릿당 1회):** 템플릿 → 디자인 시스템 에셋 라이브러리(영속 저장).
- **찍기(생성마다):** 에셋 라이브러리 + 프롬프트 → 새 페이지. **원본 SVG 파일 의존 없음.**

이 분리가 제품의 정체다. 생성은 특정 원본 파일이 아니라 "이 템플릿의 디자인 언어"를 소비한다.

### 1.3 합성 방식 — 재합성(에셋 조합) + 장식 통째 재사용
페이지는 **에셋을 조립해 새로 그린다(재합성).** 단, 배경 도형·곡선·기기목업 같은 복잡한 비텍스트 비주얼은 다시 그리지 않고 **추출한 SVG 조각(장식 에셋)을 통째 재사용**한다. 텍스트·레이아웃은 토큰으로 새로 합성한다. 이 하이브리드가 "자유 조합"과 "디자인 충실도"를 동시에 잡는다. (방식 비교는 8장.)

### 1.4 입출력 (확정)
- **입력:** 프레젠테이션 SVG 템플릿(슬라이드 1종 = 1파일, 편집 가능 `<text>` + Figma 레이어명이 `id`로 보존된 상태) + 사용자 프롬프트 + 사용자 업로드 이미지.
- **출력:** 웹에 렌더링되는 편집 가능 SVG 슬라이드 덱 + SVG 다운로드.

### 1.5 보유 입력 현황 (실측)
- `templates/` 3개 테마: `blackdesign`(40), `colorfulldesign`(32), `greendesign`(11). 총 **83장**. 전부 `viewBox 0 0 1920 1080`(16:9).
- 텍스트가 진짜 `<text>`/`<tspan>`. `font-family`·`font-size`·`font-weight`·`fill`·`letter-spacing` 실측 보존. 폰트: Inter / Open Sans / Bricolage Grotesque / Neuton (역할·테마별).
- 역할은 `data-*`가 아니라 `id`(Figma 레이어명)에만: 텍스트(`Title, H1~H3, Headline, Subtitle, Body, Body Medium, Caption, Label, Quote, Content, Number, List item, Metric, Date, PROJECT NAME` 등), 장식(`Decorative, Frame n, Rectangle n, Line`), 이미지(`Image, Profile pic`, 기기목업), 차트(`Diagram, Pie slice, V Axis`).
- 83장 중 **31장**은 base64 래스터(`<image>`) 포함. `blackdesign/Frame-26·30·33` 3장은 `<text>` 없음(장식-only).

---

## 2. 목표 / 비목표

### 2.1 목표 (v1)
- 템플릿 SVG 1종 이상을 **디자인 시스템 에셋**(토큰·블록·레이아웃·장식)으로 구축해 영속 저장한다.
- 사용자 프롬프트 + 업로드 이미지를 받아, 에셋의 블록/슬롯 어휘 안에서 **구성**(어느 레이아웃에 어떤 블록·콘텐츠)을 결정한다(Claude).
- 구성을 **결정론적으로 조립**해 좌표를 풀고, 장식 에셋 위에 토큰 기반 텍스트를 합성해 슬라이드 덱 SVG를 만든다. **생성 시 원본 템플릿 파일을 조회하지 않는다.**
- 결과 덱을 웹에서 보고 SVG로 다운로드한다.
- 디자인 일관성(폰트·크기·색·간격·비주얼)이 템플릿과 동일하게 유지된다.

### 2.2 비목표 (의도적 제외)
아래는 "아직 안 함"이지 "못 함"이 아니다. 에셋/조립 구조가 나중에 흡수하도록 설계하되, v1에서는 구현하지 않는다.

- **미감 조합 엔진(RCE) 풀버전.** RCE는 둘로 쪼갠다. **(추출) 디자인 문법**(정렬 그리드·간격 리듬·위계 비율·그룹핑)은 **v1 에셋화 ②에 포함**한다. **(생성) 관계 그래프 + 제약 솔버(kiwi.js) + 비전 비평 루프**는 별도 상위 모드(v2+)다. v1 조립은 디자인 문법을 규칙으로 쓰되 영역·흐름 기반 결정론으로 한다.
- **장식의 재발명.** 장식은 추출한 조각을 재사용만 한다. 새 장식을 모델이 생성하지 않는다.
- **래스터(PNG·JPG) 템플릿 입력.** 입력은 벡터 SVG로 한정.
- **PPTX·DOCX·PDF 등 비-SVG 출력.** 출력 어댑터로 후속 추가.
- **인브라우저 편집기.** v1은 뷰 + 다운로드만.
- **이미지 자동 생성.** v1은 사용자 업로드.
- **멀티 매체(포스터·공문 등) / 네이티브 차트·표 엔진 / 실시간 협업·결제.**

---

## 3. 핵심 개념 (용어집)

| 용어 | 정의 |
|---|---|
| **디자인 시스템 에셋** | 템플릿에서 한 번 구워낸 영속 자산 묶음 = 토큰 + 블록 + 레이아웃 + 장식. 생성 시 이것만 로드한다(원본 SVG 미조회). |
| **토큰** | 매체 무관 디자인 언어 — 팔레트, 폰트, 타입스케일, 간격 리듬. 전부 `<text>`/도형에서 **실측**. |
| **블록** | 함께 다니는 슬롯 묶음 패턴(eyebrow+title, KPI 카드 등). 내부에 슬롯과 상대 기하를 가짐. `repeatable`이면 콘텐츠 수만큼 복제. |
| **슬롯** | 콘텐츠가 채워지는 칸. 역할(role)·타입(text/image)·제약(max, ratio)을 가짐. |
| **레이아웃** | 한 종류의 슬라이드 형판. 영역(region) + 각 영역 허용 블록 + 참조하는 **장식 에셋**을 정의. 템플릿 1파일 = 1레이아웃. |
| **영역(region)** | 레이아웃 내 배치 단위(header/body/...). 위치·흐름방향(row/column)·간격을 가짐. |
| **장식 에셋** | 템플릿에서 텍스트 슬롯을 제거하고 남긴 비텍스트 비주얼(배경 도형·곡선·기기목업·이미지 플레이스홀더)을 통째로 보관한 SVG 조각. 조립 시 캔버스에 깔린다. |
| **구성(composition)** | 생성 요청마다 Claude가 출력하는 결정. "어느 레이아웃에 어떤 블록을 무슨 콘텐츠로". **좌표 없음.** |
| **조립(assembly)** | 구성 + 에셋 → 절대 좌표 + 텍스트 합성 + 장식 배치를 수행하는 결정론적 과정. 안정성의 원천. |
| **닫힌 어휘** | 슬롯 역할의 표준 집합(6.1). |

**두 층 분리 원칙:** 일관성은 토큰(1층)에서, 적응은 블록·레이아웃(2층)에서 온다. 흡수·에셋·조립 전부에서 이 둘을 섞지 않는다.

---

## 4. 전체 아키텍처

### 4.1 5단계 파이프라인 (단방향)

```
  ┌──────────── 굽기 (템플릿당 1회) ────────────┐
  │                                              │
[템플릿 SVG]                                      │
  │                                              │
  ▼                                              │
① 흡수    SVG 읽기 → 슬롯·역할·실측 속성 분석     │
  │       (id→역할 매핑, bbox, 폰트·색)           │
  ▼                                              │
② 에셋화  분석 결과를 디자인 시스템 에셋으로 저장 │
  │       토큰 · 디자인 문법 · 블록 · 레이아웃 ·  │
  │       장식 조각                              │
  ▼                                              │
[디자인 시스템 에셋]  ──── (Supabase 영속 저장) ──┘
  │
  │   ┌────────── 찍기 (생성마다) ──────────┐
  │   │   [사용자 프롬프트 + 업로드 이미지]   │
  ▼   ▼                                      │
③ 구성   Claude tool use → 구성(좌표 없음)    │
  │      어느 레이아웃·블록·콘텐츠           │
  ▼                                          │
④ 조립   에셋 + 구성 → 좌표 해결 · 텍스트     │
  │      피팅 · 장식 배치 → 슬라이드 SVG      │
  ▼                                          │
⑤ 출력   웹 뷰 + SVG 다운로드               ─┘
```

### 4.2 불변 원칙 (위반 금지)
1. **단방향.** 각 단계는 앞 단계 산출물만 소비한다. 역방향 의존 금지.
2. **생성 시 원본 미조회.** 찍기(③④⑤)는 디자인 시스템 에셋만 읽는다. 원본 템플릿 파일에 의존하지 않는다.
3. **LLM은 좌표를 만들지 않는다.** 구성(③) 출력은 항상 "무엇을 어디 영역에 어떤 콘텐츠로"이고, 픽셀은 조립(④)이 푼다.
4. **계약 우선.** 단계 간 인터페이스는 6장 스키마로만. 한 단계를 통째 교체해도 계약이 같으면 나머지는 안 바뀐다.
5. **결정론 우선.** 같은 에셋 + 같은 구성은 항상 같은 SVG. 무작위성은 구성(③ Claude)에만 격리.
6. **장식 보존.** 장식은 재발명하지 않고 추출 조각을 재사용한다.

---

## 5. 단계별 사양

각 단계는 `책임 / 입력 / 출력 / 주요 로직 / 엣지케이스`로 기술한다. 구체 알고리즘은 7장.

### ① 흡수 (템플릿 SVG → 슬롯 분석)
- **책임:** `data-*` 라벨이 없는 Figma export SVG를 읽어 슬롯·역할·실측 속성을 뽑는다.
- **입력:** 템플릿 SVG(텍스트=`<text>`, id=레이어명).
- **출력:** 슬롯 매니페스트(6.2) + id→역할 매핑 로그.
- **주요 로직:**
  - SVG를 XML/DOM으로 파싱, `viewBox` 기준 px 정규화.
  - `<text>` 노드의 `font-family`·`font-size`·`font-weight`·`fill`·`letter-spacing`·`x`/`y`를 직접 읽는다. 폭/높이는 `getBBox`/메트릭으로 측정.
  - `id`를 닫힌 어휘로 매핑(사전 + 접미사 `_n`·공백·대소문자 정규화). 미매칭은 `decoration` 폴백 + `uncertain` 플래그.
  - `<image>`/기기목업은 이미지 슬롯 후보 또는 장식으로 분류.
- **엣지케이스:** 레이어명이 역할이 아니라 콘텐츠 인스턴스명(`Alison Lee`, `[Company Logo]`)인 경우 → `uncertain`으로 사람 확인 게이트. `<text>` 0개 파일 → 장식-only 레이아웃.

### ② 에셋화 (테마 슬라이드 전체 → 디자인 시스템 1개)
- **책임:** **테마(폴더) 전체의 여러 슬라이드에서 공통 디자인 문법을 추출해 디자인 시스템 1개로 구축.** 슬라이드별로 따로 만들지 않는다 — 디자인 시스템은 정의상 공통 규칙의 집합이다. 여기서 장식 조각도 잘라 보관한다.
- **입력:** 테마 폴더의 모든 SVG.
- **출력:** 테마당 디자인 시스템 에셋 1개(6.3: 공유 토큰·팔레트·문법 + 레이아웃 N개) + 레이아웃별 장식 SVG.
- **주요 로직:**
  - **분류·라벨링 (LLM 비전 주도, Phase 2.5):** `id` 단일 신호의 한계를 넘기 위해, 각 슬라이드를 PNG로 래스터화하고 슬롯 bbox를 번호 오버레이해 Claude 비전 + 구조 메타(bbox·size·color·내용·자식)를 함께 투입 → 슬롯의 **풍부한 의미 역할**(kpi·photo·device_mockup·chart_pie/bar·logo·avatar·icon 등) + 이미지 **교체성** + **컴포넌트 묶음** + **슬라이드 아키타입**(cover/stat/quote/content/...)을 tool use로 받는다. 구조 신호는 결정이 아니라 LLM의 근거로만 들어간다(하드코딩이 상한을 막지 않게). id-규칙은 LLM 실패 시 폴백. **에셋화는 1회성이라 비용보다 정확도 우선** + 결과 영속·사람 검토로 비결정성 흡수.
  - **공유 토큰:** 전 슬라이드의 슬롯·도형 fill 빈도 → 대표 팔레트(bg=최빈 배경, accent, text; 그래디언트·패턴 제외) + `palette`(테마 전체 색 합집합, 빈도순). 역할별 실측 size **최빈값**으로 공유 타입스케일.
  - **디자인 문법(테마 공통):** ① 정렬 그리드(전 슬라이드 슬롯 x/y를 클러스터하되 **빈도 임계 이상**만 = 반복되는 공통 가이드) ② 간격 리듬(컬럼별 인접 gap을 전 슬라이드에서 모아 base unit + tight/normal/loose/section; section은 상위 분위로 outlier 완화) ③ 위계(공유 타입스케일 기반 size 순위 + title:body 비율) ④ 그룹 관습(슬라이드마다 반복되는 역할 시퀀스, 빈도순). 전부 실측·결정론.
  - **레이아웃(슬라이드당 1개):** `decoration_ref` + `archetype`(슬라이드 의도) + `background`(레이아웃 배경색) + **배치 슬롯**(각 슬롯 bbox·align·groupId·mediaKind + **실측 폰트**) + region.
  - **블록:** 그룹 관습을 기초로 반복 패턴을 블록으로 군집(7.2). (v1은 `[]`도 허용; 조립은 레이아웃 `slots`로 직접 합성.)
  - **장식 에셋:** 각 슬라이드에서 텍스트 슬롯 노드를 제거한 사본을 레이아웃별 장식 SVG로 저장.
- **두 층:** 공유 토큰·문법 = 일관성(Claude 어휘), 레이아웃 슬롯의 실측 폰트·bbox = 재합성 충실도. 둘을 모두 보존.
- **엣지케이스:** 배경색은 슬라이드마다 다를 수 있어 레이아웃별 `background`로 보존(테마 대표 bg와 별개). 장식/텍스트 오분류 → `uncertain` 게이트.

### ③ 구성 (프롬프트 → 구성, Claude)
- **책임:** 사용자 의도를 에셋 어휘로 번역.
- **입력:** 디자인 시스템 에셋의 **어휘 요약**(레이아웃 목록 + 영역·허용 블록 + 블록 슬롯·제약; 토큰 상세 불필요) + 프롬프트 + 업로드 이미지 메타.
- **출력:** 구성(6.4).
- **주요 로직 (2패스):**
  - **패스 A — 덱 아웃라인:** 프롬프트 → 슬라이드 수·각 슬라이드 목적·레이아웃 선택.
  - **패스 B — 슬라이드 채움:** 각 슬라이드 영역별 블록 선택·콘텐츠 작성. 슬롯 `max`를 지시에 명시.
  - **출력 강제:** tool use로 구성 JSON 스키마 강제(산문 금지).
- **불변:** 좌표·색값·폰트크기 직접 지정 금지. 레이아웃/블록/콘텐츠만.
- **엣지케이스:** 허용 안 된 블록 선택 → 검증 리젝트 후 1회 재시도. max 초과 → 조립의 피팅에 위임(7.4).

### ④ 조립 (구성 + 에셋 → 슬라이드 SVG)
- **책임:** 좌표 해결 + 텍스트 합성 + 장식 배치. 결정론.
- **입력:** 구성 + 디자인 시스템 에셋(토큰·블록·레이아웃·장식).
- **출력:** 슬라이드별 SVG(편집 가능 `<text>` + 장식).
- **방식: 재합성 단일 경로.** 원본 슬라이드 SVG를 베이스로 쓰는 인플레이스 치환은 **폐기**한다. 조립은 항상 (장식 조각 + 에셋의 슬롯/토큰)으로 새로 합성하며, **원본 SVG를 읽지 않는다.**
- **주요 로직:**
  - 레이아웃의 **장식 조각(`decoration_ref`)을 캔버스에 깐다.** (생성 시 유일하게 읽는 비주얼 자산.)
  - 슬롯 배치: 레이아웃 `slots`의 측정 bbox·align을 사용. `repeatable` 블록은 콘텐츠 수만큼 복제 후 영역 내 분배(간격 리듬).
  - 각 슬롯에 슬롯 실측 폰트(없으면 토큰)로 `<text>`/`<tspan>` 합성. **path 아웃라인 금지.** 각 요소에 `id`+`data-role` 부여.
  - 텍스트 피팅(7.4): 줄바꿈·오토핏 축소·말줄임.
  - 이미지 슬롯(`replaceable`)은 장식의 자리 위에 사용자 `<image>` + `clipPath`로 그림.
- **불변:** 무작위성 없음. 동일 입력 → 동일 출력. 장식 미변형. 원본 SVG 미조회.

### ⑤ 출력 (웹앱 / API)
- **책임:** 템플릿 업로드·에셋 확인/보정·프롬프트 입력·생성 트리거·덱 뷰·다운로드.
- **v1 화면:** ① 템플릿 관리(업로드→흡수→매핑 보정→에셋화→에셋 확인), ② 생성(프롬프트+이미지→덱), ③ 덱 뷰어(SVG 렌더 + 다운로드).
- **v2:** 인브라우저 편집.

---

## 6. 데이터 계약 (스키마)

> 이 장의 스키마는 모든 단계의 인터페이스다. **여기를 먼저 고정**하고 구현한다. 예시는 형태 설명용이며 필드는 확장 가능. 실제 타입 정의처는 `packages/ir`.

### 6.1 닫힌 역할 어휘
`title, subtitle, eyebrow, headline, body, bullet, caption, quote, label, kpi, image, table, logo, footer, pagenum, divider, decoration`
- `decoration`/`divider`는 생성에서 무시(장식 보존만).

### 6.2 슬롯 매니페스트 (흡수 ① 출력)

```json
{
  "layout_id": "colorful_Frame-0",
  "theme": "colorful",
  "canvas": { "w": 1920, "h": 1080 },
  "slots": [
    {
      "id": "Presentation title", "role": "title", "type": "text",
      "bbox": { "x": 64, "y": 174, "w": 1188, "h": 540 },
      "color": "#000000", "fontFamily": "Bricolage Grotesque",
      "fontSize": 180, "fontWeight": 200, "letterSpacing": "-0.03em",
      "align": "left", "uncertain": false
    },
    {
      "id": "Caption", "role": "caption", "type": "text",
      "bbox": { "x": 64, "y": 66, "w": 108, "h": 28 },
      "color": "#000000", "fontFamily": "Inter",
      "fontSize": 28, "fontWeight": 600, "letterSpacing": "0em", "align": "left"
    }
  ],
  "unmapped": [ { "id": "Decorative", "reason": "decoration" } ]
}
```
> 텍스트 슬롯의 폰트·크기·색·자간은 원본 `<text>` 실측값. `bbox.w`/`bbox.h`는 측정값.

### 6.3 디자인 시스템 에셋 (에셋화 ② 출력, 영속)

```json
{
  "template_id": "colorful",
  "theme": "colorful",
  "version": 1,
  "canvas": { "w": 1920, "h": 1080 },
  "tokens": {
    "fontFamily": "Inter",
    "colors": { "primary": "#000000", "accent": "#FF542D", "bg": "#F3F3F3", "text": "#000000" },
    "palette": ["#000000", "#F3F3F3", "#FFFFFF", "#5FA0FB", "#237267", "#FF542D"],
    "type": {
      "title":    { "family": "Bricolage Grotesque", "size": 180, "weight": 200, "lineHeight": 1.0 },
      "subtitle": { "family": "Inter", "size": 40, "weight": 600, "lineHeight": 1.2 },
      "body":     { "family": "Inter", "size": 28, "weight": 400, "lineHeight": 1.4 },
      "caption":  { "family": "Inter", "size": 28, "weight": 600, "lineHeight": 1.2 }
    },
    "spacing": { "unit": 8, "scale": [8, 16, 24, 48, 96] }
  },
  "grammar": {
    "alignmentGrid": { "xGuides": [64, 1283], "yGuides": [66, 127, 174], "margin": 64 },
    "spacingRhythm": { "baseUnit": 8, "gaps": { "tight": 33, "normal": 33, "loose": 81, "section": 81 } },
    "hierarchy": { "ranks": [ { "role": "title", "size": 180, "weight": 200 }, { "role": "body", "size": 28, "weight": 400 } ], "titleToBodyRatio": 6.43 },
    "groups": [ { "id": "g2", "roles": ["caption", "body"], "slotIds": ["Caption_2", "Body"] } ]
  },
  "blocks": [
    {
      "id": "stat_card", "repeatable": true,
      "bbox": { "x": 0, "y": 0, "w": 360, "h": 200 },
      "slots": [
        { "role": "kpi",     "type": "text", "max": 8 },
        { "role": "caption", "type": "text", "max": 40 }
      ]
    }
  ],
  "layouts": [
    {
      "id": "colorful_Frame-0",
      "decoration_ref": "storage://decorations/colorful_Frame-0.svg",
      "background": "#F3F3F3",
      "slots": [
        { "id": "Presentation title", "role": "title", "type": "text", "bbox": { "x": 64, "y": 174, "w": 1188, "h": 540 }, "align": "left", "groupId": "g3", "fontFamily": "Bricolage Grotesque", "fontSize": 180, "fontWeight": 200, "color": "#000000" },
        { "id": "Caption_2", "role": "caption", "type": "text", "bbox": { "x": 1283, "y": 66, "w": 108, "h": 28 }, "align": "left", "groupId": "g2" },
        { "id": "Body", "role": "body", "type": "text", "bbox": { "x": 1283, "y": 127, "w": 631, "h": 62 }, "align": "left", "groupId": "g2" }
      ],
      "regions": [
        { "id": "content", "bbox": { "x": 64, "y": 66, "w": 1850, "h": 648 }, "flow": "column", "gap": 33, "allowed_blocks": [] }
      ],
      "default_slots": ["Caption", "Caption_2", "Body", "Presentation title"]
    }
  ]
}
```

- `decoration_ref`로 레이아웃별 장식 SVG 조각을 참조한다. 조립이 이를 깐다.
- `slots`는 각 슬롯의 측정된 배치(bbox·align·groupId). 조립이 읽는다.
- `default_slots`는 원본 작성 순서의 슬롯 id 목록(참고용).
- `grammar`는 템플릿의 라벨·관계·배치 규칙(v1은 레이아웃당; 후속 테마 단위 병합).
- `type.*`의 family/size/weight는 실측값.

### 6.4 구성 (구성 ③ 출력, 생성마다 · Claude · 좌표 없음)

```json
{
  "deck_id": "string",
  "template_id": "colorful",
  "title": "2026 1분기 성과 보고",
  "slides": [
    {
      "layout_id": "colorful_Frame-0",
      "regions": {
        "header": [
          { "block": "title",   "content": { "title": "2026 1분기 성과" } },
          { "block": "caption", "content": { "caption": "전사 핵심 지표 요약" } }
        ]
      }
    }
  ],
  "assets": [
    { "asset_id": "img_001", "role": "image", "source": "user_upload", "url": "..." }
  ]
}
```

- 이미지 슬롯은 `content`에서 `asset_id`로 자산 참조.
- 구성에는 **색·폰트·좌표가 없다.** 조립이 토큰·장식을 에셋에서 가져온다.

### 6.5 렌더 트리 (조립 ④ 내부, 슬롯→좌표 확정)
조립이 구성과 에셋을 풀어 만든 중간 산출. 각 요소의 `x/y/w/h`·스타일·줄바꿈 결과 확정. 출력 직전 SVG 직렬화 입력. (타입은 `packages/ir`의 `RenderSlide`.)

---

## 7. 주요 로직 상세

### 7.1 흡수 — id→역할 매핑 & 실측 읽기
1. **정규화 키:** `id`에서 `_\d+` 제거, 공백 정리, 소문자화. 예: `Body Medium_3` → `body medium`.
2. **매핑 사전(보정 가능):** `presentation title|title|h1`→title, `headline|h2`→headline, `subtitle|h3 *`→subtitle, `project name|date`→eyebrow, `body|body medium|text block|content|list item`→body, `caption|label|number|metric`→caption, `quote`→quote, `line|v axis`→divider, `image|profile pic|기기목업`→image, `decorative|frame n|rectangle n|diagram|pie slice`→decoration. 미매칭 → decoration + `uncertain`.
3. **실측 읽기:** `<text>`에서 폰트·크기·굵기·색·자간·x/y 직독.
4. **bbox:** `getBBox`(resvg-js/브라우저) 또는 메트릭. baseline·text-anchor로 좌상단·정렬 정규화.

### 7.2 에셋화 — 토큰·블록·레이아웃·장식
1. **토큰:** 색(빈도·면적 가중) / 타입스케일(역할별 실측 size·family·weight) / 간격(슬롯 bbox 간격 최빈값·배수).
2. **블록:** 근접·정렬·역할 반복으로 슬롯 군집(kpi+caption 규칙 반복 → stat_card repeatable). 수동 보정 허용.
3. **레이아웃:** 영역 추정/정의 + 배치 슬롯(bbox·폰트·mediaKind) + `archetype`.
4. **장식 조각:** 원본에서 텍스트 슬롯 노드 제거 → 장식 SVG 직렬화·저장.
> v1에서 블록 자동 군집은 가장 불확실하다. 블록이 비어도 조립은 레이아웃 `slots`(측정 배치)로 직접 합성하므로 동작한다.

### 7.3 구성 — 2패스 + tool use
- **어휘 요약 주입:** 토큰 상세 대신 `레이아웃 목록 + 영역·허용 블록 + 블록 슬롯·제약`만.
- **패스 A(아웃라인):** N장·각 목적·layout_id.
- **패스 B(채움):** 영역별 블록 배열 + 슬롯 콘텐츠. 슬롯 `max` 명시.
- **검증 루프:** (a) 허용 블록만 (b) 필수 슬롯 채움 → 실패 시 1회 재요청.

### 7.4 조립 — 좌표 해결 · 텍스트 피팅 · 장식 배치
1. **장식:** 레이아웃 `decoration_ref` SVG를 캔버스에 깐다(미변형).
2. **배치:** 레이아웃 `slots`의 측정 bbox·align을 사용. repeatable은 복제 후 분배(gap=간격 리듬).
3. **텍스트 합성:** 슬롯마다 슬롯 실측 폰트(없으면 토큰)로 `<text>`/`<tspan>` 생성.
4. **피팅(순서대로):** 줄바꿈(슬롯 폭 기준 단어 래핑) → 오토핏 축소(높이 초과 시 size step↓) → 말줄임(…) + 경고 플래그.
> Claude `max`가 1차 방어, 조립 피팅이 2차.

### 7.5 이미지(사용자 업로드)
- 업로드 → Supabase Storage → `asset_id`.
- 슬롯 `ratio`에 맞춰 커버 크롭(중앙). 장식 플레이스홀더 위에 `<image>` + `clipPath`로 합성. 누락 시 플레이스홀더 + 경고.

---

## 8. 합성 방식 — 재합성 (단일)

조립은 **재합성 단일 경로**다. 원본 슬라이드 SVG를 베이스로 깔고 텍스트만 교체하는 **인플레이스 치환은 폐기**한다(`default_slots`·원본-베이스 개념 제거).

- **무엇:** 템플릿을 토큰·디자인 문법·레이아웃·장식 조각으로 분해해 라이브러리화하고, 생성 시 그 에셋만 조합해 새 슬라이드를 합성한다.
- **생성 시 원본:** 읽지 않는다. 유일하게 읽는 비주얼 자산은 장식 조각(`decoration_ref`).
- **충실도:** 복잡한 비주얼(배경·도형·기기목업·차트 그래픽)은 **장식 조각을 통째 재사용**해 보존하고, 텍스트는 슬롯의 측정 bbox·실측 폰트로 새로 합성.
- **자유도:** 블록 복제·재배치·레이아웃 선택이 자유롭다.

(상위 미감 모드 RCE = 관계 그래프 + 제약 솔버 + 비전 비평. v2+ 별도. 2.2 참조.)

---

## 9. 기술 스택 & 근거

> 출력이 SVG라 전 구간 단일 언어(TypeScript). 1인 개발의 언어 점프 마찰 제거.

| 레이어 | 선택 | 근거 |
|---|---|---|
| 코어(흡수·에셋화·구성·조립) | TypeScript (Next.js Route Handlers / Node) | SVG=XML, JS DOM 파서로 충분. Anthropic TS SDK. |
| SVG 파싱/직렬화 | `@xmldom/xmldom` / 브라우저 DOM | 결정론적. |
| bbox/텍스트 측정 | `getBBox`(resvg-js/브라우저) 또는 `opentype.js` | 흡수 bbox + 조립 피팅. |
| 프론트엔드 | Next.js 15 + TypeScript | 주력 스택. |
| DB·스토리지·인증 | Supabase | 에셋=JSONB, 장식 SVG·이미지=Storage. |
| LLM | Anthropic API (tool use) | 구성 스키마 강제. |
| 비동기 | v1 동기 처리. 느려지면 큐 추가. | 과설계 방지. |

> 폰트는 실측 `font-family`(Inter, Open Sans, Bricolage Grotesque, Neuton)를 웹폰트로 임베드. 한글 폴백(Pretendard) 별도.

---

## 10. 리포지토리 구조

```
stencil/
├─ apps/
│  └─ web/                  # Next.js 15 (UI + API Route Handlers) — 출력 ⑤
├─ packages/
│  ├─ ir/                   # 데이터 계약(타입) — 6장 스키마의 단일 정의처
│  ├─ normalizer/           # 흡수 ① : SVG → 슬롯 매니페스트
│  ├─ extractor/            # 에셋화 ② : 매니페스트 → 디자인 시스템 에셋 + 장식 조각  (미구현)
│  ├─ composer/             # 구성 ③ : Claude tool use → 구성  (미구현)
│  ├─ solver/               # 조립 ④ : 구성 → 좌표/피팅
│  └─ renderer/             # 조립 ④ : 렌더 트리 → SVG (장식 + 텍스트 합성)
├─ scripts/                 # PoC 실행 스크립트 (phase1.mjs 등)
├─ fixtures/
│  └─ out/                  # 데모 출력물 (gitignore)
├─ templates/               # 샘플 템플릿 SVG (3테마 83장)
└─ DEVDOC.md                # 이 문서
```

- `packages/ir`이 6장 계약의 단일 타입 정의처. 모든 패키지가 의존.
- 조립 ④는 `solver`(좌표) + `renderer`(SVG 합성) 둘로 나뉜다.
- `renderer`는 어댑터 패턴: v1 합성, v2 출력 타깃(pptx 등)을 형제로 추가.

---

## 11. 개발 로드맵 (Phase)

> **원칙:** 수직 슬라이스. 각 Phase 끝에 "입력→출력 한 바퀴"가 돈다. 가장 불확실한 것부터.

- **Phase 0 — 흡수 PoC.** `normalizer`로 템플릿 1장 → 슬롯 매니페스트(실측). ✅ **완료.**
- **Phase 1 — 조립 PoC (인플레이스 특수케이스).** 손 콘텐츠 → `solver` → `renderer`로 SVG 1장. 비텍스트 보존·텍스트 치환 검증. ✅ **완료.**
- **Phase 2 — 에셋화.** `extractor`: 토큰 + **디자인 문법**(정렬 그리드·간격 리듬·위계·그룹) + 배치 슬롯 + 레이아웃 + **장식 조각 분리 저장**. 83장 일괄. ✅ **완료.**
- **Phase 2.5 — LLM 비전 분류.** `classifier`: SVG→PNG 래스터화(resvg-js) + 슬롯 bbox 번호 오버레이 + 구조 메타 → Claude 비전(opus) tool use → 풍부한 역할·이미지 교체성(mediaKind)·아키타입. extractor가 주입받아 role 오버라이드 + layout.archetype. id-규칙은 폴백(키 없으면 `--no-classify`). ✅ **완료(green 검증: body/decoration만 → kpi·label·logo·photo·chart + cover/stat/content 아키타입).**
- **Phase 3 — 구성(Claude).** `composer`: tool use로 프롬프트 → 구성. 단일 레이아웃부터. → "프롬프트 → 구성 → 조립 → SVG."
- **Phase 4 — 재합성 조립 고도화.** 텍스트 피팅(줄바꿈·오토핏·말줄임) → 블록 복제·재배치 + 이미지 바인딩 + 멀티 슬라이드 일관성.
- **Phase 4.5 — 관계 그래프 추출 (RCE 내장).** 에셋화에서 ① 장식 구조화 ② 타입된 관계 그래프(슬롯↔슬롯 + 슬롯↔장식)를 결정론 기하 + 비전 보강으로 추출해 에셋에 저장. → 상세: `DEVDOC_phase4.5_relation-graph.md`.
- **Phase 4.7 — Claude 디자인 에셋 배치.** 배치 디렉터(관계 보존 배치: 블록 복제·정렬·결합·강조·장식 회피) + 이미지 슬롯 배치(사용자/기존 에셋 바인딩·크롭, **픽셀 생성 아님**) + 비전 비평 루프(evaluator-optimizer, N≤2). Claude=배치 판단/비평, 솔버=관계→좌표. → 상세: `DEVDOC_phase4.7_design-asset-placement.md`.
- **Phase 5 — 웹앱 셸.** Next.js + Supabase 한 바퀴.
- **Phase 6 — 다듬기.** 3테마 전체·오버플로 엣지·폰트 임베드·경고 UX.
- **(v2+)** 인브라우저 편집 · RCE 생성부(관계→제약 솔버 kiwi.js 좌표 투영 + 렌더-비평-재정제 루프) · PPTX 어댑터 · 멀티 매체.

---

## 12. 리스크 & 미해결 결정

**핵심 리스크**
1. **역할 매핑 정확도(흡수)** — `data-*` 없어 `id`→역할이 틀리면 콘텐츠가 엉뚱한 슬롯에. 레이어명이 콘텐츠 인스턴스명인 경우도 있음. → 사전 + 사람 1회 보정 + `uncertain` 게이트.
2. **블록 자동 군집(에셋화)** — 가장 불확실. → 블록이 비어도 레이아웃 `slots`(측정 배치)로 조립이 동작.
3. **장식 분리 부작용** — 텍스트로 오인된 장식을 지우거나 그 반대. → `uncertain` 플래그 + 사람 확인.
4. **텍스트 피팅 정확도** — 새 콘텐츠가 슬롯 초과 시 오버플로. → `max` + 조립 피팅, 필요 시 정밀 측정 격상.
5. **폰트 임베드** — 실측 폰트 미로딩 시 깨짐. → 웹폰트 임베드 + 한글 폴백.

**미해결 결정**
- id→역할 매핑 사전의 테마별 최종 확정(headline/subtitle 경계, number/metric의 caption vs kpi).
- 블록 자동 군집을 어디까지 신뢰할지 vs 레이아웃 `slots`만으로 갈지.
- 덱 다운로드 형식: 슬라이드별 SVG vs zip vs 후속 PPTX.
- 미감 조합 엔진(RCE) 착수 시점.

---

## 13. 진행 상황 (2026-06)

**완료**
- 리포 골격: npm workspaces, strict TS(NodeNext/ESM), 공유 tsconfig.
- `packages/ir`: 6장 데이터 계약 타입(슬롯 매니페스트·디자인 시스템 에셋+디자인 문법·배치 슬롯·구성·렌더 트리·어댑터).
- **Phase 0 (흡수):** `packages/normalizer` — SVG → 슬롯 매니페스트. id→역할 사전 매핑, 실측 폰트·색·bbox. 3테마 + 장식-only 엣지 검증. (bbox w/h는 휴리스틱; 정밀 getBBox는 후속.)
- **Phase 1 (조립·인플레이스 특수케이스):** `packages/solver`(고정 슬롯) + `packages/renderer`(텍스트 치환). 비텍스트 byte-identical 검증. `scripts/phase1.mjs`.
- **Phase 2 (에셋화, 테마 단위):** `packages/extractor` — **테마 폴더 전체 → 디자인 시스템 1개**(공유 토큰·팔레트 + 공통 디자인 문법[빈도 필터 정렬 그리드·간격 리듬·위계·그룹 관습] + 레이아웃 N개[배경·실측 슬롯·장식조각]). 3테마 = 시스템 3개(black 40 / colorful 32 / green 11 레이아웃). 확인 도구 `scripts/inspect-assets.mjs`(테마별 시스템 뷰어). `ir` 디자인 시스템을 테마 모델로 확장(palette, PlacedSlot 스타일, Layout.background).

- **Phase 2.5 (LLM 비전 분류):** `packages/classifier` — resvg 래스터화 + 슬롯 번호 오버레이 + Claude 비전(opus) tool use → 풍부한 role/mediaKind/replaceable/archetype. extractor 주입. 3테마 전체 분류 완료.
- **Phase 3 (구성, Claude):** `packages/composer` — 어휘 카탈로그(레이아웃 id·archetype·슬롯 역할) → 2패스 tool use(아웃라인→슬롯 채움), 좌표 없음. **조립 재합성화**: `solver.solveSlide`(layout.slots+content→렌더트리) + `renderer.renderComposite`(장식 조각 위 `<text>` 합성). `scripts/phase3.mjs` E2E. 인플레이스/`default_slots` 폐기.
- ✅ **검증:** "1분기 성과 보고" → 7장 덱(cover→agenda→stat×3→content→closing), KPI 칸에 +38%/$2.4B 정확 배치, 배경 장식 보존, 원본 SVG 미조회.

**Phase 4 (조립 고도화) — 진행 중**
- ✅ **텍스트 피팅**(`solver/fit.ts`): CJK 줄바꿈 + 오토핏 축소 + 말줄임. 슬롯 높이 안에 가둬 겹침 방지(잘림/겹침 해소 검증).
- ✅ **composer 글자수 예산**: 슬롯 bbox·fontSize로 `≤N chars` 힌트 + "모든 슬롯 채우기" 지시 → 슬롯에 맞는 길이 생성, fill 누락(0 elems) 해소.
- 남음: 블록 복제·repeatable, 이미지 슬롯 바인딩, 멀티 슬라이드 일관성.
- 한계(→Phase 4.5): 큰 텍스트가 슬롯 초과 시 축소됨(임팩트↓). 슬롯이 늘면 아래를 미는 흐름 재배치는 관계 그래프 기반으로.

**유의**
- API 키는 `.env.local`(gitignore). 이 node(22.17)는 `--env-file` 파싱 실패 → `export $(grep -v '^#' .env.local | xargs)` 사용. 모델 `claude-opus-4-8`.
- 커밋 author 임시값 `Sinobin <dev@stencil.local>` 사용 중 — 실제 git config 확인 필요.

---

## 14. 작업 지침 (Claude Code)
1. **계약 먼저.** 6장 스키마를 `packages/ir`에 타입으로 고정한 뒤 다른 단계를 만든다.
2. **수직 슬라이스.** 11장 Phase 순서. 각 Phase는 입력→출력 한 바퀴.
3. **생성 시 원본 미조회.** 찍기 단계가 원본 SVG를 읽으면 설계 위반. 에셋만.
4. **LLM은 좌표를 만들지 않는다.** 구성 출력에 좌표·색·폰트크기가 들어가면 위반.
5. **결정론 격리.** 무작위성은 구성(Claude)에만. 조립은 같은 입력에 같은 출력.
6. **장식 보존.** 조립은 장식 조각을 변형하지 않는다.
7. 각 Phase 종료 시 `templates/` 샘플로 한 바퀴 돌려 회귀 확인.
