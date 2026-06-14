"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Unlock, Trash2, Palette, Sliders } from "lucide-react";
import { cn } from "@/lib/utils";

interface DrawingContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  drawing: {
    id: string;
    type: string;
    style: {
      lineColor: string;
      lineWidth: number;
      lineDash?: number[];
    };
    options: {
      locked?: boolean;
    };
  };
  onUpdate: (
    drawingId: string,
    updates: {
      style?: { lineColor?: string; lineWidth?: number; lineDash?: number[] };
      options?: { locked?: boolean };
    }
  ) => void;
  onDelete: (drawingId: string) => void;
}

const COLORS = [
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#22c55e", // Green
  "#f59e0b", // Amber
  "#a855f7", // Purple
  "#06b6d4", // Cyan
  "#e2e8f0", // White/Slate
  "#eab308", // Yellow
];

export default function DrawingContextMenu({
  x,
  y,
  onClose,
  drawing,
  onUpdate,
  onDelete,
}: DrawingContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Close menu when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  const currentColor = drawing.style?.lineColor || "#3b82f6";
  const currentWidth = drawing.style?.lineWidth || 1;
  const currentDash = drawing.style?.lineDash;
  const isLocked = drawing.options?.locked || false;

  const getStyleType = () => {
    if (!currentDash || currentDash.length === 0) return "solid";
    if (currentDash[0] === 5) return "dashed";
    if (currentDash[0] === 2) return "dotted";
    return "solid";
  };

  const handleColorSelect = (color: string) => {
    onUpdate(drawing.id, { style: { lineColor: color } });
    setShowColorPicker(false);
  };

  const handleWidthSelect = (width: number) => {
    onUpdate(drawing.id, { style: { lineWidth: width } });
  };

  const handleStyleSelect = (type: "solid" | "dashed" | "dotted") => {
    let lineDash: number[] = [];
    if (type === "dashed") lineDash = [5, 5];
    if (type === "dotted") lineDash = [2, 2];
    onUpdate(drawing.id, { style: { lineDash } });
  };

  const handleToggleLock = () => {
    onUpdate(drawing.id, { options: { locked: !isLocked } });
    onClose();
  };

  const handleDelete = () => {
    onDelete(drawing.id);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ top: y, left: x }}
      className="fixed z-50 min-w-44 rounded-lg border border-zinc-800 bg-zinc-950/95 p-1.5 font-mono text-xs text-zinc-300 shadow-2xl backdrop-blur-md"
    >
      <div className="flex flex-col gap-0.5">
        {/* Color Picker Toggle */}
        <div className="relative">
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="flex w-full items-center justify-between rounded px-2.5 py-1.5 hover:bg-zinc-800 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Palette className="h-3.5 w-3.5" /> Color
            </span>
            <span
              className="h-3.5 w-3.5 rounded border border-zinc-700"
              style={{ backgroundColor: currentColor }}
            />
          </button>

          {showColorPicker && (
            <div className="absolute left-full top-0 ml-1 grid grid-cols-4 gap-1 rounded border border-zinc-800 bg-zinc-950 p-2 shadow-xl">
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => handleColorSelect(color)}
                  className="h-5 w-5 rounded border border-zinc-800 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Line Style Selector */}
        <div className="flex items-center justify-between border-t border-zinc-900 px-2.5 py-1.5">
          <span className="text-zinc-500">Style</span>
          <div className="flex gap-1">
            {(["solid", "dashed", "dotted"] as const).map((styleType) => {
              const active = getStyleType() === styleType;
              return (
                <button
                  key={styleType}
                  onClick={() => handleStyleSelect(styleType)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] border border-zinc-800 transition-colors",
                    active
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                  )}
                >
                  {styleType === "solid" ? "──" : styleType === "dashed" ? "- -" : "···"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Line Width Selector */}
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-zinc-500">Width</span>
          <div className="flex gap-1">
            {[1, 2, 3].map((w) => {
              const active = currentWidth === w;
              return (
                <button
                  key={w}
                  onClick={() => handleWidthSelect(w)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] border border-zinc-800 transition-colors",
                    active
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                  )}
                >
                  {w}px
                </button>
              );
            })}
          </div>
        </div>

        {/* Lock / Unlock */}
        <button
          onClick={handleToggleLock}
          className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 border-t border-zinc-900 text-left hover:bg-zinc-800 transition-colors"
        >
          {isLocked ? (
            <>
              <Unlock className="h-3.5 w-3.5 text-blue-400" /> Unlock
            </>
          ) : (
            <>
              <Lock className="h-3.5 w-3.5" /> Lock
            </>
          )}
        </button>

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
}
