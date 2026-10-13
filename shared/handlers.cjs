// /api/act 與 /api/save 的處理邏輯(函式檔只負責驗證身分與取得儲存空間,實際流程都在這裡,方便完整測試)
// 一個帳號可以有多座城池:每座城池各一份存檔,存檔鍵 = 城池鍵(本丸就是帳號 id)。
// 請求用 body.c / ?c= 指定要操作哪座城,沒指定就是本丸。
const core = require("./server-core.cjs");
const world = require("./world-store.cjs");
const pvp = require("./pvp-run.cjs");
const battles = require("./battle-run.cjs");
const A = require("./acct.cjs");
const ships = require("./ship-run.cjs");
const market = require("./market-run.cjs");

// 在處理這位玩家的請求之前,先結算跟他有關、已經到期的玩家對戰(失敗不應該讓正常的請求跟著失敗)
async function settleBattles({ saves, world: wstore, battle, mail, uid, now }) {
  try {
    await battles.resolveDueFor({ saves, world: wstore, battle, mail, uid, now });
  } catch (e) {
    console.error("resolveDueFor failed", e);
  }
  try {
    await ships.resolveDueFor({ saves, world: wstore, battle, mail, uid, now });
  } catch (e) {
    console.error("ships.resolveDueFor failed", e);
  }
}

// 決定這次要操作哪座城;回傳 { key } 或 { err }
async function pickCity(wstore, owner, c) {
  if (typeof c !== "string" || !c || c === owner) return { key: owner };
  if (!A.isCityKey(c)) return { err: "城池代號錯誤" };
  const list = await A.list(wstore, owner);
  if (!list.includes(c)) return { err: "這座城池不屬於你(可能已經被奪走了)" };
  return { key: c };
}

// 這位玩家所有城池的摘要(給城池選單用)
async function cityList(saves, wstore, owner) {
  const keys = await A.list(wstore, owner), out = [];
  for (const k of keys) {
    const g = await saves.get(k, { type: "json" });
    const st = g && g.state;
    if (!st || !st.pos || !A.ownedBy(st, k, owner)) continue;
    out.push({ k, x: st.pos.x, y: st.pos.y, f: st.fac, col: st.col ? 1 : 0, loy: Math.floor(st.loy == null ? 100 : st.loy), n: st.col ? st.cname || "分城" : "本丸" });
  }
  return out;
}

async function act({ stores, user, body, now }) {
  const { saves, world: wstore, mail, battle } = stores;
  const owner = user.id, nick = world.nickOf(user);
  await settleBattles({ saves, world: wstore, battle, mail, uid: owner, now });

  const pk = await pickCity(wstore, owner, body && body.c);
  if (pk.err) return { status: 403, body: { ok: false, msg: pk.err, gone: 1 } };
  const key = pk.key;

  let got = await saves.getWithMetadata(key, { type: "json" });
  if (key !== owner && !(got && got.data && A.ownedBy(got.data.state, key, owner))) return { status: 403, body: { ok: false, msg: "這座城池已經不屬於你了", gone: 1 } };
  got = await world.ensureRegistered(saves, wstore, key, nick, got, now);
  const stored = got?.data ?? null;
  const etag = got?.etag;

  let pos = null;
  if (body?.action?.t === "init" && !stored && key === owner) pos = await world.allocate(wstore, owner);

  const attach = async (res) => ({ status: res.status, body: { ...res.body, c: key, incoming: await battles.incomingFor(battle, owner) } });

  // 玩家出兵(含偵察、開分城、行政官佔領):只登記,戰鬥在抵達時才結算
  if (body?.action?.t === "raidp" && stored) {
    const res = await pvp.prepare({ saves, world: wstore, battle, mail, uid: key, owner, nick, body, stored, etag, now });
    return attach(res);
  }

  // 撤回玩家對戰的出兵
  if (body?.action?.t === "recallp" && stored) {
    const res = await pvp.recall({ saves, world: wstore, battle, mail, uid: key, owner, body, stored, etag, now });
    return attach(res);
  }

  // 樂市樂座:運送、掛單、取消掛單、接受掛單
  const MK = { shipp: market.ship, offerp: market.offer, offerx: market.cancel, acceptp: market.accept };
  if (MK[body?.action?.t] && stored) {
    const res = await MK[body.action.t]({ saves, world: wstore, battle, mail, uid: key, owner, nick, body, stored, etag, now });
    return attach(res);
  }

  if (body?.action?.t === "reset" && key !== owner) return { status: 422, body: { ok: false, msg: "只能在本丸重新開始" } };
  const res = core.act(stored, body, now, { pos });
  if (res.store === "delete") {
    // 重新開始:本丸與所有分城一起清掉
    for (const k of await A.list(wstore, owner)) {
      await saves.delete(k);
      try { await world.remove(wstore, k); } catch {}
    }
    try { await wstore.delete(A.key(owner)); } catch {}
  } else if (res.store) {
    const needPublish = world.stampPub(res.store.state, nick, now);
    // 只有在資料沒被別的請求改過時才寫入,避免同時操作互相覆蓋
    const w = await saves.setJSON(key, res.store, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (w && w.modified === false) return { status: 409, body: { ok: false, msg: "同步衝突,請再試一次" } };
    if (needPublish) {
      try { await world.publishState(wstore, key, res.store.state, owner); } catch {}
    }
  }
  return attach(res);
}

async function save({ stores, user, now, c }) {
  const { saves, world: wstore, mail, battle } = stores;
  const owner = user.id;
  await settleBattles({ saves, world: wstore, battle, mail, uid: owner, now });
  let pk = await pickCity(wstore, owner, c);
  let key = pk.err ? owner : pk.key;
  let got = await saves.getWithMetadata(key, { type: "json" });
  if (key !== owner && !(got && got.data && A.ownedBy(got.data.state, key, owner))) { key = owner; got = await saves.getWithMetadata(key, { type: "json" }); }
  got = await world.ensureRegistered(saves, wstore, key, world.nickOf(user), got, now);
  return { status: 200, body: { ...core.view(got?.data ?? null, now), c: key, cities: await cityList(saves, wstore, owner), incoming: await battles.incomingFor(battle, owner) } };
}

module.exports = { act, save, settleBattles, cityList, pickCity };
