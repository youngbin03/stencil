"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Folder, FolderOpen, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";

export interface ThemeInfo {
  slug: string;
  name: string;
  builtin: boolean;
  slides: number;
  baked: boolean;
}
interface SlideRef { id: string }

export function TemplateManager({ themes, onChanged }: { themes: ThemeInfo[]; onChanged: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function newTheme() {
    const name = window.prompt("New theme name (e.g. “Aurora”)");
    if (!name?.trim()) return;
    setCreating(true);
    const res = await fetch("/api/themes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) { alert(data.error ?? "create failed"); return; }
    await onChanged();
    setFolder(data.slug);
  }

  const active = themes.find((t) => t.slug === folder);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setFolder(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <FolderOpen className="size-4" /> Templates
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {folder ? (
              <>
                <button onClick={() => setFolder(null)} className="-ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <ChevronLeft className="size-4" />
                </button>
                <Folder className="size-4" /> {active?.name ?? folder}
                {active && !active.baked && <Badge variant="warning">not baked</Badge>}
              </>
            ) : (
              "Templates"
            )}
          </DialogTitle>
          <DialogDescription>
            {folder
              ? "Add or remove example slides, then Rebake to generate from this template."
              : "Each theme is a folder of example slides the grammar is mined from. Import your own to generate from it."}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait" initial={false}>
          {!folder ? (
            <motion.div key="folders" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }} className="grid grid-cols-3 gap-3">
              {themes.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => setFolder(t.slug)}
                  className="group relative flex flex-col items-center gap-2 rounded-xl border bg-card p-5 transition-all hover:border-foreground/20 hover:bg-secondary/50"
                >
                  {t.baked && <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-[#0a7d33]" title="baked" />}
                  <Folder className="size-9 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.4} />
                  <span className="text-sm font-medium capitalize">{t.name}</span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">{t.slides} slides</span>
                </button>
              ))}
              <button
                onClick={newTheme}
                disabled={creating}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-muted-foreground transition-all hover:border-foreground/30 hover:bg-secondary/50 hover:text-foreground"
              >
                {creating ? <Loader2 className="size-7 animate-spin" /> : <Plus className="size-7" strokeWidth={1.4} />}
                <span className="text-sm font-medium">New theme</span>
                <span className="text-[12px]">import your own</span>
              </button>
            </motion.div>
          ) : (
            <FolderView key={folder} slug={folder} baked={active?.baked ?? false} onChanged={onChanged} />
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function FolderView({ slug, baked, onChanged }: { slug: string; baked: boolean; onChanged: () => void | Promise<void> }) {
  const [slides, setSlides] = useState<SlideRef[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [baking, setBaking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/templates?theme=${slug}`).then((r) => r.json());
    setSlides(d.slides ?? []);
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  async function add(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith(".svg")) continue;
      const svg = await f.text();
      await fetch(`/api/templates?theme=${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, svg }) });
    }
    await load();
    await onChanged();
  }

  async function remove(id: string) {
    if (!confirm(`Delete ${id}.svg from ${slug}?`)) return;
    setBusy(id);
    await fetch(`/api/templates?theme=${slug}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(null);
    await load();
    await onChanged();
  }

  async function rebake() {
    setBaking(true);
    const res = await fetch(`/api/themes/rebake?slug=${slug}`, { method: "POST" });
    const data = await res.json();
    setBaking(false);
    if (!res.ok) { alert(data.error ?? "rebake failed"); return; }
    await onChanged();
  }

  const count = slides?.length ?? 0;

  return (
    <motion.div key="grid" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.18 }} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground tabular-nums">{count} slides{baked ? " · baked" : ""}</span>
        <Button size="sm" onClick={rebake} disabled={baking || count === 0}>
          {baking ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {baked ? "Rebake" : "Bake to generate"}
        </Button>
      </div>
      <ScrollArea className="-mr-3 h-[48vh] pr-3">
        {slides === null ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-3 pb-1">
            <input ref={fileRef} type="file" accept=".svg" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-secondary/50 hover:text-foreground">
              <Plus className="size-5" />
              <span className="text-[12px] font-medium">Add slide</span>
            </button>
            {slides.map((s) => (
              <motion.div key={s.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="group relative overflow-hidden rounded-lg border bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/templates/file?theme=${slug}&id=${encodeURIComponent(s.id)}`} alt={s.id} className="aspect-video w-full object-contain" loading="lazy" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-5 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="text-[11px] font-medium text-white tabular-nums">{s.id}</span>
                  <button onClick={() => remove(s.id)} className="pointer-events-auto rounded-md bg-white/15 p-1 text-white backdrop-blur-sm transition-colors hover:bg-destructive">
                    {busy === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </ScrollArea>
    </motion.div>
  );
}
