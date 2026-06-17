"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Folder, FolderOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";

const THEMES = ["colorful", "black", "green"] as const;
type Theme = (typeof THEMES)[number];
interface SlideRef { id: string }

export function TemplateManager({ theme }: { theme: Theme }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<Theme | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Prefetch folder counts when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all(
      THEMES.map((t) => fetch(`/api/templates?theme=${t}`).then((r) => r.json()).then((d) => [t, d.slides?.length ?? 0] as const).catch(() => [t, 0] as const)),
    ).then((pairs) => alive && setCounts(Object.fromEntries(pairs)));
    return () => { alive = false; };
  }, [open]);

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
                <button onClick={() => setFolder(null)} className="rounded-md p-1 -ml-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <ChevronLeft className="size-4" />
                </button>
                <Folder className="size-4" /> {folder}
              </>
            ) : (
              "Templates"
            )}
          </DialogTitle>
          <DialogDescription>
            {folder ? "Add or remove example slides. These are design data, not fill-in forms." : "Each theme is a folder of example slides the grammar is mined from."}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait" initial={false}>
          {!folder ? (
            <motion.div
              key="folders"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="grid grid-cols-3 gap-3"
            >
              {THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setFolder(t)}
                  className="group flex flex-col items-center gap-2 rounded-xl border bg-card p-5 transition-all hover:border-foreground/20 hover:bg-secondary/50"
                >
                  <Folder className="size-9 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.4} />
                  <span className="text-sm font-medium capitalize">{t}</span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">{counts[t] ?? "…"} slides</span>
                </button>
              ))}
            </motion.div>
          ) : (
            <FolderView key={folder} theme={folder} onCount={(n) => setCounts((c) => ({ ...c, [folder]: n }))} />
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function FolderView({ theme, onCount }: { theme: Theme; onCount: (n: number) => void }) {
  const [slides, setSlides] = useState<SlideRef[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await fetch(`/api/templates?theme=${theme}`).then((r) => r.json());
    const list: SlideRef[] = d.slides ?? [];
    setSlides(list);
    onCount(list.length);
  }, [theme, onCount]);

  useEffect(() => { void load(); }, [load]);

  async function add(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith(".svg")) continue;
      const svg = await f.text();
      await fetch(`/api/templates?theme=${theme}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.name, svg }),
      });
    }
    await load();
  }

  async function remove(id: string) {
    if (!confirm(`Delete ${id}.svg from ${theme}?`)) return;
    setBusy(id);
    await fetch(`/api/templates?theme=${theme}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(null);
    await load();
  }

  return (
    <motion.div key="grid" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.18 }}>
      <ScrollArea className="h-[52vh] -mr-3 pr-3">
        {slides === null ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 pb-1">
            <input ref={fileRef} type="file" accept=".svg" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-secondary/50 hover:text-foreground"
            >
              <Plus className="size-5" />
              <span className="text-[12px] font-medium">Add slide</span>
            </button>
            {slides.map((s) => (
              <motion.div key={s.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="group relative overflow-hidden rounded-lg border bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/templates/file?theme=${theme}&id=${encodeURIComponent(s.id)}`} alt={s.id} className="aspect-video w-full object-contain" loading="lazy" />
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
