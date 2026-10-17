// 帳號層級的任務資料:任務、每日任務、新手引導都以「整個帳號」計算。
// 條件:任何一座城達成就算;累計型(訓練人數、掠奪次數…)各城加總;已領取的紀錄與每日任務存在主城。
const G = require("./game.cjs");
const A = require("./acct.cjs");
const core = require("./server-core.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));

// cur: { key, state }(目前這座城已經結算過的狀態,可省略)
async function accOf({ saves, world, owner, cur, now }) {
  const keys = await A.list(world, owner);
  const states = [];
  let cap = null;
  await Promise.all(keys.map(async (k) => {
    let st = null;
    if (cur && cur.key === k && cur.state) st = clone(cur.state);
    else {
      const g = await saves.get(k, { type: "json" });
      if (g && g.state) { st = clone(g.state); if (!(k === owner || A.ownedBy(st, k, owner))) st = null; }
      if (st) { try { core.settle(st, now); } catch { st = null; } }
    }
    if (st) states.push({ k, st });
  }));
  const m = states.find((x) => x.k === owner);
  cap = m ? m.st : null;
  const bld = {}, stat = {};
  let zg = 0, best = null, bestKey = [-1, -1], heroLv = 0, occN = 0;
  const arts = new Set();
  for (const { st } of states) {
    for (const [b, l] of Object.entries(st.bld || {})) bld[b] = Math.max(bld[b] || 0, l || 0);
    for (const [k, v] of Object.entries(st.stat || {})) stat[k] = (stat[k] || 0) + (+v || 0);
    zg = Math.max(zg, st.zg || 0);
    if (st.hero && st.hero.lv) heroLv = Math.max(heroLv, st.hero.lv);
    occN += Object.keys(st.occ || {}).length;
    for (const id of st.art || []) arts.add(id);
    const f = st.fld || [], mn = f.length ? Math.min(...f) : 0, sm = f.reduce((a, b) => a + b, 0);
    if (!best || mn > bestKey[0] || (mn === bestKey[0] && sm > bestKey[1])) { best = f; bestKey = [mn, sm]; }
  }
  const qd = (cap && cap.qd) || [];
  const daily = cap ? G.virtDaily(cap, stat, now) : null;
  // 新的一天(或舊格式)第一次看到時,把今天的基準寫進主城,之後進度才不會一直重新起算(不動 rev,不會讓進行中的操作衝突)
  if (cap && daily && ((cap.daily || {}).d !== daily.d || (cap.daily || {}).v !== 2)) {
    try { await require("./world-store.cjs").casUpdate(saves, owner, (c) => (c && c.state && !(c.state.daily && c.state.daily.d === daily.d && c.state.daily.v === 2) ? { ...c, state: { ...c.state, daily } } : undefined)); } catch (e) { console.error("daily persist failed", e); }
  }
  return { fld: best || Array(18).fill(0), bld, stat, zg, qd, daily, heroLv, artN: arts.size, occN, cities: states.length };
}

module.exports = { accOf };
