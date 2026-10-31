import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent text-sm font-semibold whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:saturate-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary-action text-primary-action-foreground shadow-xs hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline:
          "border-border-strong bg-card text-foreground shadow-xs hover:border-brand hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        ghost: "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        link: "h-auto rounded-md px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-8 rounded-sm px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 rounded-sm px-3 text-sm",
        default: "h-11 px-4 text-base",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
        "icon-sm": "size-9 rounded-sm",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
