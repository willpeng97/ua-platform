"use client";

import { SignInButton, SignUpButton, useAuth } from "@clerk/nextjs";
import type { ReactNode } from "react";

export function HomeAuth({ lobby }: { lobby: ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) {
    return (
      <p className="text-center text-sm text-zinc-500">載入登入狀態…</p>
    );
  }
  if (isSignedIn) return <>{lobby}</>;
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <SignInButton mode="modal">
        <button
          type="button"
          className="rounded-xl bg-emerald-600 px-6 py-3 text-lg font-semibold text-white hover:bg-emerald-500"
        >
          登入
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button
          type="button"
          className="rounded-xl border border-zinc-600 px-6 py-3 text-lg font-semibold hover:bg-zinc-900"
        >
          註冊
        </button>
      </SignUpButton>
    </div>
  );
}
