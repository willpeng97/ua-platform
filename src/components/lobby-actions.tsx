"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LobbyActions() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createMatch() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/matches", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      router.push(`/match/${data.match.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function joinMatch() {
    if (!joinCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/matches/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Join failed");
      router.push(`/match/${data.match.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Join failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <button
        type="button"
        disabled={busy}
        onClick={() => void createMatch()}
        className="rounded-xl bg-emerald-600 px-4 py-3 text-lg font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        建立比賽房間
      </button>

      <div className="flex flex-col gap-2">
        <label className="text-sm text-zinc-400">或輸入房間碼加入</label>
        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 tracking-widest uppercase outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            disabled={busy || joinCode.length < 4}
            onClick={() => void joinMatch()}
            className="rounded-xl bg-zinc-100 px-4 py-2 font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            加入
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
