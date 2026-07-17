export default function SetupPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-16">
      <h1 className="text-3xl font-bold">還差 Clerk 金鑰</h1>
      <p className="text-zinc-400">
        Neon 與 Vercel 已就緒。請建立 Clerk Application，把金鑰寫入{" "}
        <code className="text-emerald-400">.env.local</code> 與 Vercel
        環境變數後重新部署。
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-zinc-300">
        <li>
          開啟{" "}
          <a
            className="text-emerald-400 underline"
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
          >
            dashboard.clerk.com
          </a>{" "}
          → Create application（啟用 Google + Discord）
        </li>
        <li>
          複製 <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> 與{" "}
          <code>CLERK_SECRET_KEY</code>
        </li>
        <li>
          本機貼到 <code>.env.local</code>；線上用{" "}
          <code>npx vercel env add …</code>
        </li>
        <li>
          把 <code>https://ua-platform-ivory.vercel.app</code> 加到 Clerk
          Allowed origins / Redirect URLs
        </li>
        <li>
          建議再設定 Metered TURN（見 <code>SETUP.md</code>）
        </li>
        <li>
          執行 <code>npx vercel deploy --prod</code>
        </li>
      </ol>
      <p className="text-sm text-zinc-500">完整步驟見專案根目錄 SETUP.md</p>
    </div>
  );
}
