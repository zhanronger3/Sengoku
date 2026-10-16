// /api/act 與 /api/save 的處理邏輯(函式檔只負責驗證身分與取得儲存空間,實際流程都在這裡,方便完整測試)
// 一個帳號可以有多座城池:每座城池各一份存檔,存檔鍵 = 城池鍵(主城就是帳號 id)。
// 請求用 body.c / ?c= 指定要操作哪座城,沒指定就是主城。
const core = require("./server-core.cjs");
const world = require("./world-store.cjs");
const pvp = require("./pvp-run.cjs");
const battles = require("./battle-run.cjs");
const A = require("./acct.cjs");
const ships = require("./ship-run.cjs");
const market = require("./market-run.cjs");
const { accOf } = require("./acc-run.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));

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
  const pl = keys.length > 1 ? (await wstore.get("pl_" + owner, { type: "json" })) || { cs: {} } : null;
  for (const k of keys) {
    const g = await saves.get(k, { type: "json" });
    const st = g && g.state;
    if (!st || !st.pos || !A.ownedBy(st, k, owner)) continue;
    if (pl && !pl.cs[k] && st.pub) { try { const s2 = JSON.parse(JSON.stringify(st)); s2.pub = null; world.stampPub(s2, st.pub.n, Date.now()); await world.publishState(wstore, k, s2, owner); } catch {} }
    out.push({ k, x: st.pos.x, y: st.pos.y, f: st.fac, col: st.col ? 1 : 0, loy: Math.floor(st.loy == null ? 100 : st.loy), b: st.born || 0, n: st.col ? st.cname || "分城" : "主城" });
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

  const attach = async (res) => {
    const b = res.body;
    // 分城的金幣放在主城:所有回應都要帶主城的金幣,不然畫面會閃成 0
    if (key !== owner && b && b.state && b.state.col && !res.goldSet) {
      const cg = await saves.get(owner, { type: "json" });
      if (cg && cg.state) b.state = { ...b.state, gold: core.settle(JSON.parse(JSON.stringify(cg.state)), now).gold };
    }
    let acc = null;
    try { acc = await accOf({ saves, world: wstore, owner, cur: b && b.state && b.state.pos ? { key, state: b.state } : null, now }); } catch (e) { console.error("accOf failed", e); }
    return { status: res.status, body: { ...b, c: key, acc, incoming: await battles.incomingFor(battle, owner) } };
  };

  // 任務與每日任務獎勵:任務是帳號的(任何一座城都能領),獎勵一律存進主城
  if ((body?.action?.t === "claim" || body?.action?.t === "claimd") && stored) {
    const capGot = key === owner ? got : await saves.getWithMetadata(owner, { type: "json" });
    if (!capGot || !capGot.data) return { status: 422, body: { ok: false, msg: "找不到主城存檔" } };
    const curState = key === owner ? null : { key, state: core.settle(clone(stored.state), now) };
    const acc = await accOf({ saves, world: wstore, owner, cur: curState, now });
    const res = core.act(capGot.data, key === owner ? body : { ...body, rev: capGot.data.rev }, now, { acc });
    const colView = () => { const v = core.view(stored, now); return { ...v, state: { ...v.state, gold: res.store ? res.store.state.gold : core.settle(clone(capGot.data.state), now).gold } }; };
    if (!res.store) return attach(key === owner ? res : { status: res.status, body: { ...colView(), ok: false, msg: res.body.msg }, goldSet: true });
    const w = await saves.setJSON(owner, res.store, { onlyIfMatch: capGot.etag });
    if (w && w.modified === false) return { status: 409, body: { ok: false, msg: "同步衝突,請再試一次" } };
    if (key === owner) return attach(res);
    return attach({ status: 200, body: { ...colView(), ok: true, msg: (res.body.msg || "") + "(已存入主城)" }, goldSet: true });
  }

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

  // 召回或遣返駐防在別座城池的增援部隊
  if (body?.action?.t === "garrp" && stored) {
    const r = await require("./garr-run.cjs").release({ saves, world: wstore, owner, a: body.action, now, hk: key });
    const fresh = await saves.get(key, { type: "json" });
    return attach({ status: r.ok ? 200 : 422, body: { ...core.view(fresh || stored, now), ok: r.ok, msg: r.msg } });
  }

  // 放棄佔領的營寨
  if (body?.action?.t === "campx" && stored) {
    const r = await require("./garr-run.cjs").abandon({ saves, world: wstore, owner, ck: key, a: body.action, now });
    const fresh = await saves.get(key, { type: "json" });
    return attach({ status: r.ok ? 200 : 422, body: { ...core.view(fresh || stored, now), ok: r.ok, msg: r.msg } });
  }

  // 樂市樂座:運送、掛單、取消掛單、接受掛單
  const MK = { shipp: market.ship, offerp: market.offer, offerx: market.cancel, acceptp: market.accept };
  if (MK[body?.action?.t] && stored) {
    const res = await MK[body.action.t]({ saves, world: wstore, battle, mail, uid: key, owner, nick, body, stored, etag, now });
    return attach(res);
  }

  if (body?.action?.t === "reset" && key !== owner) return { status: 422, body: { ok: false, msg: "只能在主城重新開始" } };
  // 分城也能用金幣:金幣是玩家的(存在主城),分城的金幣操作先向主城扣款
  const GOLDT = ["buy", "balance", "rushall"];
  let cap = null, useStored = stored;
  if (key !== owner && stored && GOLDT.includes(body?.action?.t)) {
    const cg = await saves.getWithMetadata(owner, { type: "json" });
    if (!cg || !cg.data) return { status: 422, body: { ok: false, msg: "找不到主城存檔" } };
    cap = { g: cg, st: core.settle(JSON.parse(JSON.stringify(cg.data.state)), now) };
    useStored = { ...stored, state: { ...stored.state, gold: cap.st.gold } };
  }
  const res = core.act(useStored, body, now, { pos });
  if (cap && res.store && res.store !== "delete") {
    const spent = cap.st.gold - res.store.state.gold;
    if (spent > 1e-9) {
      cap.st.gold -= spent;
      const wc = await saves.setJSON(owner, { ...cap.g.data, state: cap.st, updatedAt: now }, { onlyIfMatch: cap.g.etag });
      if (wc && wc.modified === false) return { status: 409, body: { ok: false, msg: "同步衝突,請再試一次" } };
    }
    res.body = { ...res.body, state: { ...res.body.state, gold: cap.st.gold } };
    res.store = { ...res.store, state: { ...res.store.state, gold: 0 } };
    res.refund = spent > 1e-9 ? spent : 0;
  }
  if (res.store === "delete") {
    // 重新開始:主城與所有分城一起清掉
    try { await require("./ally-run.cjs").act({ saves, world: wstore, mail, user, body: { action: { t: "leave" } }, now }); } catch {}
    for (const k of await A.list(wstore, owner)) {
      await saves.delete(k);
      try { await world.remove(wstore, k); } catch {}
    }
    try { await wstore.delete(A.key(owner)); } catch {}
    try { await world.removePlayer(wstore, owner); } catch {}
  } else if (res.store) {
    const needPublish = world.stampPub(res.store.state, nick, now);
    // 只有在資料沒被別的請求改過時才寫入,避免同時操作互相覆蓋
    const w = await saves.setJSON(key, res.store, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (w && w.modified === false) {
      if (res.refund) await require("./world-store.cjs").casUpdate(saves, owner, (c) => (c && c.state ? { ...c, state: { ...c.state, gold: (c.state.gold || 0) + res.refund } } : undefined));
      return { status: 409, body: { ok: false, msg: "同步衝突,請再試一次" } };
    }
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
  const vw = core.view(got?.data ?? null, now);
  if (key !== owner && vw.state && vw.state.col) {
    const cg = await saves.get(owner, { type: "json" });
    if (cg && cg.state) vw.state.gold = core.settle(JSON.parse(JSON.stringify(cg.state)), now).gold;
  }
  let acc = null;
  try { acc = await accOf({ saves, world: wstore, owner, cur: vw.state && vw.state.pos ? { key, state: vw.state } : null, now }); } catch (e) { console.error("accOf failed", e); }
  return { status: 200, body: { ...vw, c: key, acc, cities: await cityList(saves, wstore, owner), incoming: await battles.incomingFor(battle, owner) } };
}

module.exports = { act, save, settleBattles, cityList, pickCity };
