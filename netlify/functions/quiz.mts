import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import quiz from "../../shared/quiz-run.cjs";

const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};

// 每日一題  GET → 今天的題目(答過會帶解說);POST { a: 選項編號 } → 作答
export default async (req: Request) => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const world = getStore({ name: "world", consistency: "strong" });
  const saves = getStore({ name: "saves", consistency: "strong" });
  if (req.method === "GET") return Response.json(await quiz.state({ world, uid: user.id, now: Date.now() }));
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try { identity.verifyRequestOrigin(req); } catch { return Response.json({ ok: false, msg: "bad origin" }, { status: 403 }); }
  const text = await req.text();
  if (text.length > 500) return Response.json({ ok: false, msg: "too large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(text); } catch { return Response.json({ ok: false, msg: "bad json" }, { status: 400 }); }
  const r = await quiz.answer({ world, saves, uid: user.id, pick: body && body.a, now: Date.now() });
  return Response.json(r, { status: r.ok || r.done ? 200 : 422 });
};

export const config = { path: "/api/quiz" };
