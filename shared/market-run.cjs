// 樂市樂座:運送資源、市場掛單、接受掛單。
// 市場掛單存在 world 的 "offers"(提供的資源先從掛單者的倉庫扣掉,成交時由商隊送給對方;取消時退回)。
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const M = require("./mail-store.cjs");
const S = require("./ship-run.cjs");
const pvp = require("./pvp-run.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const OFFERS_MAX = 300, PER_CITY = 5;
const newId = (now) => `${now}-${Math.random().toString(36).slice(2, 8)}`;

async function listOffers(world, viewer) {
  const l = await world.get("offers", { type: "json" });
  return ((l && l.a) || []).map((o) => ({ id: o.id, n: o.n, x: o.x, y: o.y, gi: o.gi, ga: o.ga, wi: o.wi, wa: o.wa, t: o.t, mine: o.o === viewer }));
}

// 共同開頭:版本檢查、上鎖、取得結算到現在的存檔副本
async function begin({ world, owner, stored, body, now }) {
  if ((body.rev || 0) !== stored.rev) return { res: { status: 409, body: { ...core.view(stored, now), ok: false, msg: "已同步伺服器狀態" } } };
  if (!(await pvp.lock(world, owner, now))) return { res: { status: 409, body: { ok: false, msg: "上一個操作還在處理中,請稍候再試" } } };
  return { att: core.settle(clone(stored.state), now) };
}
const conflict = async (saves, key, stored, now) => ({ status: 409, body: { ...core.view((await saves.get(key, { type: "json" })) || stored, now), ok: false, msg: "已同步伺服器狀態,請再試一次" } });

async function writeSave(saves, key, att, rev, etag, now) {
  att.saved = now;
  const w = await saves.setJSON(key, { state: att, rev: rev + 1, updatedAt: now }, { onlyIfMatch: etag });
  return !(w && w.modified === false);
}

// 運送資源給座標上的城池
async function ship({ saves, world, battle, mail, uid: key, owner, nick, body, stored, etag, now }) {
  const b = await begin({ world, owner, stored, body, now });
  if (b.res) return b.res;
  const att = b.att, rev = stored.rev;
  const fail = async (msg, status = 422) => { await pvp.unlock(world, owner).catch(() => {}); return { status, body: { ok: false, msg, state: att, rev, now } }; };
  try {
    const a = body.action, tx = Math.floor(+a.tx), ty = Math.floor(+a.ty);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return await fail("座標錯誤");
    const hit = await W.findAt(world, tx, ty);
    if (!hit) return await fail("該座標沒有玩家的城池");
    if (hit.uid === key) return await fail("不能運給自己這座城");
    const id = newId(now), name = `${hit.rec.n}(${tx}|${ty})`;
    const r = G.shipLaunch(att, { r: a.r }, { aid: id, x: tx, y: ty, name, now });
    if (!r.ok) return await fail(r.msg);
    if (!(await writeSave(saves, key, att, rev, etag, now))) { await pvp.unlock(world, owner).catch(() => {}); return await conflict(saves, key, stored, now); }
    try {
      await S.register({ battle, rec: { id, from: { k: key, o: owner, n: nick, x: r.pos.x, y: r.pos.y }, to: { k: hit.uid, o: hit.rec.o || hit.uid, x: tx, y: ty }, r: r.r, arrAt: now + Math.round((r.dur / G.SPEED) * 1000) } });
    } catch (e) { console.error("ship register failed", e); }
    try { const d = Math.round((r.dur / G.SPEED) * 1000); await W.addCaravan(world, { id, o: owner, fx: r.pos.x, fy: r.pos.y, tx, ty, t0: now, t1: now + d, t2: now + 2 * d }, now); } catch (e) { console.error("caravan publish failed", e); }
    await pvp.unlock(world, owner).catch(() => {});
    return { status: 200, body: { ok: true, msg: `${r.n} 名商人出發,約 ${Math.max(1, Math.round((r.dur / G.SPEED) / 60))} 分鐘後抵達 ${name}`, state: att, rev: rev + 1, now } };
  } catch (e) { await pvp.unlock(world, owner).catch(() => {}); throw e; }
}

// 掛單
async function offer({ saves, world, uid: key, owner, nick, body, stored, etag, now }) {
  const b = await begin({ world, owner, stored, body, now });
  if (b.res) return b.res;
  const att = b.att, rev = stored.rev;
  const fail = async (msg) => { await pvp.unlock(world, owner).catch(() => {}); return { status: 422, body: { ok: false, msg, state: att, rev, now } }; };
  try {
    const a = body.action;
    const c = G.offerCheck(att, [a.gi, a.ga], [a.wi, a.wa]);
    if (!c.ok) return await fail(c.msg);
    const cur = await world.get("offers", { type: "json" });
    const list = (cur && cur.a) || [];
    if (list.filter((o) => o.k === key).length >= PER_CITY) return await fail(`每座城最多同時掛 ${PER_CITY} 筆單`);
    if (list.length >= OFFERS_MAX) return await fail("市場掛單已滿,請稍後再試");
    const o = { id: newId(now), k: key, o: owner, n: nick, x: att.pos.x, y: att.pos.y, gi: c.gi, ga: c.ga, wi: c.wi, wa: c.wa, t: now };
    G.offerTake(att, o);
    if (!(await writeSave(saves, key, att, rev, etag, now))) { await pvp.unlock(world, owner).catch(() => {}); return await conflict(saves, key, stored, now); }
    try { await W.casUpdate(world, "offers", (cur2) => ({ a: [...((cur2 && cur2.a) || []), o] })); }
    catch (e) { // 掛單沒登記成功:把資源退回
      console.error("offer list failed", e);
      for (let i = 0; i < 5; i++) { const g = await saves.getWithMetadata(key, { type: "json" }); const st = clone(g.data.state); G.fix(st); G.offerRefund(st, o); const w = await saves.setJSON(key, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag }); if (!w || w.modified !== false) break; }
      await pvp.unlock(world, owner).catch(() => {});
      return { status: 500, body: { ok: false, msg: "掛單失敗,資源已退回" } };
    }
    await pvp.unlock(world, owner).catch(() => {});
    return { status: 200, body: { ok: true, msg: "已在市場掛單", state: att, rev: rev + 1, now } };
  } catch (e) { await pvp.unlock(world, owner).catch(() => {}); throw e; }
}

