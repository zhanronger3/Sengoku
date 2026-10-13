// 玩家出兵(只登記,不結算):
//   1 驗證 → 2 攻擊方存檔記一筆「出征中」(先寫,成功了才登記攻擊;失敗就什麼都沒發生)→ 3 登記攻擊與來襲警報
// 真正的戰鬥在部隊抵達時由 battle-run.cjs 結算。
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const B = require("./battle-run.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const LOCK_TTL = 15000;

// 同一位玩家的出兵請求一次只處理一個,避免重複送出同一個操作
async function lock(world, uid, now) {
  const key = "lock_" + uid;
  const w = await world.setJSON(key, { t: now }, { onlyIfNew: true });
  if (!w || w.modified !== false) return true;
  const g = await world.getWithMetadata(key, { type: "json" });
  if (g && g.data && now - g.data.t > LOCK_TTL) {
    const w2 = await world.setJSON(key, { t: now }, { onlyIfMatch: g.etag });
    return !(w2 && w2.modified === false);
  }
  return false;
}
const unlock = (world, uid) => world.delete("lock_" + uid);

async function prepare({ saves, world, battle, mail, uid, nick, body, stored, etag, now }) {
  const rev = stored.rev;
  if ((body.rev || 0) !== rev) return { status: 409, body: { ...core.view(stored, now), ok: false, msg: "已同步伺服器狀態" } };
  if (!(await lock(world, uid, now))) return { status: 409, body: { ok: false, msg: "上一個出兵操作還在處理中,請稍候再試" } };
  const att = core.settle(clone(stored.state), now);
  const fail = async (msg) => { await unlock(world, uid).catch(() => {}); return { status: 422, body: { ok: false, msg, state: att, rev, now } }; };
  try {
    const a = body.action;
    const tx = Math.floor(+a.tx), ty = Math.floor(+a.ty);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return await fail("座標錯誤");
    const hit = await W.findAt(world, tx, ty);
    if (!hit) return await fail("該座標沒有玩家的城池");
    if (hit.uid === uid) return await fail("不能攻擊自己的城池");
    const gotD = await saves.getWithMetadata(hit.uid, { type: "json" });
    if (!gotD || !gotD.data || !gotD.data.state) return await fail("對方還沒開始遊戲");
    const def = core.settle(clone(gotD.data.state), now);
    if (G.pvpProtected(def)) return await fail("對方仍在新手保護期,暫時不能攻擊");

    const aid = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const r = G.pvpLaunch(att, a, { aid, defNick: hit.rec.n, now });
    if (!r.ok) return await fail(r.msg);
    att.saved = now;
    const next = rev + 1;
    const w = await saves.setJSON(uid, { state: att, rev: next, updatedAt: now }, { onlyIfMatch: etag });
    if (w && w.modified === false) {
      await unlock(world, uid).catch(() => {});
      return { status: 409, body: { ...core.view((await saves.get(uid, { type: "json" })) || stored, now), ok: false, msg: "已同步伺服器狀態" } };
    }
    const arrAt = now + Math.round((r.dur / G.SPEED) * 1000);
    try {
      await B.registerAttack({
        battle, mail, now,
        rec: { id: aid, att: { uid, n: nick, x: r.pos.x, y: r.pos.y, fac: r.fac, ab: r.ab }, def: { uid: hit.uid, n: hit.rec.n, x: hit.rec.x, y: hit.rec.y }, send: r.send, sentAt: now, arrAt, go: r.go, dur: r.dur, dist: r.dist },
      });
    } catch (e) { /* 登記失敗:攻擊方的「出征中」紀錄在抵達時間過後會自動取消,部隊折返 */ }
    await unlock(world, uid).catch(() => {});
    const total = r.send.reduce((p, q) => p + q, 0), mins = Math.max(1, Math.round((arrAt - now) / 60000));
    return { status: 200, body: { ok: true, msg: `已出兵 ${total} 人前往 ${hit.rec.n}(${tx}|${ty}),約 ${mins} 分鐘後抵達;抵達時才會開戰,戰況會用飛鴿傳書通知你`, state: att, rev: next, now } };
  } catch (e) {
    await unlock(world, uid).catch(() => {});
    throw e;
  }
}

module.exports = { prepare, lock, unlock };
