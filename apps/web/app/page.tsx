"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Download, FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplateManager, type ThemeInfo } from "@/components/template-manager";
import { ThemePicker } from "@/components/theme-picker";
import { cn } from "@/lib/utils";

type Theme = string;
type Mode = "layout" | "synthesis" | "filler";

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
interface Attachment {
  id: string;
  name: string;
  kind: "image" | "file";
  dataUrl?: string;
}

export default function Page() {
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [theme, setTheme] = useState<Theme>("");
  const [mode, setMode] = useState<Mode>("layout");

  const loadThemes = useCallback(async () => {
    const d = await fetch("/api/themes").then((r) => r.json()).catch(() => ({ themes: [] }));
    const list: ThemeInfo[] = d.themes ?? [];
    setThemes(list);
    setTheme((cur) => (cur && list.some((t) => t.slug === cur && t.baked) ? cur : list.find((t) => t.baked)?.slug ?? ""));
  }, []);
  useEffect(() => { void loadThemes(); }, [loadThemes]);
  const [prompt, setPrompt] = useState("");
  const [slideCount, setSlideCount] = useState(6);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deck, setDeck] = useState<Deck | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const grow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, []);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files)) {
      const id = `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`;
      const isImg = f.type.startsWith("image/");
      const att: Attachment = { id, name: f.name, kind: isImg ? "image" : "file" };
      if (isImg) {
        const reader = new FileReader();
        reader.onload = () => setAttachments((a) => a.map((x) => (x.id === id ? { ...x, dataUrl: String(reader.result) } : x)));
        reader.readAsDataURL(f);
      }
      next.push(att);
    }
    setAttachments((a) => [...a, ...next]);
  }

  async function generate() {
    if (loading || prompt.trim().length < 4) return;
    setLoading(true);
    setError("");
    setDeck(null);
    try {
      // Public-demo access code (only needed if the server sets GATE_PASSWORD).
      let gate = typeof window !== "undefined" ? window.localStorage.getItem("gate") ?? "" : "";
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json", ...(gate ? { "x-gate": gate } : {}) },
        body: JSON.stringify({ theme, prompt, slideCount, mode }),
      });
      const data = await res.json();
      if (res.status === 401 && typeof window !== "undefined") {
        gate = window.prompt("이 데모는 접근 코드가 필요합니다 (Access code):") ?? "";
        if (gate) { window.localStorage.setItem("gate", gate); setError("코드를 입력했습니다. 다시 생성해 주세요."); return; }
      }
      if (!res.ok) throw new Error(data.error ?? "generation failed");
      setDeck(data as Deck);
    } catch (e) {
      setError(e instanceof Error ? e.message : "generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-28 pt-16 sm:pt-24">
      {/* Brand — minimal, no top tab bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mb-10 text-center"
      >
        <div className="mb-5 inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Stencil" className="size-5 rounded-[6px]" /> Stencil
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.08]">
          Describe a deck. Get new layouts.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
          New slides synthesized from a theme&apos;s design grammar — never a copied template.
        </p>
      </motion.div>

      {/* Composer */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-[22px] border bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_-12px_rgba(0,0,0,0.12)]"
      >
        {/* attachments */}
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-wrap gap-2 px-2 pb-1 pt-2"
            >
              {attachments.map((a) => (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group relative flex items-center gap-2 rounded-lg border bg-secondary/60 py-1.5 pl-1.5 pr-2.5 text-[13px]"
                >
                  {a.kind === "image" && a.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.dataUrl} alt={a.name} className="size-7 rounded-md object-cover" />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-md bg-background">
                      <FileText className="size-3.5 text-muted-foreground" />
                    </span>
                  )}
                  <span className="max-w-32 truncate font-medium">{a.name}</span>
                  <button
                    onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <Textarea
          ref={taRef}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
          }}
          placeholder="Describe the deck you want — e.g. “Pulse, an AI support copilot: problem, features, traction, pricing, CTA”"
          className="min-h-[96px] resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] shadow-none focus-visible:ring-0"
        />

        {/* toolbar */}
        <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.svg"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} title="Attach files or images">
            <Paperclip className="size-[18px]" />
          </Button>

          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="h-8">
              <TabsTrigger value="layout">layout</TabsTrigger>
              <TabsTrigger value="synthesis">synthesis</TabsTrigger>
              <TabsTrigger value="filler">filler</TabsTrigger>
            </TabsList>
          </Tabs>

          <ThemePicker themes={themes} value={theme} onChange={setTheme} onManage={() => setManagerOpen(true)} />

          <div className="ml-auto flex items-center gap-1.5">
            <Stepper value={slideCount} setValue={setSlideCount} />
            <Button size="icon" onClick={generate} disabled={loading || prompt.trim().length < 4 || !theme} title="Generate (⌘↵)">
              {loading ? <Loader2 className="size-[18px] animate-spin" /> : <ArrowUp className="size-[18px]" />}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* secondary actions */}
      <div className="mt-3 flex items-center justify-between px-1">
        <TemplateManager themes={themes} onChanged={loadThemes} open={managerOpen} onOpenChange={setManagerOpen} />
        <AnimatePresence>
          {error && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[13px] text-destructive"
            >
              {error}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* loading shimmer */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-10 flex items-center justify-center gap-2.5 text-[14px] text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" />
            composing outline + synthesizing slides with Claude…
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{deck && !loading && <DeckView key={deck.title} deck={deck} />}</AnimatePresence>
    </main>
  );
}

