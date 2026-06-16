import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Stencil — AI deck generation",
  description: "Generate on-brand slide decks from a baked design system.",
};

// The rendered slide SVGs reference the themes' font families by name; load them
// as web fonts so the browser renders text with the same metrics the solver
// measured (opentype on the identical fonts).
const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bricolage+Grotesque:wght@400;600;700;800&family=Open+Sans:wght@400;600;700&family=Neuton:wght@400;700&display=swap";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
