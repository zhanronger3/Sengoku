import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import market from "../../shared/market-run.cjs";

const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};

// 市場:目前所有掛單  GET /api/market → { offers }
export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const wstore = getStore({ name: "world", consistency: "strong" });
  return Response.json({ ok: true, offers: await market.listOffers(wstore, user.id) });
};

export const config = { path: "/api/market" };
