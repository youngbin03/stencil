import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildGrammarSpec } from "../packages/synthesizer/dist/index.js";
import { placeMockup } from "../packages/normalizer/dist/index.js";
import { rasterize } from "../packages/classifier/dist/rasterize.js";

const W = 1920, H = 1080, M = 120;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const wrap = (t, n) => { const w = t.split(" "); const o = []; let l = ""; for (const x of w) { if ((l + " " + x).trim().length > n) { o.push(l.trim()); l = x; } else l += " " + x; } if (l.trim()) o.push(l.trim()); return o; };
const spec = (t) => buildGrammarSpec(JSON.parse(readFileSync(`fixtures/assets/${t}/system.json`, "utf8")));
mkdirSync("fixtures/out/extra", { recursive: true });

// [1] colorful timeline with Frame-16's actual decoration (orange blobs + line at y627)
function timelineFrame16() {
  const s = spec("colorful"), dark = s.colors.text, lineY = 627;
  const nf = s.type.title?.family ?? s.fontFamily, bf = s.type.body?.family ?? s.fontFamily;
  const deco = `<g fill="#FF542D">` +
    `<path d="M836.032 1383C451.647 1383 273.497 1275.7 236.042 1136L799.032 1136L799.032 703C1281.45 721.59 1983.01 940.596 2610 665C2332.04 891.447 1586.52 1383 836.032 1383Z"/>` +
    `<path d="M-16.9534 698C-220.429 698 -297.285 785.879 -294.948 890L-30.9531 890L-30.9531 1113C189.996 1100.61 509.037 963.582 795.032 1131C667.671 992.817 326.922 698 -16.9534 698Z"/>` +
    `<path d="M1848 627C1848 631.418 1851.58 635 1856 635C1860.42 635 1864 631.418 1864 627C1864 622.582 1860.42 619 1856 619C1851.58 619 1848 622.582 1848 627ZM0 627V628.5H1856V627V625.5H0V627Z"/></g>`;
  const items = [
    { date: "2026", label: "LAUNCH", body: wrap("AI drafting beta ships to 50 design partners.", 26) },
    { date: "2027", label: "SCALE", body: wrap("Smart routing GA and the first analytics dashboard.", 26) },
    { date: "2028", label: "EXTEND", body: wrap("Voice control integration and SOC 2 compliance.", 26) },
    { date: "2029", label: "EXPAND", body: wrap("Marketplace opens; expansion to three regions.", 26) },
  ];
  const step = (W - 2 * M) / items.length;
  let g = `<text x="64" y="163.6" font-family="${nf}" font-size="120" font-weight="200" letter-spacing="-3" fill="${dark}">Timeline</text>`;
  items.forEach((it, i) => {
    const x = M + i * step;
    g += `<text x="${x}" y="367" font-family="${nf}" font-size="80" font-weight="200" letter-spacing="-2" fill="${dark}">${esc(it.date)}</text>`;
    g += `<text x="${x}" y="424" font-family="${bf}" font-size="28" font-weight="600" fill="${dark}">${esc(it.label)}</text>`;
    it.body.forEach((ln, k) => { g += `<text x="${x}" y="${474 + k * 34}" font-family="${bf}" font-size="28" fill="#7A7A7A">${esc(ln)}</text>`; });
    g += `<circle cx="${x + 6}" cy="${lineY}" r="6" fill="#FF542D"/>`;
  });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${s.colors.bg}"/>${deco}${g}</svg>`;
}

// [2] green title slide (green #1 style): dark green bg, large lime title + byline
function greenTitle() {
  const s = spec("green");
  const BG = "#003310", LIME = "#C7EF4E";
  const nf = s.type.title?.family ?? s.type.headline?.family ?? "Neuton";
  const bf = s.type.body?.family ?? s.fontFamily;
  // subtle decoration: a large low-opacity lime arc anchored bottom-right + a small
  // lime dot top-left as an eyebrow marker (clear of the title).
  const deco = `<path d="M${W} ${H - 520} C ${W - 300} ${H - 520}, ${W - 520} ${H - 220}, ${W - 520} ${H} L ${W} ${H} Z" fill="${LIME}" fill-opacity="0.10"/>`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${W}" height="${H}" fill="${BG}"/>` +
    deco +
    `<circle cx="76" cy="150" r="9" fill="${LIME}"/>` +
    `<text x="64" y="190" font-family="${bf}" font-size="22" font-weight="600" letter-spacing="3" fill="${LIME}" opacity="0.8">PROJECT BRIEF</text>` +
    `<text x="64" y="420" font-family="${nf}" font-size="170" font-weight="300" letter-spacing="-5" fill="${LIME}">Project Aero</text>` +
    // divider + bold accent segment
    `<line x1="64" y1="478" x2="900" y2="478" stroke="${LIME}" stroke-opacity="0.35"/>` +
    `<rect x="64" y="475" width="180" height="6" rx="3" fill="${LIME}"/>` +
    `<text x="64" y="528" font-family="${bf}" font-size="30" font-weight="600" letter-spacing="1" fill="${LIME}">A NEW STANDARD FOR SMART HOME DESIGN</text>` +
    `<text x="64" y="940" font-family="${bf}" font-size="28" font-weight="600" fill="${LIME}">Alison Lee</text>` +
    `<text x="64" y="978" font-family="${bf}" font-size="24" fill="${LIME}" opacity="0.7">Project Lead · 2026</text></svg>`;
}

