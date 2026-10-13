import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import world from "../../shared/world-store.cjs";

// 每次請求先嘗試續期登入(JWT 約 1 小時過期;閒置後第一次操作靠這個自動換新)。
// 用 namespace import:即使舊版套件沒有 refreshSession 也不會讓打包失敗。
const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};


// 地圖:查詢方框內有哪些玩家的城池  /api/world?x0=&y0=&x1=&y1=
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  const wstore = getStore({ name: "world", consistency: "strong" });
  const villages = await world.queryWindow(wstore, q.get("x0"), q.get("y0"), q.get("x1"), q.get("y1"), user.id);
  return Response.json({ ok: true, villages, now: Date.now() });
};

export const config = { path: "/api/world" };
