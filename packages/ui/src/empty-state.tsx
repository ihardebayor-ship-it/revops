import { type ReactNode } from "react";
import { cn } from "./utils";

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-12 text-center",
        className,
      )}
    >
      <p className="text-sm text-zinc-300">{title}</p>
      {description && <p className="text-xs text-zinc-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
