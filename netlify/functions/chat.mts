import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import chat from "../../shared/chat-run.cjs";

const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};

// 聊天  GET /api/chat?s=公頻時間,盟頻時間,密頻時間 → 新訊息;POST { ch, to?, m } → 發言
export default async (req: Request) => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const world = getStore({ name: "world", consistency: "strong" });
  if (req.method === "GET") return Response.json({ ok: true, ...(await chat.state({ world, owner: user.id, since: new URL(req.url).searchParams.get("s") || "" })) }, { headers: { "cache-control": "no-store" } });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try { identity.verifyRequestOrigin(req); } catch { return Response.json({ ok: false, msg: "bad origin" }, { status: 403 }); }
  const text = await req.text();
  if (text.length > 2000) return Response.json({ ok: false, msg: "too large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(text); } catch { return Response.json({ ok: false, msg: "bad json" }, { status: 400 }); }
  const r = await chat.send({ world, user, body, now: Date.now() });
  return Response.json(r, { status: r.ok ? 200 : 422 });
};

export const config = { path: "/api/chat" };
