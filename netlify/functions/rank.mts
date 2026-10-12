import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import world from "../../shared/world-store.cjs";

// 排行榜:威望前 200 名
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const wstore = getStore({ name: "world", consistency: "strong" });
  return Response.json({ ok: true, rows: await world.topRank(wstore), now: Date.now() });
};

export const config = { path: "/api/rank" };
