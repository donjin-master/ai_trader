import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Inter, JetBrains_Mono } from "next/font/google";
import PageTransition from "@/components/PageTransition";
import SideNav from "@/components/SideNav";
import TopBar from "@/components/TopBar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const AmbientBackground = dynamic(() => import("@/components/3d/AmbientBackground"), {
  ssr: false,
});

export const metadata: Metadata = {
  title: "AI Trader",
  description: "Autonomous AI trading terminal — Delta Exchange India",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans`}>
        <AmbientBackground />
        <TopBar />
        <SideNav />
        <main className="pt-12 pb-16 md:ml-14 md:pb-4">
          <div className="p-3 md:p-4">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </body>
    </html>
  );
}
