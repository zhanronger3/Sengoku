// 玩家對戰的伺服器流程(要同時動到兩位玩家的存檔)。
// 順序:取得攻擊方的鎖 → 對「防守方最新存檔」計算並寫入結果(搶到多少由防守方當下的資源決定,
// 所以兩個人同時打同一個人,也不會搶到超過對方實際有的資源)→ 寫入攻擊方。
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK_TTL = 15000;

// 同一位玩家的出兵請求一次只處理一個,避免重複送出同一個操作而對防守方造成多次傷害
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

async function prepare({ saves, world, uid, nick, body, stored, etag, now }) {
  const rev = stored.rev;
  if ((body.rev || 0) !== rev) {
    return { status: 409, body: { ...core.view(stored, now), ok: false, msg: "已同步伺服器狀態" } };
  }
  if (!(await lock(world, uid, now))) {
    return { status: 409, body: { ok: false, msg: "上一個出兵操作還在處理中,請稍候再試" } };
  }
  const release = () => unlock(world, uid);
  const a = body.action;
  const att = core.settle(clone(stored.state), now);
  const fail = async (msg) => {
    await release().catch(() => {});
    return { status: 422, body: { ok: false, msg, state: att, rev, now } };
  };
  try {
    const tx = Math.floor(+a.tx), ty = Math.floor(+a.ty);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return await fail("座標錯誤");
    const hit = await W.findAt(world, tx, ty);
    if (!hit) return await fail("該座標沒有玩家的城池");
    if (hit.uid === uid) return await fail("不能攻擊自己的城池");

    let done = null;
    for (let i = 0; i < 10 && !done; i++) {
      const g = await saves.getWithMetadata(hit.uid, { type: "json" });
      if (!g || !g.data || !g.data.state) return await fail("對方還沒開始遊戲");
      const def = core.settle(clone(g.data.state), now);
      const attTry = clone(att);
      const r = G.pvp(attTry, def, a, { attNick: nick, defNick: hit.rec.n });
      if (!r.ok) return await fail(r.msg);
      // 動到防守方之前,再確認一次攻擊方的存檔沒有被別的請求改過
      const cur = await saves.getWithMetadata(uid, { type: "json" });
      if (!cur || cur.etag !== etag) {
        await release().catch(() => {});
        return { status: 409, body: { ...core.view(cur ? cur.data : stored, now), ok: false, msg: "已同步伺服器狀態" } };
      }
      G.pvpApplyDef(def, r.effect);
      const w = await saves.setJSON(hit.uid, { state: def, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
      if (!w || w.modified !== false) done = { att: attTry, r };
      else await sleep(Math.random() * 5 * (i + 1));
    }
    if (!done) return await fail("對方正在被其他人攻擊,請稍後再試");

    done.att.saved = now;
    const next = rev + 1;
    return {
      status: 200,
      body: { ok: true, msg: done.r.msg, state: done.att, rev: next, now },
      store: { state: done.att, rev: next, updatedAt: now },
      release, // act.mts 在寫入攻擊方存檔後(不論成功或衝突)呼叫
    };
  } catch (e) {
    await release().catch(() => {});
    throw e;
  }
}

module.exports = { prepare, lock, unlock };
