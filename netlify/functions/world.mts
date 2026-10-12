import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import world from "../../shared/world-store.cjs";

// 地圖:查詢方框內有哪些玩家的村莊  /api/world?x0=&y0=&x1=&y1=
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  const wstore = getStore({ name: "world", consistency: "strong" });
  const villages = await world.queryWindow(wstore, q.get("x0"), q.get("y0"), q.get("x1"), q.get("y1"));
  return Response.json({ ok: true, villages, now: Date.now() });
};

export const config = { path: "/api/world" };
