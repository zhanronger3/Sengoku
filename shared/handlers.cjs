// /api/act 與 /api/save 的處理邏輯(函式檔只負責驗證身分與取得儲存空間,實際流程都在這裡,方便完整測試)
const core = require("./server-core.cjs");
const world = require("./world-store.cjs");
const pvp = require("./pvp-run.cjs");
const battles = require("./battle-run.cjs");

// 在處理這位玩家的請求之前,先結算跟他有關、已經到期的玩家對戰(失敗不應該讓正常的請求跟著失敗)
async function settleBattles({ saves, battle, mail, uid, now }) {
  try {
    await battles.resolveDueFor({ saves, battle, mail, uid, now });
  } catch (e) {
    console.error("resolveDueFor failed", e);
  }
}

async function act({ stores, user, body, now }) {
  const { saves, world: wstore, mail, battle } = stores;
  const nick = world.nickOf(user);
  await settleBattles({ saves, battle, mail, uid: user.id, now });

  let got = await saves.getWithMetadata(user.id, { type: "json" });
  got = await world.ensureRegistered(saves, wstore, user.id, nick, got, now);
  const stored = got?.data ?? null;
  const etag = got?.etag;

  let pos = null;
  if (body?.action?.t === "init" && !stored) pos = await world.allocate(wstore, user.id);

  const attach = async (res) => ({ status: res.status, body: { ...res.body, incoming: await battles.incomingFor(battle, user.id) } });

  // 玩家出兵:只登記,戰鬥在抵達時才結算
  if (body?.action?.t === "raidp" && stored) {
    const res = await pvp.prepare({ saves, world: wstore, battle, mail, uid: user.id, nick, body, stored, etag, now });
    return attach(res);
  }

  // 撤回玩家對戰的出兵
  if (body?.action?.t === "recallp" && stored) {
    const res = await pvp.recall({ saves, world: wstore, battle, mail, uid: user.id, body, stored, etag, now });
    return attach(res);
  }

  const res = core.act(stored, body, now, { pos });
  if (res.store === "delete") {
    await saves.delete(user.id);
    try { await world.remove(wstore, user.id); } catch {}
  } else if (res.store) {
    const needPublish = world.stampPub(res.store.state, nick, now);
    // 只有在資料沒被別的請求改過時才寫入,避免同時操作互相覆蓋
    const w = await saves.setJSON(user.id, res.store, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (w && w.modified === false) return { status: 409, body: { ok: false, msg: "同步衝突,請再試一次" } };
    if (needPublish) {
      try { await world.publishState(wstore, user.id, res.store.state); } catch {}
    }
  }
  return attach(res);
}

async function save({ stores, user, now }) {
  const { saves, world: wstore, mail, battle } = stores;
  await settleBattles({ saves, battle, mail, uid: user.id, now });
  let got = await saves.getWithMetadata(user.id, { type: "json" });
  got = await world.ensureRegistered(saves, wstore, user.id, world.nickOf(user), got, now);
  return { status: 200, body: { ...core.view(got?.data ?? null, now), incoming: await battles.incomingFor(battle, user.id) } };
}

module.exports = { act, save, settleBattles };
