// 增援駐防的遣返:駐防在別人(或自己另一座)城池的部隊,可以由「派出的人」召回,
// 也可以由「那座城的主人」請他們回去。部隊會從駐地走回出發的城池。
//
// 兩份存檔的寫入順序:先在出發城池加上「返程中」的部隊(用 gid 去重),再把駐防名單移除。
// 這樣中途失敗、重試時,最多只是重複嘗試,不會讓部隊憑空消失或變成兩份。
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const A = require("./acct.cjs");
const pvp = require("./pvp-run.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 對一份存檔做「讀 → 改 → 條件寫入」,衝突就重試。fn 回傳 false 代表不用寫入
async function mutate(saves, key, now, fn) {
  for (let i = 0; i < 10; i++) {
    const g = await saves.getWithMetadata(key, { type: "json" });
    if (!g || !g.data || !g.data.state) return null;
    const st = clone(g.data.state);
    G.fix(st);
    const out = fn(st, g.data.rev);
    if (out === false) return { st, rev: g.data.rev, same: true };
    const w = await saves.setJSON(key, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) return { st, rev: g.data.rev + 1, out };
    await sleep(Math.random() * 6 * (i + 1));
  }
  throw new Error("garr: write conflict");
}

// 部分召回:a.take 是每個兵種要召回的人數。回傳 null = 全部召回;{err} = 填錯了;{t, remain} = 只召回 t,留下 remain
// 返程那一批的編號由「剩下的人數」決定(同樣的請求重送會得到同樣的編號,不會多叫回一批)
function planTake(a, u, hasHero) {
  if (!Array.isArray(a.take)) return null;
  const t = u.map((x, i) => Math.max(0, Math.min(x | 0, Math.floor(+a.take[i]) || 0)));
  const total = t.reduce((p, q) => p + q, 0), heroGo = !!(a.hero && hasHero);
  if (total < 1 && !heroGo) return { err: "請填要召回的人數,或勾選召回武將" };
  const remain = u.map((x, i) => (x | 0) - t[i]);
  if (!remain.some((x) => x > 0)) return null; // 兵全部召回 = 整支回去(武將也一起)
  return { t, remain, hero: heroGo, total };
}
const partMsg = (part, grp, dur) => `${part.total ? `召回 ${part.total} 人` : ""}${part.total && part.hero ? "與" : ""}${part.hero ? `武將「${grp.h.n}」` : ""},約 ${Math.max(1, Math.round(dur / G.SPEED / 60))} 分鐘後抵達(其餘 ${part.remain.reduce((p, q) => p + q, 0)} 人繼續駐守)`;
const ckey = (x, y) => `camp_${x}_${y}`;
const parseCamp = (k) => { const m = /^camp:(-?\d+),(-?\d+)$/.exec(String(k || "")); return m ? { x: +m[1], y: +m[2] } : null; };
async function homePos(world, hk) { return world.get("owner_" + hk, { type: "json" }); }

// 營寨駐軍召回:只撤走這一支駐軍,佔領不放棄(之後可以再派兵進駐)。a = { k:"camp:x,y", gid },hk = 出兵城存檔鍵
async function releaseCamp({ saves, world, owner, hk, a, now }) {
  const cp = parseCamp(a.k), gid = String(a.gid || "");
  if (!cp || !gid) return { ok: false, msg: "找不到這支駐軍" };
  const hg = await saves.get(hk, { type: "json" });
  const hst = hg && hg.state ? clone(hg.state) : null;
  if (!hst || !A.ownedBy(hst, hk, owner)) return { ok: false, msg: "找不到出兵的城池" };
  G.fix(hst);
  const grp = (hst.out || []).find((o) => o.gid === gid && o.k === a.k);
  if (!grp) return { ok: false, msg: "這支駐軍已經不在營寨了" };
  const hp = hst.pos, dist = Math.max(1, Math.hypot(hp.x - cp.x, hp.y - cp.y)), part = planTake(a, grp.u, !!grp.h);
  if (part && part.err) return { ok: false, msg: part.err };
  if (part) {
    const dur = G.garrDur(hst.fac, part.t, dist), gid2 = gid + "~" + part.remain.join(".") + (part.hero ? "h" : "");
    await mutate(saves, hk, now, (st) => { core.settleTo(st, now); const og = (st.out || []).find((o) => o.gid === gid); if (og) { og.u = part.remain.slice(); if (part.hero) delete og.h; } G.garrReturn(st, { gid: gid2, u: part.t, h: part.hero ? grp.h : undefined }, { name: grp.name || "營寨", dur }); });
    await W.casUpdate(world, ckey(cp.x, cp.y), (cur) => (cur && cur.o === owner && (cur.gs || []).some((g) => g.gid === gid) ? { ...cur, gs: cur.gs.map((g) => { if (g.gid !== gid) return g; const n = { ...g, u: part.remain.slice() }; if (part.hero) delete n.h; return n; }) } : undefined));
    return { ok: true, msg: partMsg(part, grp, dur) };
  }
  const dur = G.garrDur(hst.fac, grp.u, dist);
  await mutate(saves, hk, now, (st) => { core.settleTo(st, now); G.garrReturn(st, { gid, u: grp.u, h: grp.h }, { name: grp.name || "營寨", dur }); });
  await W.casUpdate(world, ckey(cp.x, cp.y), (cur) => (cur && cur.o === owner && (cur.gs || []).some((g) => g.gid === gid) ? { ...cur, gs: cur.gs.filter((g) => g.gid !== gid) } : undefined));
  return { ok: true, msg: `駐軍啟程返回,約 ${Math.max(1, Math.round(dur / G.SPEED / 60))} 分鐘後抵達(營寨仍歸你所有,可以再派兵進駐)` };
}

// 放棄營寨:全部駐軍返回各自的出兵城,營寨變回無主(要隔一段時間才會重新集結守軍)。ck = 佔領這座營寨的城存檔鍵
async function abandonCamp({ saves, world, owner, ck, a, now }) {
  const x = Math.floor(+a.x), y = Math.floor(+a.y), key = x + "," + y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, msg: "座標錯誤" };
  let gs = [], had = false;
  await W.casUpdate(world, ckey(x, y), (cur) => {
    gs = []; had = false;
    if (!cur || cur.o !== owner) return undefined;
    had = true; gs = cur.gs || [];
    return { o: null, g: {}, st: [0, 0, 0, 0], t: now, rs: cur.rs || {} };
  });
  // 這座城(以及每支駐軍的出兵城)各自收尾
  const homes = new Set([ck, ...gs.map((g) => g.k).filter(Boolean)]);
  for (const hk of homes) {
    const hg = await saves.get(hk, { type: "json" });
    if (!hg || !hg.state || !A.ownedBy(hg.state, hk, owner)) continue;
    const mine = (hg.state.out || []).filter((o) => o.k === "camp:" + key);
    for (const grp of mine) {
      const hp = hg.state.pos, dist = Math.max(1, Math.hypot(hp.x - x, hp.y - y)), dur = G.garrDur(hg.state.fac, grp.u, dist);
      await mutate(saves, hk, now, (st) => { core.settleTo(st, now); G.garrReturn(st, { gid: grp.gid, u: grp.u, h: grp.h }, { name: grp.name || "營寨", dur }); });
    }
    if (hk === ck) await mutate(saves, hk, now, (st) => { if (!st.occ[key]) return false; core.settleTo(st, now); G.campAbandon(st, key); });
  }
  if (!had) return { ok: true, msg: "這座營寨已經不是你的了,已清掉紀錄" };
  return { ok: true, msg: "已放棄營寨,駐軍正在返回" };
}

