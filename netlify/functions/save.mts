import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import handlers from "../../shared/handlers.cjs";

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
