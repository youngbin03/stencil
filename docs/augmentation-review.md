# Stencil — 로직 전체 정리 · 분석 · 평가

작성: 시스템 현재 상태(2026-06) 기준. 목적: 추출→문법→생성/증강 전 경로를 처음부터 끝까지 정리하고, 무엇이 잘 되고 무엇이 안 되는지 정직하게 평가한다.

---

## 0. 목표의 변화

- 처음: **프롬프트 → 디자인 시스템 에셋 재조합 → 새 슬라이드 생성** (프롬프트 조건부 생성).
- 현재 합의: 프롬프트 생성은 활용도가 낮아, **기존 30장 템플릿을 문법 안에서 증강(augmentation)해 40~50장으로** — 기존과 겹치지 않게.
- 핵심 제약(회원님): ① 디자인 문법 준수 ② 기존 슬라이드와 비중복 ③ **배경 장식은 크기·위치 유지(색만 변경 가능)** ④ 콘텐츠 일관성·정보량.

---

## 1. 파이프라인 전체 (처음→끝)

### 1.1 추출 (ingest → assetize) — `normalizer`, `extractor`
입력: 테마별 템플릿 SVG(콘텐츠 포함). 산출(`system.json` + 장식 SVG):
- **slots**: 텍스트/이미지 자리 (bbox, role, mediaKind, clip). 좌표는 transform 합성으로 정확.
- **decorationModel**: 장식 요소들 `{kind(background/emphasis/accent/image_holder/chart/divider/frame/texture), bbox, color, z, salience}`.
- **relationGraph**: 슬롯·장식 간 관계 `over / avoids / anchored_to / aligned / coupled / emphasis_rank …`.
- **regions**: 의미 영역(header/title/cards/body/footer).
- **cardSpec**: 반복 카드 내부 기하(측정값).
- **archetype**: 비전 분류(cover/stat/content/comparison/quote/section/agenda/gallery/team/closing).
- **mockup asset**: 디바이스 프레임 + 화면 clip(분리 추출).
- **decoration SVG**(`decorations/<id>.svg`): 텍스트 제거된 장식 레이어.

### 1.2 문법 구조화 — `synthesizer/grammar.ts` (`buildGrammarSpec`)
`system.json`을 합성이 쓰는 `GrammarSpec`으로 집계:
- 팔레트, 색(primary/accent/bg/text), **타입 스케일**, **그리드(xGuides·margin)**, **spacing rhythm**, **hierarchy**, **blocks**, **cardSpecs**(역할 시그니처별), **archetype 골격(skeleton)**(예시 슬라이드 region들의 median zone), **decoration treatments**(kind@anchor·salience·shapeIds), `relationConventions`.
- 별도: **decorations-lib.json** — 장식 도형(곡선/색패널/밴드)의 실제 frag + 실측 bbox + 색 + 풀컬러 bg 여부. (어휘 일반화: colorful 곡선, green 색패널, black 밴드.)

### 1.3 경로 A — 프롬프트 합성 (현 웹앱)
`director(LLM)` 아웃라인+콘텐츠 → `synthesizeFromGrammar`(골격에 콘텐츠 배치, split/카드/이미지) → `solveDeckSlide`(피팅·reflow·셀프체크) → `pickDecoration`(장식) → `renderComposite`(+목업) → `evaluateSlide`(7지표 게이트). 배포: stencil-web.vercel.app.

### 1.4 경로 B — 증강 (신규, `scripts/augment.mjs`)
프롬프트 없음. **장식(충실) × 다른 콘텐츠 구조(open region 배치)**:
1. 각 슬라이드의 **장식을 정제**(배경 rect·이미지홀더(pattern)·divider line·얇은 line-path 제거, 풀컬러 bg 감지).
2. **open region 측정** = 장식 salient 덩어리(clamped bbox)의 **반대편 빈 밴드**(가장자리를 경계로). 빈자리 없으면 스킵.
3. **구조(title/list/kpi/quote)** 를 그 영역에 들어갈 때만(너비·높이 검사) 배치. 콘텐츠는 고정 플레이스홀더.
4. **novelty**: 원본 archetype 쌍 제외 + (장식×구조×색) 시그니처 중복 제거.
5. 렌더(실제 장식, 풀컬러면 흰 장식+흰 텍스트) → 갤러리. (colorful 30 → +43)

---

## 2. 분석 · 평가

