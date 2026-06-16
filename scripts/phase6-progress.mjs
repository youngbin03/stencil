// Render a bilingual (EN + KR) progress board for the synthesis work as a PNG.
//   node scripts/phase6-progress.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { rasterize } from "../packages/classifier/dist/index.js";

const W = 1680, H = 1180;
const ink = "#0a0a0a", muted = "#6b6b6b", line = "#e2e2e2", bg = "#f7f8fa", panel = "#ffffff";
const green = "#0a7d33", amber = "#9a5b00", blue = "#1f6feb";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const P = [];
const T = (x, y, s, sz, fill = ink, w = 400, anchor = "start") =>
  P.push(`<text x="${x}" y="${y}" font-family="Inter" font-size="${sz}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`);
const box = (x, y, w, h, stroke = line, fill = panel) =>
  P.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
const dot = (x, y, c) => P.push(`<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`);

T(56, 70, "Stencil — Design-Grammar Slide Synthesis", 34, ink, 700);
T(56, 104, "디자인 문법 기반 슬라이드 합성 · 진행 상황", 19, muted, 500);

// pipeline strip
const py = 140, pw = 232, ph = 64, gap = 14; let px = 56;
const steps = [
  ["1 Parse", "흡수"], ["2 Grammar", "문법 추출"], ["3 Skeletons", "아키타입 골격"],
  ["4 Plan", "콘텐츠 계획"], ["5 Synthesize", "레이아웃 합성"], ["6 Evaluate", "품질 평가"],
];
steps.forEach((s, i) => {
  box(px, py, pw, ph, i >= 4 ? blue : line, i >= 4 ? "#eef4fe" : panel);
  T(px + 16, py + 28, s[0], 16, ink, 700);
  T(px + 16, py + 50, s[1], 13, muted);
  if (i < steps.length - 1) P.push(`<text x="${px + pw + 1}" y="${py + 40}" font-size="20" fill="${muted}">→</text>`);
  px += pw + gap;
});

// columns: DONE / quality fixes / open
const colY = 250, colW = 512, colH = 850, cx = [56, 584, 1112];
const cols = [
  { title: "Built  ·  구축 완료", color: green, items: [
    ["Explicit GrammarSpec", "토큰·리듬·그리드·계층·blocks·측정 cardSpec 통합"],
    ["Archetype skeletons (mined)", "예시 슬라이드 region을 정규화·집계 (복사 아님)"],
    ["Grammar-only synthesis", "골격+문법으로 새 레이아웃, 원본 프레임 미복사"],
    ["7-score evaluator + gate", "any<7 revise · novelty<6 reject"],
    ["User image placement", "이미지 zone에 cover-crop, 생성 아님"],
    ["Web app (synthesis/filler)", "모드 토글 + 슬라이드별 점수, 모노크롬 UI"],
  ] },
  { title: "Quality floor  ·  기본 규약", color: blue, items: [
    ["Decoration = theme habit", "장식량을 테마 측정값에서 (강제 아님)"],
    ["Safe inner padding", "안전 여백 = max(grid, 5%) — 가장자리 붙음 해결"],
    ["Min font + lead size", "최소 ~18px · 초점 ~54px (내용 우선)"],
    ["Weak archetypes -> cards", "stat→KPI, comparison→가격 티어 구조"],
    ["Explainable asset choice", "빈 코너·여유반경·팔레트색으로 배치 근거 기록"],
    ["Cohesive centering", "phantom 갭 제거 · tiny 폰트 floor"],
  ] },
  { title: "Open  ·  남은 작업", color: amber, items: [
    ["Web image upload UI", "업로더→generateSynthDeck로 에셋 전달"],
    ["Contrast on color panels", "색 패널 위 텍스트 자동 흰색 전환"],
    ["Decoration vs sparse content", "콘텐츠 적을 때 장식 크기 캡"],
    ["ratio/desc image matching", "종횡비·설명 기반 이미지↔zone 매칭"],
    ["Relation graph direct use", "anchored/aligned/avoids 직접 소비"],
    ["Constraint solver v2 (kiwi)", "자유 배치용 제약 솔버"],
  ] },
];
cols.forEach((c, ci) => {
  const x = cx[ci];
  box(x, colY, colW, colH, line);
  T(x + 22, colY + 38, c.title, 18, c.color, 700);
  P.push(`<line x1="${x + 22}" y1="${colY + 52}" x2="${x + colW - 22}" y2="${colY + 52}" stroke="${line}" stroke-width="2"/>`);
  c.items.forEach((it, i) => {
    const iy = colY + 92 + i * 122;
    dot(x + 30, iy - 6, c.color);
    T(x + 48, iy, it[0], 17, ink, 700);
    T(x + 48, iy + 26, it[1], 14, muted);
  });
});

// footer principles
const fy = colY + colH + 40;
box(56, fy, W - 112, 84, line, panel);
T(78, fy + 34, "Invariants  ·  불변 원칙", 16, ink, 700);
T(78, fy + 62, "Never copy a source frame · LLM writes content + picks archetype, never coordinates · geometry from grammar · deterministic", 14, muted);
T(W - 78, fy + 62, "원본 미복사 · LLM은 내용·아키타입만 · 좌표는 문법에서 · 결정론", 14, muted, 400, "end");

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${bg}"/>${P.join("")}</svg>`;
mkdirSync(resolve("fixtures/out"), { recursive: true });
writeFileSync(resolve("fixtures/out/phase6-progress.png"), rasterize(svg, W));
console.log("wrote fixtures/out/phase6-progress.png");
