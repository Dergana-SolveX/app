import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@solvex-dergana/ui/lib/utils";
import * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground transition-colors outline-none shadow-xs placeholder:text-subtle-foreground hover:border-brand/60 focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
