import { LobbyActions } from "@/components/lobby-actions";
import { HomeAuth } from "@/components/home-auth";

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16">
      <div className="space-y-3 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-emerald-500">
          Phase 0 Prototype
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Union Arena 遠端對戰
        </h1>
        <p className="text-zinc-400">
          登入 → 建房 → 掃 QR 開手機攝影機 → 計分同步。快速驗證核心流程。
        </p>
      </div>

      <HomeAuth lobby={<LobbyActions />} />
    </div>
  );
}
