import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import world from "../../shared/world-store.cjs";

// 每次請求先嘗試續期登入(JWT 約 1 小時過期;閒置後第一次操作靠這個自動換新)。
// 用 namespace import:即使舊版套件沒有 refreshSession 也不會讓打包失敗。
const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};


// 排行榜:威望前 200 名
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const wstore = getStore({ name: "world", consistency: "strong" });
  return Response.json({ ok: true, rows: await world.topRank(wstore), now: Date.now() });
};

export const config = { path: "/api/rank" };
