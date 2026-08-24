// Estilo shadcn/ui, sin @radix-ui/react-slot (no necesitamos el patrón
// `asChild` acá — todo botón de esta app es un <button> de verdad).
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:bg-accent/90",
        ghost: "text-muted hover:bg-panel2 hover:text-gray-100",
        outline: "border border-border bg-transparent hover:bg-panel2",
        destructive: "text-destructive hover:bg-destructive/10",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "h-10 w-10 shrink-0",
        "icon-sm": "h-9 w-9 shrink-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = "Button";
