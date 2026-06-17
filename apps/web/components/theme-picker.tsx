"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, FolderPlus, Search, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ThemeInfo } from "@/components/template-manager";

function Swatches({ colors, className }: { colors: string[]; className?: string }) {
  const cs = colors.length ? colors.slice(0, 4) : ["#e5e5e5"];
  return (
    <span className={cn("flex overflow-hidden rounded-[5px] border", className)}>
      {cs.map((c, i) => (
        <span key={i} style={{ background: c }} className="block h-full w-2" />
      ))}
    </span>
  );
}

/**
 * Scalable theme selector. A compact trigger (swatch + name) opens a searchable
 * popover list — stays clean whether there are 3 themes or 30. Unbaked themes are
 * shown but route to the template manager to bake first.
 */
export function ThemePicker({
  themes,
  value,
  onChange,
  onManage,
}: {
  themes: ThemeInfo[];
  value: string;
  onChange: (slug: string) => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = themes.find((t) => t.slug === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? themes.filter((t) => t.name.toLowerCase().includes(s) || t.slug.includes(s)) : themes;
    return [...list].sort((a, b) => Number(b.baked) - Number(a.baked) || a.name.localeCompare(b.name));
  }, [themes, q]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-[13px] font-medium transition-colors hover:bg-secondary/60"
          title="Choose theme"
        >
          <Swatches colors={current?.swatches ?? []} className="h-3.5" />
          <span className="max-w-28 truncate capitalize">{current?.name ?? "Theme"}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search themes…"
            className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-2 py-6 text-center text-[13px] text-muted-foreground">No themes match.</div>
          )}
          {filtered.map((t) => {
            const selected = t.slug === value;
            return (
              <button
                key={t.slug}
                onClick={() => {
                  if (!t.baked) { setOpen(false); onManage(); return; }
                  onChange(t.slug);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors hover:bg-secondary/70",
                  selected && "bg-secondary/50",
                )}
              >
                <Swatches colors={t.swatches} className="h-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium capitalize">{t.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                    {t.slides} slides{t.builtin ? " · built-in" : ""}
                  </span>
                </span>
                {t.baked ? (
                  selected && <Check className="size-4 shrink-0" />
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    <Sparkles className="size-3" /> bake
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="border-t p-1">
          <button
            onClick={() => { setOpen(false); onManage(); }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <FolderPlus className="size-4" /> Import / manage templates
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
