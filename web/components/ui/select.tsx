// Wrapper de estilo sobre <select> nativo (mismo criterio que ui/input.tsx:
// sin @radix-ui/react-select, el control nativo alcanza y viene con
// teclado/a11y gratis). Flecha propia porque la nativa del navegador no
// respeta el tema oscuro.
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-border bg-panel pl-3 pr-8 text-sm text-gray-200",
          "focus:outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_hsl(var(--accent)/0.15)] disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  ),
);
Select.displayName = "Select";
