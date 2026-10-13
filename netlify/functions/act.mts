import { getStore } from "@netlify/blobs";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import handlers from "../../shared/handlers.cjs";

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
