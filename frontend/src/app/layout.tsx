import type { Metadata } from "next";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pan-Genome · Tube Map Explorer",
  description: "A coordinate-driven workspace for exploring pangenome paths and structural variation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
