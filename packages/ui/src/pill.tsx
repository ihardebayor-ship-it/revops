import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./utils";

const pillVariants = cva(
  "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider",
  {
    variants: {
      variant: {
        neutral: "bg-zinc-900 text-zinc-400",
        positive: "bg-green-500/10 text-green-400",
        won: "bg-emerald-500/10 text-emerald-400",
        objection: "bg-amber-500/10 text-amber-400",
        disqualification: "bg-red-500/10 text-red-400",
        info: "bg-blue-500/10 text-blue-400",
        warning: "bg-amber-500/10 text-amber-400",
        danger: "bg-red-500/10 text-red-400",
        admin: "bg-purple-500/10 text-purple-400",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type PillProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof pillVariants>;

export function Pill({ className, variant, ...props }: PillProps) {
  return <span className={cn(pillVariants({ variant }), className)} {...props} />;
}
