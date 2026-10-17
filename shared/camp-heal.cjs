// 營寨狀態自我修復(靜靜修掉,不通知玩家)。
// 營寨本身(camp_<x>_<y>)是權威:城池存檔裡的「佔領紀錄 occ」與「駐守在外 out」如果營寨本身查不到對應,就清掉。
//   - occ[key] 但營寨不是這座城佔領的 → 刪 occ
//   - out 裡的營寨駐軍(k = camp:x,y)但營寨裡沒有這支駐軍(gid 對不上、或營寨已不屬於這個帳號)→ 刪掉,跟營寨失守時的處理一致
//   - 被刪掉的駐軍如果有武將,武將回城
// 在玩家載入遊戲時執行;取得跟出兵/召回相同的玩家鎖,避免和進行中的操作撞在一起。
const G = require("./game.cjs");
const A = require("./acct.cjs");
const pvp = require("./pvp-run.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const ckey = (x, y) => `camp_${x}_${y}`;
const parse = (k) => { const m = /^camp:(-?\d+),(-?\d+)$/.exec(String(k || "")); return m ? { x: +m[1], y: +m[2], key: m[1] + "," + m[2] } : null; };

// 算出這份存檔要修的項目(純函式);docs: { "x,y": 營寨文件或 null }
function plan(st, hk, owner, docs) {
  const stale = [], orph = [];
  const held = (d) => !!d && d.o === owner;
  for (const key of Object.keys(st.occ || {})) {
    const d = docs[key];
    if (!(held(d) && d.oc === hk)) stale.push(key);
  }
  for (const o of st.out || []) {
    const p = parse(o.k); if (!p) continue;
    const d = docs[p.key];
    if (!(held(d) && (d.gs || []).some((g) => g.gid === o.gid))) orph.push(o.gid);
  }
  return { stale, orph };
}
function apply(st, p) {
  for (const k of p.stale) delete st.occ[k];
  const gone = (st.out || []).filter((o) => p.orph.includes(o.gid));
  st.out = (st.out || []).filter((o) => !p.orph.includes(o.gid));
  if (gone.some((o) => o.h) && st.hero && st.hero.st === "away" && !(st.mv || []).some((m) => m.hero)) { st.hero.st = "home"; delete st.hero.gr; }
}

async function healCamps({ saves, world, owner, now }) {
  const keys = await A.list(world, owner), fixed = [];
  const refs = [];
  for (const hk of keys) {
    const g = await saves.get(hk, { type: "json" });
    const st = g && g.state;
    if (!st || !st.pos || !A.ownedBy(st, hk, owner)) continue;
    const ks = new Set([...Object.keys(st.occ || {}), ...(st.out || []).map((o) => (parse(o.k) || {}).key).filter(Boolean)]);
    if (ks.size) refs.push({ hk, ks });
  }
  if (!refs.length) return fixed;
  if (!(await pvp.lock(world, owner, now))) return fixed;
  try {
    const docs = {};
    for (const r of refs) for (const key of r.ks) if (!(key in docs)) { const [x, y] = key.split(",").map(Number); docs[key] = await world.get(ckey(x, y), { type: "json" }); }
    for (const r of refs) {
      for (let i = 0; i < 6; i++) {
        const g = await saves.getWithMetadata(r.hk, { type: "json" });
        if (!g || !g.data || !g.data.state) break;
        const st = clone(g.data.state); G.fix(st);
        const p = plan(st, r.hk, owner, docs);
        if (!p.stale.length && !p.orph.length) break;
        apply(st, p);
        const w = await saves.setJSON(r.hk, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
        if (!w || w.modified !== false) { fixed.push({ hk: r.hk, ...p }); break; }
        await new Promise((res) => setTimeout(res, Math.random() * 5 * (i + 1)));
      }
    }
  } finally { await pvp.unlock(world, owner).catch(() => {}); }
  return fixed;
}
module.exports = { healCamps, plan, apply };