// 取消自己的掛單(退回資源)
async function cancel({ saves, world, uid: key, owner, body, stored, etag, now }) {
  const b = await begin({ world, owner, stored, body, now });
  if (b.res) return b.res;
  const att = b.att, rev = stored.rev;
  try {
    const id = String(body.action.id || ""); let taken = null;
    await W.casUpdate(world, "offers", (cur) => {
      taken = null;
      const o = cur && cur.a.find((x) => x.id === id && x.o === owner);
      if (!o) return undefined;
      taken = o; return { a: cur.a.filter((x) => x.id !== id) };
    });
    if (!taken) { await pvp.unlock(world, owner).catch(() => {}); return { status: 422, body: { ok: false, msg: "找不到這筆掛單(可能已經成交)", state: att, rev, now } }; }
    // 退回到掛單的那座城(可能不是目前這座)
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      const same = taken.k === key;
      const g = same ? { data: { state: att, rev }, etag } : await saves.getWithMetadata(taken.k, { type: "json" });
      if (!g || !g.data) break;
      const st = same ? att : clone(g.data.state);
      if (!same) G.fix(st);
      G.offerRefund(st, taken); st.saved = same ? now : st.saved;
      const w = await saves.setJSON(taken.k, { state: st, rev: g.data.rev + 1, updatedAt: now }, same ? { onlyIfMatch: etag } : { onlyIfMatch: g.etag });
      if (!w || w.modified !== false) { ok = true; if (same) { await pvp.unlock(world, owner).catch(() => {}); return { status: 200, body: { ok: true, msg: "已取消掛單,資源退回", state: att, rev: rev + 1, now } }; } break; }
      if (same) { await W.casUpdate(world, "offers", (cur) => ({ a: [...((cur && cur.a) || []), taken] })); await pvp.unlock(world, owner).catch(() => {}); return await conflict(saves, key, stored, now); }
    }
    await pvp.unlock(world, owner).catch(() => {});
    if (!ok) { await W.casUpdate(world, "offers", (cur) => ({ a: [...((cur && cur.a) || []), taken] })); return { status: 409, body: { ok: false, msg: "取消失敗,請再試一次" } }; }
    const cur2 = core.view((await saves.get(key, { type: "json" })) || stored, now);
    return { status: 200, body: { ...cur2, msg: "已取消掛單,資源退回" } };
  } catch (e) { await pvp.unlock(world, owner).catch(() => {}); throw e; }
}