// [3] black laptop mockup slide (Frame-32 style): left text + MacBook (checker screen kept)
function blackLaptop() {
  const s = spec("black");
  const asset = JSON.parse(readFileSync("fixtures/assets/black/mockups/black_mockup_4.json", "utf8"));
  const { defs, markup } = placeMockup(asset, { x: 980, y: 250, w: 880, h: 600 }); // no image → checker stays
  const nf = s.type.title?.family ?? s.fontFamily, bf = s.type.body?.family ?? s.fontFamily;
  const body = wrap("Support your visuals with a bit of context, then link away to the live designs.", 30);
  let t = `<text x="${M}" y="430" font-family="${nf}" font-size="80" font-weight="300" letter-spacing="-2" fill="${s.colors.text}">Desktop designs</text>`;
  body.forEach((ln, i) => { t += `<text x="${M}" y="${500 + i * 36}" font-family="${bf}" font-size="28" fill="${s.colors.text}" opacity="0.8">${esc(ln)}</text>`; });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="${s.colors.bg}"/>${t}${markup}</svg>`;
}

// [4] colorful phone mockup (Frame-28 style): orange blobs + text left + iPhone right (empty screen)
function colorfulPhone() {
  const s = spec("colorful");
  const asset = JSON.parse(readFileSync("fixtures/assets/colorful/mockups/colorful_mockup_1.json", "utf8"));
  const { defs, markup } = placeMockup(asset, asset.frameBBox); // native position, empty checker screen
  const nf = s.type.title?.family ?? s.fontFamily, bf = s.type.body?.family ?? s.fontFamily;
  const blobs = `<g fill="#FF542D"><path d="M1874 1310.97C1874 1695.35 1766.7 1873.5 1627 1910.96L1627 1347.97L1194 1347.97C1212.59 865.55 1431.6 163.991 1156 -463C1382.45 -185.041 1874 560.48 1874 1310.97Z"/><path d="M1189 2163.95C1189 2367.43 1276.88 2444.29 1381 2441.95L1381 2177.95L1604 2177.95C1591.61 1957 1454.58 1637.96 1622 1351.97C1483.82 1479.33 1189 1820.08 1189 2163.95Z"/></g>`;
  let t = `<text x="64" y="120" font-family="${bf}" font-size="22" font-weight="600" letter-spacing="2" fill="${s.colors.text}" opacity="0.6">PRODUCT</text>`;
  t += `<text x="64" y="380" font-family="${nf}" font-size="96" font-weight="200" letter-spacing="-2" fill="${s.colors.text}">Ship faster</text>`;
  t += `<text x="64" y="480" font-family="${nf}" font-size="96" font-weight="200" letter-spacing="-2" fill="${s.colors.text}">with Pulse</text>`;
  wrap("Your AI copilot handles the busywork so your team can focus on what matters.", 38).forEach((ln, i) => { t += `<text x="64" y="${580 + i * 36}" font-family="${bf}" font-size="28" fill="${s.colors.text}" opacity="0.75">${esc(ln)}</text>`; });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="${s.colors.bg}"/>${blobs}${t}${markup}</svg>`;
}

// [5] black phone mockup with a USER IMAGE filled into the screen (clip demo)
function blackPhoneFilled() {
  const s = spec("black");
  const asset = JSON.parse(readFileSync("fixtures/assets/black/mockups/black_mockup_2.json", "utf8"));
  const photo = "data:image/jpeg;base64," + readFileSync("fixtures/sample/photo1.jpg").toString("base64");
  const { defs, markup } = placeMockup(asset, asset.frameBBox, photo);
  const nf = s.type.title?.family ?? s.fontFamily, bf = s.type.body?.family ?? s.fontFamily;
  let t = `<text x="${M}" y="120" font-family="${bf}" font-size="22" font-weight="600" letter-spacing="2" fill="${s.colors.text}" opacity="0.6">IN THE APP</text>`;
  t += `<text x="${M}" y="440" font-family="${nf}" font-size="80" font-weight="300" letter-spacing="-2" fill="${s.colors.text}">See it in action</text>`;
  wrap("Drop a screenshot into the device and it clips to the exact screen — notch and all.", 32).forEach((ln, i) => { t += `<text x="${M}" y="${510 + i * 36}" font-family="${bf}" font-size="28" fill="${s.colors.text}" opacity="0.8">${esc(ln)}</text>`; });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><rect width="${W}" height="${H}" fill="${s.colors.bg}"/>${t}${markup}</svg>`;
}

const out = [
  ["colorful_timeline_f16", timelineFrame16()], ["green_title", greenTitle()], ["black_laptop", blackLaptop()],
  ["colorful_phone", colorfulPhone()], ["black_phone_filled", blackPhoneFilled()],
];
for (const [name, svg] of out) { const p = `fixtures/out/extra/${name}.png`; writeFileSync(p, rasterize(svg, 1280)); console.log(p); }
