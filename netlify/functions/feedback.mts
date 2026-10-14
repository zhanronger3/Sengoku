import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import fb from "../../shared/feedback-run.cjs";

const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};

// 意見箱  POST { s: 主旨, b: 內容 }
export default async (req: Request) => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try { identity.verifyRequestOrigin(req); } catch { return Response.json({ ok: false, msg: "bad origin" }, { status: 403 }); }
  const text = await req.text();
  if (text.length > 4000) return Response.json({ ok: false, msg: "too large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(text); } catch { return Response.json({ ok: false, msg: "bad json" }, { status: 400 }); }
  const world = getStore({ name: "world", consistency: "strong" });
  const pos = await world.get("owner_" + user.id, { type: "json" });
  const r = await fb.submit({ world, user, body, pos, now: Date.now() });
  return Response.json(r, { status: r.ok ? 200 : 422 });
};

export const config = { path: "/api/feedback" };
