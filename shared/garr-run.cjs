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

// owner = 操作的帳號;a = { k: 駐防所在的城池存檔鍵, gid }
async function release({ saves, world, owner, a, now }) {
  const tk = String(a.k || ""), gid = String(a.gid || "");
  if (!tk || !gid) return { ok: false, msg: "找不到這支駐防部隊" };
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

    // 出發城池:還屬於原主就回去那裡,否則回到原主的本丸
    let hk = grp.k;
    const hg = await saves.get(hk, { type: "json" });
    if (!hg || !hg.state || !A.ownedBy(hg.state, hk, grp.o)) hk = grp.o;
    const hpos = await world.get("owner_" + hk, { type: "json" }), tpos = await world.get("owner_" + tk, { type: "json" });
    const dist = hpos && tpos ? Math.max(1, Math.hypot(hpos.x - tpos.x, hpos.y - tpos.y)) : 10;
    const dur = G.garrDur(grp.fac, grp.u, dist);
    const place = tst.cname || (tpos ? `(${tpos.x}|${tpos.y})` : "駐地");

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

module.exports = { release };