function Stepper({ value, setValue }: { value: number; setValue: (n: number) => void }) {
  return (
    <div className="flex h-8 items-center rounded-md border bg-background text-[13px]">
      <button
        className="px-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        onClick={() => setValue(Math.max(1, value - 1))}
        disabled={value <= 1}
      >
        −
      </button>
      <span className="w-7 text-center font-medium tabular-nums">{value}</span>
      <button
        className="px-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        onClick={() => setValue(Math.min(12, value + 1))}
        disabled={value >= 12}
      >
        +
      </button>
    </div>
  );
}

async function downloadZip(deck: Deck) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pad = (i: number) => String(i + 1).padStart(2, "0");
  deck.slides.forEach((s, i) => {
    zip.file(`${pad(i)}_${s.archetype ?? s.layoutId ?? "slide"}.svg`, s.svg);
  });
  zip.file(
    "manifest.json",
    JSON.stringify(
      { title: deck.title, theme: deck.theme, mode: deck.mode, slides: deck.slides.map((s, i) => ({ index: i + 1, archetype: s.archetype, purpose: s.purpose, gate: s.gate, overall: s.overall, novelty: s.novelty })) },
      null,
      2,
    ),
  );
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${deck.title.replace(/[^\w]+/g, "-").toLowerCase()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

function DeckView({ deck }: { deck: Deck }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="mt-14"
    >
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{deck.title}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {deck.theme} · {deck.slides.length} slides · {deck.mode ?? "layout"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => downloadZip(deck)}>
          <Download className="size-4" /> Download .zip
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        {deck.slides.map((s, i) => (
          <SlideCard key={i} slide={s} index={i} />
        ))}
      </div>
    </motion.section>
  );
}

function SlideCard({ slide, index }: { slide: Slide; index: number }) {
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(slide.svg)}`;
  const warn = (slide.warnings ?? []).filter((w) => /high|overlap|out_of|overflow/.test(w));
  const gateVariant = slide.gate === "PASS" ? "success" : slide.gate === "REVISE" ? "warning" : "destructive";
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.4), ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden rounded-2xl border bg-card"
    >
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-muted-foreground">
        <span className="tabular-nums text-[12px] text-[#9a9a9a]">{String(index + 1).padStart(2, "0")}</span>
        {slide.archetype && (
          <Badge className="uppercase tracking-wide">{slide.archetype}</Badge>
        )}
        <span className="truncate">{slide.purpose}</span>
        <div className="ml-auto flex items-center gap-2">
          {slide.gate && (
            <Badge variant={gateVariant as "success" | "warning" | "destructive"}>
              {slide.gate} · {slide.overall?.toFixed(1)} · nov {slide.novelty?.toFixed(0)}
            </Badge>
          )}
          {warn.length > 0 && !slide.gate && <Badge variant="warning">⚠ {warn.length}</Badge>}
          <a
            href={href}
            download={`${String(index + 1).padStart(2, "0")}_${slide.layoutId ?? slide.archetype ?? "slide"}.svg`}
            className={cn("rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-secondary")}
          >
            SVG
          </a>
        </div>
      </div>
      <div className="frame aspect-video w-full border-t bg-white [&_svg]:block [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: slide.svg }} />
    </motion.div>
  );
}
