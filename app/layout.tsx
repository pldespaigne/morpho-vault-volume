import type { Metadata } from "next";
import { Geist } from "next/font/google";

import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Morpho Vault Volume",
  description: "Track Morpho vault deposit and withdrawal volume",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn("font-sans antialiased", geist.variable)}>
        {children}
      </body>
    </html>
  );
}
