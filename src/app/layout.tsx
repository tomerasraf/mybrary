import type { Metadata, Viewport } from "next";
import { Courier_Prime, Nunito, Patrick_Hand } from "next/font/google";
import "./globals.css";

const ui = Nunito({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const paper = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-paper", display: "swap" });
const hand = Patrick_Hand({ subsets: ["latin"], weight: "400", variable: "--font-hand", display: "swap" });

export const metadata: Metadata = {
  title: "TimeFlow",
  description: "A quiet white place where your thoughts become bubbles, and a little bird helps you untangle them.",
  appleWebApp: { capable: true, title: "TimeFlow", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f7f9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${paper.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
