import type { Metadata } from "next";
import { Pixelify_Sans, VT323, Nunito } from "next/font/google";
import "./globals.css";

const display = Pixelify_Sans({ variable: "--font-display-face", subsets: ["latin"] });
const body = Nunito({ variable: "--font-body", subsets: ["latin"] });
const data = VT323({ variable: "--font-data", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "Roster", template: "%s · Roster" },
  description: "Find, pay and measure UGC creators.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${data.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
