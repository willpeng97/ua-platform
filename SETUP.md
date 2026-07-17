# Phase 0 啟動設定

## 已完成

- Neon 專案 `ua-platform`（`sparkling-dust-35759460`）已建立，schema 已 migrate
- Vercel：https://ua-platform-ivory.vercel.app
- Clerk app `ua-platform` 已用 CLI 連結，金鑰在本機與 Vercel
- Metered TURN 已寫入本機（`UA_ICE_*`）與 Vercel（`METERED_*` / `UA_ICE_*`）

## 建議再確認

1. Clerk Dashboard → 啟用 **Google** / **Discord**（若尚未開）
2. 把 `https://ua-platform-ivory.vercel.app` 加到 Clerk **Allowed origins / Redirect URLs**
3. （可選）在 Clerk 建立 production instance，正式環境改用 prod keys

## 本機執行

```bash
npm install
npm run dev
```

開啟 http://localhost:3000

## 驗證流程

1. 兩個帳號分別登入
2. A 建房，B 輸入房間碼加入
3. 雙方用手機掃自己的 QR，允許相機
4. 對手桌機應看到對方手機畫面
5. 按 +1 確認比分同步
6. 選 Winner 結束
