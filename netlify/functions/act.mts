import { getStore } from "@netlify/blobs";
import * as identity from "@netlify/identity";
import handlers from "../../shared/handlers.cjs";

// 每次請求先嘗試續期登入(JWT 約 1 小時過期;閒置後第一次操作靠這個自動換新)。
// 用 namespace import:即使舊版套件沒有 refreshSession 也不會讓打包失敗。
const getUser = async () => {
  try { await (identity as any).refreshSession?.(); } catch {}
  return identity.getUser();
};
const verifyRequestOrigin = (r: Request) => identity.verifyRequestOrigin(r);


export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  try {
    verifyRequestOrigin(req);
  } catch {
    return Response.json({ ok: false, msg: "bad origin" }, { status: 403 });
  }

  const text = await req.text();
  if (text.length > 10_000) return Response.json({ ok: false, msg: "too large" }, { status: 413 });
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, msg: "bad json" }, { status: 400 });
  }

  const stores = {
    saves: getStore({ name: "saves", consistency: "strong" }),
    world: getStore({ name: "world", consistency: "strong" }),
    mail: getStore({ name: "mail", consistency: "strong" }),
    battle: getStore({ name: "battle", consistency: "strong" }),
  };
  const r = await handlers.act({ stores, user, body, now: Date.now() });
  return Response.json(r.body, { status: r.status });
};

export const config = { path: "/api/act" };
