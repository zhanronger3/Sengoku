import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import core from "../../shared/server-core.cjs";
import world from "../../shared/world-store.cjs";

// 只讀:回傳補算到「現在」的存檔。要改動存檔一律走 /api/act。
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const saves = getStore({ name: "saves", consistency: "strong" });
  const wstore = getStore({ name: "world", consistency: "strong" });
  const now = Date.now();
  let got: any = await saves.getWithMetadata(user.id, { type: "json" });
  got = await world.ensureRegistered(saves, wstore, user.id, world.nickOf(user), got, now);
  return Response.json(core.view(got?.data ?? null, now));
};

export const config = { path: "/api/save" };
