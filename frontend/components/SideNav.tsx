"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { BarChart2, BookOpen, Brain, Dna, FlaskConical, Home, Bot, Settings } from "lucide-react";
import { api, type AccountSummary } from "@/lib/api";

const POLL = { refreshInterval: 30_000 };

const items = [
  { href: "/dashboard",   label: "Dashboard",   icon: Home },
  { href: "/journal",     label: "Journal",     icon: BookOpen },
  { href: "/brain",       label: "AI Brain",    icon: Brain },
  { href: "/dna",         label: "DNA",         icon: Dna },
  { href: "/performance", label: "Performance", icon: BarChart2 },
  { href: "/lab",         label: "Lab",         icon: FlaskConical },
  { href: "/autonomous",  label: "Autonomous",  icon: Bot },
  { href: "/settings",    label: "Settings",    icon: Settings },
];

function Sparkline({ positive = true }: { positive?: boolean }) {
  const pts = positive
    ? [2, 8, 5, 10, 7, 14, 11, 18, 15, 20]
    : [20, 14, 17, 10, 13, 8, 11, 5, 8, 3];
  const w = 80, h = 32;
  const max = Math.max(...pts), min = Math.min(...pts);
  const xStep = w / (pts.length - 1);
  const scaleY = (v: number) => h - ((v - min) / (max - min)) * (h - 4) - 2;
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${i * xStep},${scaleY(v)}`).join(" ");
  const color = positive ? "#26d07c" : "#ff4d6a";
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${(pts.length - 1) * xStep},${h} L0,${h} Z`} fill="url(#sg)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function SideNav() {
  const pathname = usePathname();
  const { data: acct } = useSWR<AccountSummary | null>("account-summary", () => api.accountSummary(), POLL);

  // Total balance in INR across all assets
  const totalInr = acct?.raw?.reduce((sum, a) => sum + parseFloat(a.balance_inr || "0"), 0) ?? 0;
  const displayBalance = totalInr > 0 ? totalInr : acct?.available_balance ?? 0;
  const balanceStr = totalInr > 0
    ? `₹${totalInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
    : acct ? `$${acct.available_balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "₹—";

  const positive = true; // could derive from daily pnl

  return (
    <nav
      style={{
        width: "var(--sidebar-width)",
        top: "var(--topbar-height)",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border-subtle)",
      }}
      className="hidden md:flex fixed bottom-0 left-0 z-30 flex-col overflow-y-auto"
    >
      <div className="flex flex-col gap-1 px-2 pt-3 flex-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={`nav-item${active ? " active" : ""}`}>
              <Icon size={20} strokeWidth={1.8} />
              <span style={{ fontSize: "var(--text-xs)" }}>{label}</span>
            </Link>
          );
        })}
      </div>

      {/* Account balance */}
      <div className="mx-2 mb-2 rounded-lg p-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}>
        <div className="section-label mb-2">Account Bal</div>
        <div className="font-mono font-bold" style={{ fontSize: "var(--text-xl)", color: "var(--text-primary)" }}>
          {balanceStr}
        </div>
        <div className="font-semibold mt-0.5" style={{ fontSize: "var(--text-sm)", color: positive ? "var(--color-bull)" : "var(--color-bear)" }}>
          Testnet
        </div>
        <div className="mt-1">
          <Sparkline positive={positive} />
        </div>
      </div>

      {/* User */}
      <div className="mx-2 mb-3 flex items-center gap-2 rounded-lg p-2" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-card)" }}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold text-white"
          style={{ background: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>
          A
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>Apoorv</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Pro Plan</div>
        </div>
      </div>
    </nav>
  );
}
