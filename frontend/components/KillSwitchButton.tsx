"use client";

import { useState } from "react";
import { Skull } from "lucide-react";
import { api } from "@/lib/api";

export default function KillSwitchButton({ onKilled }: { onKilled?: () => void }) {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    setLoading(true);
    await api.kill();
    setLoading(false);
    setShowModal(false);
    onKilled?.();
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="kill-glow flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 font-mono text-xs font-bold text-white hover:bg-red-500"
      >
        <Skull size={16} />
        <span className="hidden sm:inline">KILL</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-sm w-full">
            <h3 className="text-lg font-bold text-red-500">Stop all trading?</h3>
            <p className="mt-2 text-sm text-zinc-400">
              This will cancel all open orders.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={confirm}
                disabled={loading}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {loading ? "Stopping..." : "Confirm"}
              </button>
              <button
                onClick={() => setShowModal(false)}
                disabled={loading}
                className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
