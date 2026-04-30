import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-blue-500 text-white hover:bg-blue-600 focus-visible:ring-blue-500",
        secondary: "bg-zinc-800 text-zinc-50 hover:bg-zinc-700 focus-visible:ring-zinc-700",
        ghost: "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50",
        destructive: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-6",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
