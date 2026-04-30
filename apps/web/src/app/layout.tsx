import type { Metadata } from "next";
import { getBrand } from "~/lib/brand";
import "@revops/ui/globals.css";

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
