// 商隊運送:登記 → 抵達時把資源放進收貨城池的倉庫(可重複執行,收貨城池的存檔裡記有 shipRes[編號])
//   shp_<id>   一趟運送的資料
//   shin_<uid> 某位玩家(帳號)的「待收貨」清單
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const M = require("./mail-store.cjs");
const A = require("./acct.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLAIM_TTL = 20000;
const skey = (id) => "shp_" + id, ikey = (uid) => "shin_" + uid;
const RN = G.RN;

// rec: { id, from:{k,o,n,x,y}, to:{k,o,x,y}, r:[4], arrAt }
async function register({ battle, rec }) {
  await battle.setJSON(skey(rec.id), { ...rec, state: "pending" }, { onlyIfNew: true });
  await W.casUpdate(battle, ikey(rec.to.o), (cur) => ({ a: [...((cur && cur.a) || []).filter((e) => e.id !== rec.id), { id: rec.id, arrAt: rec.arrAt }] }));
}

async function resolve({ saves, battle, mail, id, now }) {
  let rec = null, claimed = false;
  await W.casUpdate(battle, skey(id), (cur) => {
    claimed = false;
    if (!cur || cur.state === "done") return undefined;
    if (cur.state === "resolving" && now - (cur.claimAt || 0) < CLAIM_TTL) return undefined;
    rec = cur; claimed = true;
    return { ...cur, state: "resolving", claimAt: now };
  });
  if (!claimed || !rec) return false;
  let got = null, gone = false;
  for (let i = 0; i < 10; i++) {
    const g = await saves.getWithMetadata(rec.to.k, { type: "json" });
    if (!g || !g.data || !g.data.state) { gone = true; break; }
    const st = clone(g.data.state);
    G.fix(st);
    if (st.shipRes && st.shipRes[id]) break; // 已經收過
    core.settleTo(st, rec.arrAt);
    got = G.shipApply(st, rec.r, { id, from: rec.from.n });
    const w = await saves.setJSON(rec.to.k, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) break;
    got = null;
    await sleep(Math.random() * 6 * (i + 1));
  }
  // 商隊抵達不再寄飛鴿傳書(資源直接入庫)
  await W.casUpdate(battle, ikey(rec.to.o), (cur) => (!cur || !cur.a.some((x) => x.id === id) ? undefined : { a: cur.a.filter((x) => x.id !== id) }));
  await battle.delete(skey(id));
  return true;
}

// 結算跟這位玩家有關、已經抵達的運送(他是收貨方,或他自己的商隊已經到了)
async function resolveDueFor({ saves, world, battle, mail, uid, now }) {
  let n = 0;
  const inb = await battle.get(ikey(uid), { type: "json" });
  for (const e of ((inb && inb.a) || []).filter((x) => x.arrAt <= now).sort((a, b) => a.arrAt - b.arrAt)) {
    if (await resolve({ saves, battle, mail, id: e.id, now })) n++;
    else if (!(await battle.get(skey(e.id), { type: "json" }))) {
      await W.casUpdate(battle, ikey(uid), (cur) => (!cur || !cur.a.some((x) => x.id === e.id) ? undefined : { a: cur.a.filter((x) => x.id !== e.id) }));
    }
  }
  for (const key of await A.list(world, uid)) {
    const mine = await saves.get(key, { type: "json" });
    for (const s of (mine && mine.state && mine.state.ships) || []) {
      if (s.at && s.at <= now && (await battle.get(skey(s.id), { type: "json" })) && (await resolve({ saves, battle, mail, id: s.id, now }))) n++;
    }
  }
  return n;
}

module.exports = { register, resolve, resolveDueFor, skey, ikey };
