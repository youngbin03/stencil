import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/15 focus-visible:border-ring/40 disabled:opacity-50 resize-none transition-[box-shadow,border-color]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
