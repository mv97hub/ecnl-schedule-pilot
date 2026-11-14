import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { GenderProvider } from "@/components/GenderProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECNL Schedule",
  description: "Conference schedules for ECNL teams",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <GenderProvider>{children}</GenderProvider>
      </body>
    </html>
  );
}
