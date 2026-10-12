import { getStore } from "@netlify/blobs";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import world from "../../shared/world-store.cjs";
import mailer from "../../shared/mail-store.cjs";

// 飛鴿傳書
//  GET  /api/mail            → { inbox, sent, unread }
//  GET  /api/mail?count=1    → { unread }(只查未讀數,給導覽列的紅字用)
//  POST { t:"send", tx, ty, s, b } / { t:"read", id } / { t:"del", box, id }
export default async (req: Request) => {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const mail = getStore({ name: "mail", consistency: "strong" });

  if (req.method === "GET") {
    if (new URL(req.url).searchParams.get("count")) {
      return Response.json({ ok: true, unread: await mailer.unreadCount(mail, user.id) });
    }
    return Response.json({ ok: true, ...(await mailer.listMail(mail, user.id)) });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    verifyRequestOrigin(req);
  } catch {
    return Response.json({ ok: false, msg: "bad origin" }, { status: 403 });
  }
  const text = await req.text();
  if (text.length > 6000) return Response.json({ ok: false, msg: "too large" }, { status: 413 });
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, msg: "bad json" }, { status: 400 });
  }

  if (body.t === "send") {
    const wstore = getStore({ name: "world", consistency: "strong" });
    const pos = await wstore.get("owner_" + user.id, { type: "json" });
    if (!pos) return Response.json({ ok: false, msg: "請先開始遊戲" }, { status: 422 });
    const r = await mailer.send(mail, wstore, {
      uid: user.id, nick: world.nickOf(user), pos,
      tx: body.tx, ty: body.ty, subject: body.s, body: body.b, now: Date.now(),
    });
    return Response.json(r, { status: r.ok ? 200 : 422 });
  }
  if (body.t === "read" && typeof body.id === "string") {
    await mailer.markRead(mail, user.id, body.id);
    return Response.json({ ok: true });
  }
  if (body.t === "del" && typeof body.id === "string") {
    await mailer.remove(mail, user.id, body.box, body.id);
    return Response.json({ ok: true });
  }
  return Response.json({ ok: false, msg: "未知的操作" }, { status: 400 });
};

export const config = { path: "/api/mail" };
