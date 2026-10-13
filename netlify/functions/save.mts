import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import handlers from "../../shared/handlers.cjs";

// 每次請求先嘗試續期登入(JWT 約 1 小時過期;閒置後第一次操作靠這個自動換新)。
// 用 namespace import:即使舊版套件沒有 refreshSession 也不會讓打包失敗。
const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};


// 回傳補算到「現在」的存檔(同時結算已經抵達的玩家對戰)。要改動存檔一律走 /api/act。
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const stores = {
    saves: getStore({ name: "saves", consistency: "strong" }),
    world: getStore({ name: "world", consistency: "strong" }),
    mail: getStore({ name: "mail", consistency: "strong" }),
    battle: getStore({ name: "battle", consistency: "strong" }),
  };
  const r = await handlers.save({ stores, user, now: Date.now() });
  return Response.json(r.body, { status: r.status });
};

export const config = { path: "/api/save" };
