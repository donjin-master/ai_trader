import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import QueryProvider from "@/components/QueryProvider";
import SideNav from "@/components/SideNav";
import TopBar from "@/components/TopBar";
import { Providers } from "./providers";
import { InstrumentProvider } from "@/lib/instrument";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AI Trader",
  description: "Autonomous AI trading terminal — Delta Exchange India",
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
                style={{
                  marginLeft: "var(--sidebar-width)",
                  marginTop: "var(--topbar-height)",
                  padding: "var(--space-6)",
                  minHeight: "calc(100vh - var(--topbar-height))",
                  background: "var(--bg-base)",
                }}
              >
                {children}
              </main>
            </InstrumentProvider>
          </QueryProvider>
        </Providers>
      </body>
    </html>
  );
}