// 接受別人的掛單
async function accept({ saves, world, battle, mail, uid: key, owner, nick, body, stored, etag, now }) {
  const b = await begin({ world, owner, stored, body, now });
  if (b.res) return b.res;
  const att = b.att, rev = stored.rev;
  const fail = async (msg, status = 422) => { await pvp.unlock(world, owner).catch(() => {}); return { status, body: { ok: false, msg, state: att, rev, now } }; };
  try {
    const id = String(body.action.id || "");
    const l = await world.get("offers", { type: "json" });
    const o = l && l.a.find((x) => x.id === id);
    if (!o) return await fail("這筆掛單已經不存在了");
    if (o.o === owner) return await fail("不能接受自己的掛單");
    const c = G.acceptCheck(att, o);
    if (!c.ok) return await fail(c.msg);
    let claimed = null;
    await W.casUpdate(world, "offers", (cur) => { claimed = null; const x = cur && cur.a.find((y) => y.id === id); if (!x) return undefined; claimed = x; return { a: cur.a.filter((y) => y.id !== id) }; });
    if (!claimed) return await fail("這筆掛單剛剛被別人接走了", 409);
    const restore = () => W.casUpdate(world, "offers", (cur) => ({ a: [...((cur && cur.a) || []), claimed] }));
    const pid = id + "-p", gid = id + "-g";
    const r = G.acceptTake(att, claimed, { aid: pid, now });
    if (!(await writeSave(saves, key, att, rev, etag, now))) { await restore(); await pvp.unlock(world, owner).catch(() => {}); return await conflict(saves, key, stored, now); }
    const arr = now + Math.round((r.dur / G.SPEED) * 1000), me = { k: key, o: owner, n: nick, x: att.pos.x, y: att.pos.y };
    try {
      const rp = [0, 0, 0, 0]; rp[claimed.wi] = claimed.wa;
      const rg = [0, 0, 0, 0]; rg[claimed.gi] = claimed.ga;
      await S.register({ battle, rec: { id: pid, from: me, to: { k: claimed.k, o: claimed.o, x: claimed.x, y: claimed.y }, r: rp, arrAt: arr } });
      await S.register({ battle, rec: { id: gid, from: { k: claimed.k, o: claimed.o, n: claimed.n, x: claimed.x, y: claimed.y }, to: { k: key, o: owner, x: me.x, y: me.y }, r: rg, arrAt: arr } });
      await M.systemMail(mail, claimed.o, "【市場】掛單成交", `${nick}(${me.x}|${me.y})接受了你的掛單:你換出 ${G.RN[claimed.gi]} ${claimed.ga},對方付 ${G.RN[claimed.wi]} ${claimed.wa}。商隊抵達後資源會自動入庫。`, now, { id: `ofr-${id}`, limit: 600 });
    } catch (e) { console.error("accept register failed", e); }
    await pvp.unlock(world, owner).catch(() => {});
    return { status: 200, body: { ok: true, msg: `成交!${r.n} 名商人出發,約 ${Math.max(1, Math.round(r.dur / G.SPEED / 60))} 分鐘後雙方的貨都會送達`, state: att, rev: rev + 1, now } };
  } catch (e) { await pvp.unlock(world, owner).catch(() => {}); throw e; }
}

module.exports = { listOffers, ship, offer, cancel, accept };