### 2.1 잘 된 것
- **추출 기반기**: 타입/그리드/리듬/계층/카드내부/관계/목업/장식(어휘 일반화) — 견고. 측정 정확(transform·opentype).
- **목업**: 프레임+화면 clip 분리·재배치 — 충실.
- **장식 충실(증강)**: 크기·위치·색을 안 건드리고 그대로 사용(차용·축소·이동 없음) — 회원님 요구 부합.
- **풀컬러 변형**: 색 배경 + 흰 장식 + 텍스트 대비 반전 — 발동 시 정상.
- **best 사례**(Frame-0 kpi, Frame-21 kpi 풀컬러, Frame-26 quote): 장식 충실 + 새 구조 + 겹침 없음 = 진짜 새 슬라이드.

### 2.2 안 된 것 (정직한 결함, 증거 포함)
1. **장식↔콘텐츠 overlap** — *Frame-15 list*: 세로 연결선·점이 리스트 텍스트 위를 가로지름. 원인: openRegion이 **얇은/저-salience 장식을 장애물로 안 잡음**.
2. **원본 near-duplicate** — *Frame-0 title*: cover 장식 + title 구조 ≈ 원본 cover(텍스트만 다름). 원인: novelty 필터가 **archetype 이름만 비교**, 구조적 동등성 미검출.
3. **콘텐츠 단조 (가장 큼)** — 43장이 **같은 4세트 플레이스홀더**를 반복. 정보적으로 43개의 다른 슬라이드가 아님. 콘텐츠 풀/변주 부재.

### 2.3 하드코딩 · 매직넘버 위험 (일반화 저해)
눈으로 튜닝한 상수가 누적: open band 임계 `0.3W/0.22H`, fits `0.45~0.6`, GAP 48, salience `0.2`, 얇은선 `<6px`, isDark `0.62`, (합성 경로) `coverage<0.02`, `bbox>120`, `overlap 0.18/0.03`, NEEDS_CARDS·comparison 역할 강제, 색 vivid 회전. → 새 템플릿에서 깨질 수 있음.

### 2.4 구조적 한계
- **open region 정확도**가 품질을 좌우하는데, 장식 bbox 기반이라 **유기 곡선·다중요소·얇은 선**에 약함(Frame-15 실패).
- **novelty 시그니처가 얕음**(archetype 이름·색 수준) → 구조적 중복 못 거름.
- **콘텐츠가 정적**(풀 없음) → 다양성 한계.
- 경로 A(프롬프트)와 경로 B(증강)가 **장식 로직이 다름**(pickDecoration vs augment) — 이원화.

### 2.5 차원별 평가 (주관, 0–10)
| 차원 | 점수 | 비고 |
|---|---|---|
| 문법 준수(타입/색/그리드) | 8 | 견고 |
| 장식 충실도 | 7 | 충실하나 overlap·near-dup 잔존 |
| 겹침 회피 | 5 | open region 약점(Frame-15류) |
| 신규성(기존 대비) | 5 | near-dup·콘텐츠 단조 |
| 콘텐츠 품질/다양성 | 3 | 4세트 반복 |
| 일반화(새 템플릿) | 4 | 매직넘버 의존 |
| 코드 명료성 | 5 | 경로 이원화·상수 누적 |

---

## 3. 개선 로드맵 (우선순위)

1. **open region 강건화** — 장애물 = **비배경 장식 전체**(salience 무시, 얇은 선·점·다중요소 포함). 가능하면 bbox가 아니라 **실제 ink 마스크**(래스터화 후 빈 영역 탐색)로 → Frame-15류 overlap 제거.
2. **콘텐츠 풀 + 변주** — 구조별 텍스트 풀(일관 보이스·정보량 규칙 유지)에서 슬라이드마다 다른 세트 → 43장이 43개 다른 내용.
3. **구조적 near-dup 필터** — 구조 zone 배치 vs 그 데코 원본 콘텐츠 배치 유사도로 차단(title-on-cover 류).
4. **매직넘버 → 측정 기반** — 임계를 테마 통계(분포)에서 도출, 상수 제거.
5. **경로 통합** — 장식 로직(pickDecoration ↔ augment)을 하나로.

---

## 4. 결론 / 방향

- **방향 자체(장식 충실 × open region에 새 콘텐츠 구조)는 옳다** — best 사례가 증명.
- 그러나 **open region 정확도·콘텐츠 다양성·near-dup 필터**가 현재 약점이라, "제대로 됐다"고 보긴 이르다.
- 다음 작업은 **로드맵 1·2(open region 강건화 + 콘텐츠 풀)** 가 체감 임팩트 최대. 이후 3·4·5로 일반화·정리.
