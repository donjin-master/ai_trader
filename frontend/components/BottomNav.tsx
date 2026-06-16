"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart2, BookOpen, Brain, Dna, FlaskConical, Home, Bot, Settings,
  MoreHorizontal, Layers, X,
} from "lucide-react";

const primaryItems = [
  { href: "/dashboard",  label: "Dashboard", icon: Home },
  { href: "/journal",    label: "Journal",   icon: BookOpen },
  { href: "/brain",      label: "Brain",     icon: Brain },
  { href: "/autonomous", label: "Auto",      icon: Bot },
];

const moreItems = [
  { href: "/dna",         label: "DNA",         icon: Dna },
  { href: "/performance", label: "Performance", icon: BarChart2 },
  { href: "/lab",         label: "Lab",         icon: FlaskConical },
  { href: "/options",     label: "Options",     icon: Layers },
  { href: "/settings",    label: "Settings",    icon: Settings },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);

  const isActive = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  const moreActive = moreItems.some((item) => isActive(item.href));

  return (
    <>
      <nav
        style={{
          height: "var(--bottomnav-height)",
          background: "var(--bg-surface)",
          borderTop: "1px solid var(--border-subtle)",
        }}
        className="md:hidden fixed inset-x-0 bottom-0 z-30 flex items-stretch"
      >
        {primaryItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} className={`bottom-nav-item${active ? " active" : ""}`}>
              <Icon size={20} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className={`bottom-nav-item${moreActive ? " active" : ""}`}
        >
          <MoreHorizontal size={20} strokeWidth={1.8} />
          <span>More</span>
        </button>
      </nav>

      {showMore && (
        <div
          className="md:hidden fixed inset-0 z-40 flex items-end"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowMore(false); }}
        >
          <div
            className="w-full rounded-t-xl"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-default)",
              paddingBottom: "var(--bottomnav-height)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <span className="section-label">More</span>
              <button type="button" onClick={() => setShowMore(false)} style={{ color: "var(--text-secondary)" }}>
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              {moreItems.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setShowMore(false)}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-lg py-3"
                    style={{
                      background: active ? "var(--accent-primary)" : "var(--bg-elevated)",
                      color: active ? "#fff" : "var(--text-secondary)",
                    }}
                  >
                    <Icon size={20} strokeWidth={1.8} />
                    <span style={{ fontSize: "var(--text-xs)" }}>{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