// owner = 操作的帳號;a = { k: 駐防所在的城池存檔鍵, gid }
async function release({ saves, world, owner, a, now, hk }) {
  const tk = String(a.k || ""), gid = String(a.gid || "");
  if (!tk || !gid) return { ok: false, msg: "找不到這支駐防部隊" };
  if (tk.startsWith("camp:")) {
    if (!(await pvp.lock(world, owner, now))) return { ok: false, msg: "上一個操作還在處理中,請稍候再試" };
    try { return await releaseCamp({ saves, world, owner, hk: hk || owner, a, now }); } finally { await pvp.unlock(world, owner).catch(() => {}); }
  }
  if (!(await pvp.lock(world, owner, now))) return { ok: false, msg: "上一個操作還在處理中,請稍候再試" };
  try {
    const tg = await saves.getWithMetadata(tk, { type: "json" });
    if (!tg || !tg.data || !tg.data.state) return { ok: false, msg: "找不到那座城池" };
    const tst = clone(tg.data.state);
    G.fix(tst);
    const grp = (tst.gar || []).find((x) => x.gid === gid);
    if (!grp) return { ok: false, msg: "這支駐防部隊已經不在那裡了" };
    const hostOwner = tst.own || tk;
    if (owner !== grp.o && owner !== hostOwner) return { ok: false, msg: "你不能調動這支部隊" };

    // 出發城池:還屬於原主就回去那裡,否則回到原主的主城
    let hk = grp.k;
    const hg = await saves.get(hk, { type: "json" });
    if (!hg || !hg.state || !A.ownedBy(hg.state, hk, grp.o)) hk = grp.o;
    const hpos = await world.get("owner_" + hk, { type: "json" }), tpos = await world.get("owner_" + tk, { type: "json" });
    const dist = hpos && tpos ? Math.max(1, Math.hypot(hpos.x - tpos.x, hpos.y - tpos.y)) : 10;
    const place = tst.cname || (tpos ? `(${tpos.x}|${tpos.y})` : "駐地");
    // 只有派兵的人能部分召回;那座城的主人請他們回去一律是全部
    const homeSt = hg && hg.state ? hg.state : null, homeEnt = homeSt && (homeSt.out || []).find((o) => o.gid === gid), part = owner === grp.o ? planTake(a, grp.u, !!(homeEnt && homeEnt.h)) : null;
    if (part && part.err) return { ok: false, msg: part.err };
    if (part) {
      const dur = G.garrDur(grp.fac, part.t, dist), gid2 = gid + "~" + part.remain.join(".") + (part.hero ? "h" : "");
      const heroInfo = part.hero && homeEnt ? homeEnt.h : undefined;
      const home = await mutate(saves, hk, now, (st) => {
        core.settleTo(st, now);
        const og = (st.out || []).find((o) => o.gid === gid);
        if (og) { og.u = part.remain.slice(); if (part.hero) delete og.h; }
        G.garrReturn(st, { gid: gid2, u: part.t, h: heroInfo }, { name: place, dur });
      });
      if (!home) return { ok: false, msg: "出發的城池已經不存在,部隊無法返回" };
      await mutate(saves, tk, now, (st) => { const g = (st.gar || []).find((x) => x.gid === gid); if (!g || g.u.every((x, i) => x === part.remain[i])) return false; g.u = part.remain.slice(); core.settleTo(st, now); });
      return { ok: true, msg: partMsg(part, { h: heroInfo || { n: "" } }, dur) };
    }
    const dur = G.garrDur(grp.fac, grp.u, dist);

    const home = await mutate(saves, hk, now, (st) => {
      core.settleTo(st, now);
      G.garrReturn(st, grp, { name: place, dur });
    });
    if (!home) return { ok: false, msg: "出發的城池已經不存在,部隊無法返回" };
    await mutate(saves, tk, now, (st) => { if (!G.garrTake(st, gid)) return false; core.settleTo(st, now); });
    return { ok: true, msg: `駐防部隊啟程返回,約 ${Math.max(1, Math.round(dur / G.SPEED / 60))} 分鐘後抵達` };
  } finally {
    await pvp.unlock(world, owner).catch(() => {});
  }
}

async function abandon({ saves, world, owner, ck, a, now }) {
  if (!(await pvp.lock(world, owner, now))) return { ok: false, msg: "上一個操作還在處理中,請稍候再試" };
  try { return await abandonCamp({ saves, world, owner, ck, a, now }); } finally { await pvp.unlock(world, owner).catch(() => {}); }
}

module.exports = { release, abandon };
