import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import ally from "../../shared/ally-run.cjs";

const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};

// 奏者番(聯盟)  GET → 目前狀態;POST { t: create|invite|uninvite|accept|decline|leave|kick|disband|msg, ... } → 結果與最新狀態
export default async (req: Request) => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const stores = {
    saves: getStore({ name: "saves", consistency: "strong" }),
    world: getStore({ name: "world", consistency: "strong" }),
    mail: getStore({ name: "mail", consistency: "strong" }),
  };
  if (req.method === "GET") return Response.json({ ok: true, ...(await ally.state({ ...stores, owner: user.id })) });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    identity.verifyRequestOrigin(req);
  } catch {
    return Response.json({ ok: false, msg: "bad origin" }, { status: 403 });
  }
  const text = await req.text();
  if (text.length > 4000) return Response.json({ ok: false, msg: "too large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(text); } catch { return Response.json({ ok: false, msg: "bad json" }, { status: 400 }); }
  const r = await ally.act({ ...stores, user, body: { action: body }, now: Date.now() });
  return Response.json(r, { status: r.ok ? 200 : 422 });
};

export const config = { path: "/api/ally" };
