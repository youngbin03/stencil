"use client";

import { useMemo, useState } from "react";

const THEMES = ["colorful", "black", "green"] as const;
type Theme = (typeof THEMES)[number];

interface Slide {
  layoutId?: string;
  archetype?: string;
  purpose: string;
  svg: string;
  warnings?: string[];
  gate?: "PASS" | "REVISE" | "REJECT";
  novelty?: number;
  overall?: number;
}
interface Deck {
  title: string;
  theme: Theme;
  mode?: string;
  slides: Slide[];
}
type Mode = "filler" | "synthesis";

export default function Page() {
  const [theme, setTheme] = useState<Theme>("colorful");
  const [mode, setMode] = useState<Mode>("synthesis");
  const [prompt, setPrompt] = useState(
    "Aero — an AI design assistant: features, traction, pricing, team, and roadmap",
  );
  const [slideCount, setSlideCount] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);

  async function generate() {
    setLoading(true);
    setError("");
    setDeck(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme, prompt, slideCount, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "generation failed");
      setDeck(data as Deck);
    } catch (e) {
      setError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <main className="wrap">
        <div className="hero">
          <span className="kicker"><span className="logo" /> Stencil</span>
          <h1>Generate a deck, not a template fill</h1>
          <p>New layouts synthesized from a theme&apos;s design grammar — spacing, hierarchy, and components — never a copied slide.</p>
        </div>

      <section className="panel">
        <div className="row">
          <div className="field">
            <label>Theme</label>
            <div className="seg">
              {THEMES.map((t) => (
                <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Mode</label>
            <div className="seg">
              <button aria-pressed={mode === "synthesis"} onClick={() => setMode("synthesis")}>synthesis</button>
              <button aria-pressed={mode === "filler"} onClick={() => setMode("filler")}>filler</button>
            </div>
          </div>
        </div>
        <div className="field">
          <label>Prompt</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the deck you want…" />
        </div>
        <div className="row">
          <div className="field">
            <label>Slides</label>
            <input
              type="number"
              min={1}
              max={12}
              value={slideCount}
              onChange={(e) => setSlideCount(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={generate} disabled={loading || prompt.trim().length < 4}>
            {loading ? "Generating…" : "Generate deck"}
          </button>
          {loading && <span className="status">composing outline + placing slides with Claude…</span>}
          {error && <span className="error">{error}</span>}
        </div>
      </section>

        {deck && <DeckView deck={deck} />}
      </main>
    </>
  );
}

function DeckView({ deck }: { deck: Deck }) {
  return (
    <section className="deck">
      <h2>{deck.title}</h2>
      <div className="sub">
        {deck.theme} · {deck.slides.length} slides
      </div>
      {deck.slides.map((s, i) => (
        <SlideCard key={i} slide={s} index={i} />
      ))}
    </section>
  );
}

function SlideCard({ slide, index }: { slide: Slide; index: number }) {
  const href = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(slide.svg)}`,
    [slide.svg],
  );
  const warn = (slide.warnings ?? []).filter((w) => /high|overlap|out_of|overflow/.test(w));
  return (
    <div className="slide">
      <div className="cap">
        <span className="idx">{String(index + 1).padStart(2, "0")}</span>
        {slide.archetype && <span className="tag">{slide.archetype}</span>}
        <span>{slide.purpose}</span>
        {slide.gate && (
          <span className={`score ${slide.gate.toLowerCase()}`}>
            {slide.gate} · {slide.overall?.toFixed(1)} · nov {slide.novelty?.toFixed(0)}
          </span>
        )}
        {warn.length > 0 && !slide.gate && <span className="score revise">⚠ {warn.length}</span>}
        <a className="dl" href={href} download={`${String(index + 1).padStart(2, "0")}_${slide.layoutId ?? slide.archetype ?? "slide"}.svg`}>
          SVG
        </a>
      </div>
      <div className="frame" dangerouslySetInnerHTML={{ __html: slide.svg }} />
    </div>
  );
}
