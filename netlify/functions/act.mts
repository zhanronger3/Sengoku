import { getStore } from "@netlify/blobs";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import core from "../../shared/server-core.cjs";
import world from "../../shared/world-store.cjs";
import pvp from "../../shared/pvp-run.cjs";

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

  const saves = getStore({ name: "saves", consistency: "strong" });
  const wstore = getStore({ name: "world", consistency: "strong" });
  const now = Date.now();
  const nick = world.nickOf(user);

  // 舊存檔沒有城池座標時,先替他分配
  let got: any = await saves.getWithMetadata(user.id, { type: "json" });
  got = await world.ensureRegistered(saves, wstore, user.id, nick, got, now);
  const stored = got?.data ?? null;
  const etag = got?.etag;

  // 新遊戲:先分配世界上的座標
  let pos = null;
  if (body?.action?.t === "init" && !stored) pos = await world.allocate(wstore, user.id);

  // 玩家對戰要同時動到兩位玩家的存檔,走專用流程
  const res: any = body?.action?.t === "raidp" && stored
    ? await pvp.prepare({ saves, world: wstore, uid: user.id, nick, body, stored, etag, now })
    : core.act(stored, body, now, { pos });

  try {
  let needPublish = false;
  if (res.store === "delete") {
    await saves.delete(user.id);
    try { await world.remove(wstore, user.id); } catch {}
  } else if (res.store) {
    needPublish = world.stampPub(res.store.state, nick, now);
    // 只有在資料沒被別的請求改過時才寫入,避免同時操作互相覆蓋
    const w: any = await saves.setJSON(user.id, res.store, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (w && w.modified === false) {
      return Response.json({ ok: false, msg: "同步衝突,請再試一次" }, { status: 409 });
    }
    if (needPublish) {
      try { await world.publishState(wstore, user.id, res.store.state); } catch {}
    }

  }
  return Response.json(res.body, { status: res.status });
  } finally {
    if (res.release) { try { await res.release(); } catch {} }
  }
};

export const config = { path: "/api/act" };
