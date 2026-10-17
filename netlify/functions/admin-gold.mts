import { getStore } from "@netlify/blobs";
import saveBackup from "../../shared/save-backup.cjs";
import adminGold from "../../shared/admin-gold.cjs";

// 管理者發送金幣
//   POST /api/admin/gold  標頭:x-admin-secret: <ADMIN_SECRET>
//     內容:{ "x":3, "y":0, "amount":50, "reason":"活動獎勵" }   ← 用城池座標指定玩家
//          { "nick":"玩家甲", ... }                            ← 用暱稱(只找得到排行榜前 200 名)
//          { "uid":"帳號ID", ... }
//   存檔備份(每個存檔留約 10 分鐘前的一份):
//     { "t":"baklist", "uid":"帳號ID" }                              ← 列出各座城的備份時間
//     { "t":"bakrestore", "uid":"帳號ID", "city":"c_xxx" }           ← 試算;加上 "confirm":true 才會還原(city 不填=主城)
//   GET  /api/admin/gold  → 最近的發送紀錄
// 密碼放在 Netlify 的環境變數 ADMIN_SECRET,不要寫進程式碼。
export default async (req: Request) => {
  let body: any = null;
  if (req.method === "POST") {
    const text = await req.text();
    if (text.length > 4000) return Response.json({ ok: false, msg: "too large" }, { status: 413 });
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ ok: false, msg: "bad json" }, { status: 400 });
    }
  }
  const r = await adminGold.handle({
    method: req.method,
    secret: req.headers.get("x-admin-secret"),
    expected: (globalThis as any).Netlify?.env?.get("ADMIN_SECRET") ?? process.env.ADMIN_SECRET,
    body,
    saves: saveBackup.withBackup(getStore({ name: "saves", consistency: "strong" }), getStore({ name: "backup", consistency: "strong" })),
    backup: getStore({ name: "backup", consistency: "strong" }),
    world: getStore({ name: "world", consistency: "strong" }),
    mail: getStore({ name: "mail", consistency: "strong" }),
    now: Date.now(),
  });
  return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/admin/gold" };
