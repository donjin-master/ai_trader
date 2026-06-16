import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import QueryProvider from "@/components/QueryProvider";
import SideNav from "@/components/SideNav";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import { Providers } from "./providers";
import { InstrumentProvider } from "@/lib/instrument";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AI Trader",
  description: "Autonomous AI trading terminal — Delta Exchange India",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <Providers>
          <QueryProvider>
            <InstrumentProvider>
              <TopBar />
              <SideNav />
              <main
                className="ml-0 md:ml-[var(--sidebar-width)] mt-[var(--topbar-height)] p-[var(--space-6)] pb-[calc(var(--bottomnav-height)+var(--space-6))] md:pb-[var(--space-6)]"
                style={{
                  minHeight: "calc(100vh - var(--topbar-height))",
                  background: "var(--bg-base)",
                }}
              >
                {children}
              </main>
              <BottomNav />
            </InstrumentProvider>
          </QueryProvider>
        </Providers>
      </body>
    </html>
  );
}
