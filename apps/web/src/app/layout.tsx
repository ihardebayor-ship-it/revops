import type { Metadata } from "next";
import { getBrand } from "~/lib/brand";
import "@revops/ui/globals.css";

// Every route in this app is auth-gated and reads from the DB on render,
// so static prerender at build time has no benefit and triggers Next 15's
// built-in /500 fallback that imports <Html> from a chunk and crashes.
// Force-dynamic at the root opts every descendant out of static rendering.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: brand.name,
    description: brand.tagline,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
