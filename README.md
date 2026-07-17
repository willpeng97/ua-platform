# UA Platform — Phase 0 Prototype

Union Arena 遠端對戰原型：登入、建房、QR 手機攝影機、比分同步。

## Quick start

詳見 [SETUP.md](./SETUP.md)。

```bash
npm install
# 填好 .env.local（Clerk 必填；Metered 建議）
npm run dev
```

## Stack

- Next.js 16 + Clerk + Neon (Drizzle) + Vercel WebSocket
- WebRTC + Metered TURN（可選，未設則僅 STUN）

## Scripts

- `npm run dev` — 本機開發
- `npm run build` — 正式建置
- `npm run db:push` — 推送 Drizzle schema 到 Neon
