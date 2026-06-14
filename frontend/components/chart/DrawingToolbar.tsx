"use client";

import React from "react";
import {
  MousePointer2,
  TrendingUp,
  Minus,
  GripVertical,
  ArrowRight,
  ArrowLeftRight,
  MoveRight,
  Split,
  Square,
  Circle,
  Triangle,
  Type,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type DrawingToolType =
  | "cursor"
  | "trendline"
  | "horizontal"
  | "vertical"
  | "ray"
  | "extended"
  | "arrow"
  | "channel"
  | "fibonacci"
  | "rectangle"
  | "circle"
  | "triangle"
  | "text";

interface DrawingToolbarProps {
  activeTool: DrawingToolType;
  onToolSelect: (tool: DrawingToolType) => void;
  onClearAll: () => void;
}

export default function DrawingToolbar({
  activeTool,
  onToolSelect,
  onClearAll,
}: DrawingToolbarProps) {
  const groups: {
    name: string;
    items: {
      id: DrawingToolType;
      label: string;
      shortcut?: string;
      icon?: React.ComponentType<any>;
      text?: string;
    }[];
  }[] = [
    {
      name: "Selection",
      items: [
        { id: "cursor" as const, label: "Cursor", shortcut: "Esc", icon: MousePointer2 },
      ],
    },
    {
      name: "Lines",
      items: [
        { id: "trendline" as const, label: "Trendline", shortcut: "T", icon: TrendingUp },
        { id: "horizontal" as const, label: "Horizontal Line", shortcut: "H", icon: Minus },
        { id: "vertical" as const, label: "Vertical Line", shortcut: "V", icon: GripVertical },
        { id: "ray" as const, label: "Ray", shortcut: "R", icon: ArrowRight },
        { id: "extended" as const, label: "Extended Line", shortcut: "E", icon: ArrowLeftRight },
        { id: "arrow" as const, label: "Arrow", shortcut: "A", icon: MoveRight },
      ],
    },
    {
      name: "Channels",
      items: [
        { id: "channel" as const, label: "Parallel Channel", shortcut: "P", icon: Split },
      ],
    },
    {
      name: "Fibonacci",
      items: [
        { id: "fibonacci" as const, label: "Fib Retracement", shortcut: "F", text: "Fib" },
      ],
    },
    {
      name: "Shapes",
      items: [
        { id: "rectangle" as const, label: "Rectangle", shortcut: "B", icon: Square },
        { id: "circle" as const, label: "Circle", icon: Circle },
        { id: "triangle" as const, label: "Triangle", icon: Triangle },
        { id: "text" as const, label: "Text", icon: Type },
      ],
    },
  ];

  return (
    <div className="absolute bottom-0 left-0 top-0 z-20 flex w-10 flex-col border-r border-zinc-800 bg-[rgba(15,17,28,0.9)] backdrop-blur-md">
      <div className="flex flex-1 flex-col items-center py-2 overflow-y-auto scrollbar-none">
        {groups.map((group, groupIdx) => (
          <React.Fragment key={group.name}>
            {groupIdx > 0 && <div className="my-1.5 h-[1px] w-6 bg-zinc-800" />}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isActive = activeTool === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => onToolSelect(item.id)}
                    className={cn(
                      "group relative flex h-8 w-8 items-center justify-center rounded transition-all duration-150 hover:bg-zinc-800",
                      isActive
                        ? "bg-blue-600/20 text-blue-400 border-r-2 border-blue-400"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                    title={item.label}
                  >
                    {Icon ? (
                      <Icon className="h-4 w-4" />
                    ) : (
                      <span className="text-[10px] font-bold tracking-tight">
                        {item.text}
                      </span>
                    )}

                    {/* Tooltip with shortcut hint */}
                    <span className="pointer-events-none absolute left-12 z-35 m-2 min-w-max origin-left scale-0 rounded bg-zinc-950 px-2 py-1 text-[10px] text-zinc-100 shadow-xl transition-all duration-100 group-hover:scale-100 flex items-center gap-1.5">
                      {item.label}
                      {item.shortcut && (
                        <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-400 font-mono">{item.shortcut}</kbd>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </div>

      <div className="border-t border-zinc-800 py-2 flex flex-col items-center gap-1">
        <button
          onClick={onClearAll}
          className="group relative flex h-8 w-8 items-center justify-center text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors duration-150 rounded"
          title="Clear All Drawings"
        >
          <Trash2 className="h-4 w-4" />
          <span className="pointer-events-none absolute left-12 z-35 m-2 min-w-max origin-left scale-0 rounded bg-zinc-950 px-2 py-1 text-[10px] text-zinc-100 shadow-xl transition-all duration-100 group-hover:scale-100 flex items-center gap-1.5">
            Clear All
          </span>
        </button>
        <div className="text-[8px] text-zinc-700 text-center leading-tight px-0.5 font-mono">
          Del<br/>sel
        </div>
      </div>
    </div>
  );
}
