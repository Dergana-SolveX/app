import { cn } from "@solvex-dergana/ui/lib/utils";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full resize-none rounded-md border border-input bg-card px-3 py-2.5 text-base text-foreground transition-colors outline-none shadow-xs placeholder:text-subtle-foreground hover:border-brand/60 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
