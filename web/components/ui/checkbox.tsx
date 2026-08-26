// Checkbox propio (sin @radix-ui/react-checkbox) — el input nativo queda
// visualmente oculto pero sigue siendo el elemento real (foco/teclado/a11y
// gratis), la cajita de al lado solo pinta su estado. Mismo patrón simple
// que el resto de ui/ (button, input): sin dependencia nueva.
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: React.ReactNode;
  hint?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, hint, disabled, ...props }, ref) => (
    <label
      className={cn(
        "inline-flex items-center gap-2 text-sm text-gray-300 select-none",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        className,
      )}
      title={typeof hint === "string" ? hint : undefined}
    >
      <input ref={ref} type="checkbox" disabled={disabled} className="peer sr-only" {...props} />
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-panel transition-colors",
          "peer-checked:bg-accent peer-checked:border-accent peer-checked:[&>svg]:opacity-100",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50",
        )}
      >
        <Check size={11} className="text-accent-foreground opacity-0" strokeWidth={3} />
      </span>
      {label}
    </label>
  ),
);
Checkbox.displayName = "Checkbox";
