import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import forumRun from "../../shared/forum-run.cjs";
import world from "../../shared/world-store.cjs";

// 討論版
//   GET  /api/forum           → 主題列表(?cat=分類);訪客也能看
//   GET  /api/forum?t=<id>    → 單篇主題與回覆
//   POST /api/forum           → { t:"new"|"reply"|"del"|"pin"|"lock", ... },需要登入
// 管理員:Netlify 環境變數 FORUM_ADMINS 填帳號 email 或 id,用逗號分隔。管理員可以發官方公告、置頂、鎖定、刪除任何文章。
const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};
const env = (k: string) => (globalThis as any).Netlify?.env?.get(k) ?? process.env[k] ?? "";

export default async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const u: any = await getUser();
  let body: any = null;
  if (req.method === "POST") {
    if (!u) return Response.json({ ok: false, msg: "請先登入遊戲再發文" }, { status: 401 });
    try { identity.verifyRequestOrigin(req); } catch { return Response.json({ ok: false, msg: "bad origin" }, { status: 403 }); }
    const text = await req.text();
    if (text.length > 8000) return Response.json({ ok: false, msg: "內容太長" }, { status: 413 });
    try { body = JSON.parse(text); } catch { return Response.json({ ok: false, msg: "bad json" }, { status: 400 }); }
  }
  let user = null;
  if (u) {
    const meta: any = u.userMetadata ?? {};
    const admins = String(env("FORUM_ADMINS")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    user = {
      id: String(u.id),
      nick: String(world.nickOf({ id: u.id, name: u.name ?? meta.full_name }) || "主公").slice(0, 20),
      admin: admins.includes(String(u.id).toLowerCase()) || (!!u.email && admins.includes(String(u.email).toLowerCase())),
    };
  }
  try {
    const r = await forumRun.forum({
      store: getStore({ name: "forum", consistency: "strong" }),
      user,
      method: req.method,
      query: Object.fromEntries(new URL(req.url).searchParams),
      body,
      now: Date.now(),
    });
    return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("forum failed", e);
    return Response.json({ ok: false, msg: "伺服器忙碌中,請稍後再試" }, { status: 500 });
  }
};

export const config = { path: "/api/forum" };
