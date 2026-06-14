export function formatCurrency(value: number | null | undefined, currency = "₹"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${currency}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}

export function formatPct(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatDuration(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return "—";
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

export function pnlColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-zinc-400";
  return value >= 0 ? "text-green-500" : "text-red-500";
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
