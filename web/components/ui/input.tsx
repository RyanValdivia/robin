import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-lg border border-border bg-panel px-3 text-sm text-gray-200 placeholder:text-muted",
        "focus:outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_hsl(var(--accent)/0.15)] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
