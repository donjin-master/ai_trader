"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  Brain,
  Dna,
  FlaskConical,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Live", icon: Zap },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/brain", label: "Brain", icon: Brain },
  { href: "/performance", label: "Perf", icon: BarChart2 },
  { href: "/dna", label: "DNA", icon: Dna },
  { href: "/lab", label: "Lab", icon: FlaskConical },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function SideNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop icon rail */}
      <nav className="fixed bottom-0 left-0 top-12 z-30 hidden w-14 flex-col items-center gap-2 border-r border-[var(--glass-border)] bg-[var(--glass-bg)] pt-3 backdrop-blur-xl md:flex">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl transition-all",
                active
                  ? "bg-blue-600/90 text-white shadow-[var(--glow-accent)]"
                  : "text-slate-500 hover:bg-white/5 hover:text-slate-200"
              )}
            >
              <Icon size={17} />
            </Link>
          );
        })}
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl md:hidden">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 text-[9px] font-semibold",
                active ? "text-blue-400" : "text-slate-500"
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
