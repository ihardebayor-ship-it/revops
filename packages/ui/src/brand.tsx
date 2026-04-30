// <Brand /> — renders the product name and primary asset from
// platform_settings (with optional tenant whitelabel override). There is no
// hardcoded brand string anywhere; renaming the product is a database
// UPDATE.
import { type BrandConfig } from "@revops/config/brand";
import { cn } from "./utils";

export type BrandProps = {
  brand: BrandConfig;
  variant?: "wordmark" | "compact" | "icon";
  className?: string;
};

export function Brand({ brand, variant = "wordmark", className }: BrandProps) {
  if (variant === "icon") {
    return (
      <span
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md font-semibold",
          className,
        )}
        style={{ backgroundColor: brand.primaryColor, color: "white" }}
        aria-label={brand.name}
      >
        {brand.name.charAt(0)}
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className={cn("font-semibold tracking-tight", className)}>{brand.name}</span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Brand brand={brand} variant="icon" />
      <span className="text-lg font-semibold tracking-tight">{brand.name}</span>
    </span>
  );
}
