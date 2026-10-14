// 世界資料:城池座標分配、地圖區塊、排行榜。
// 這裡的函式只依賴「Blobs 風格的 store」(get / getWithMetadata / setJSON / delete),
// 所以可以用假的 store 在本機完整測試。
const G = require("./game.cjs");

const CH = 10;       // 每個地圖區塊 10×10 格
const SPACING = 3;   // 玩家城池落在 (3i, 3j) 的格點上
const RANK_MAX = 200;
const MAX_SPAN = 40; // 一次最多查詢 40×40 格

// 第 n 位玩家在格點上的位置:從中心 (0,0) 一圈一圈往外螺旋
function slotLattice(n) {
  if (n === 0) return [0, 0];
  const r = Math.ceil((Math.sqrt(n + 1) - 1) / 2);
  const k = n - (2 * r - 1) ** 2;
  const side = Math.floor(k / (2 * r)), o = k % (2 * r);
  if (side === 0) return [r, -r + 1 + o];
  if (side === 1) return [r - 1 - o, r];
  if (side === 2) return [-r, r - 1 - o];
  return [-r + 1 + o, -r];
}
const slotPos = (n) => { const [i, j] = slotLattice(n); return { x: i * SPACING, y: j * SPACING }; };
const ckey = (cx, cy) => `c_${cx}_${cy}`;
const chunkOf = (x, y) => [Math.floor(x / CH), Math.floor(y / CH)];

// 暱稱:優先用帳號的名稱,沒有就用「玩家」加帳號尾碼(不洩漏信箱)
const cleanNick = (s) => String(s || "").replace(/[<>&"'`\u0000-\u001f]/g, "").trim().slice(0, 16);
const nickOf = (user) => cleanNick(user && user.name) || "玩家" + String((user && user.id) || "0000").slice(-4);

// 讀取-修改-寫入,版本不符就重試(兩個人同時改同一份資料不會互相蓋掉)
async function casUpdate(store, key, fn) {
  for (let i = 0; i < 40; i++) {
    const g = await store.getWithMetadata(key, { type: "json" });
    const cur = g ? g.data : null;
    const next = fn(cur);
    if (next === undefined) return cur;
    const w = await store.setJSON(key, next, g && g.etag ? { onlyIfMatch: g.etag } : { onlyIfNew: true });
    if (!w || w.modified !== false) return next;
    // 撞到別人同時寫入:隨機等一下再試,避免大家同時重試又撞在一起
    await new Promise((r) => setTimeout(r, Math.random() * 4 * (i + 1)));
  }
  throw new Error("contention");
}

// 取得(或分配)這位玩家的城池位置。同一位玩家永遠拿到同一個位置
async function allocate(world, uid) {
  const own = await world.get("owner_" + uid, { type: "json" });
  if (own) return own;
  let pos;
  const G = require("./game.cjs");
  for (let tries = 0; tries < 200; tries++) {
    await casUpdate(world, "alloc", (cur) => {
      const n = cur ? cur.n : 0;
      let pts = cur && cur.p ? cur.p.slice() : null;
      if (!pts) { pts = []; for (let i = 0; i < n; i++) { const q = slotPos(i); pts.push([q.x, q.y]); } }
      let pick = null;
      if (!pts.length) pick = { x: 0, y: 0 };
      else {
        // 隨機挑一位現有玩家當錨點,在他身邊 10 格內隨機找空位(離任何人至少 5 格、不踩營寨)
        for (let k = 0; k < 80 && !pick; k++) {
          const an = pts[Math.floor(Math.random() * pts.length)];
          const r = k < 40 ? 10 : 14;
          const x = an[0] + Math.floor(Math.random() * (2 * r + 1)) - r, y = an[1] + Math.floor(Math.random() * (2 * r + 1)) - r;
          if (G.npcAt(x, y) || (x === 4 && y === 1)) continue;
          if (pts.some((q) => Math.max(Math.abs(q[0] - x), Math.abs(q[1] - y)) < 5)) continue;
          pick = { x, y };
        }
        if (!pick) pick = slotPos(n);
      }
      pos = pick;
      pts.push([pick.x, pick.y]);
      return { n: n + 1, p: pts };
    });
    if (await findAt(world, pos.x, pos.y)) continue;
    if (await claimTile(world, pos.x, pos.y, uid)) break;
  }
  const w = await world.setJSON("owner_" + uid, pos, { onlyIfNew: true });
  if (w && w.modified === false) return await world.get("owner_" + uid, { type: "json" });
  return pos;
}

// 佔用一個格子(同一格只有一座城):已被別人佔走回傳 false;同一座城重複呼叫回傳 true
async function claimTile(world, x, y, ck) {
  const k = `t_${x}_${y}`;
  const w = await world.setJSON(k, { k: ck }, { onlyIfNew: true });
  if (!w || w.modified !== false) return true;
  const cur = await world.get(k, { type: "json" });
  return !!cur && cur.k === ck;
}

// 把城池資訊公開到地圖區塊與排行榜。rec: { x, y, n, f, p, b(開城時間,毫秒), o(擁有者帳號), m(1=本丸) }
async function publish(world, uid, rec) {
  const [cx, cy] = chunkOf(rec.x, rec.y);
  await casUpdate(world, ckey(cx, cy), (cur) => {
    const c = cur || { v: {} };
    c.v[uid] = rec;
    return c;
  });
  await casUpdate(world, "rank", (cur) => {
    const a = (cur && cur.a) || [];
    const row = { id: uid, ...rec };
    const i = a.findIndex((r) => r.id === uid);
    if (i >= 0) a[i] = row; else a.push(row);
    a.sort((u, v) => v.p - u.p);
    return { a: a.slice(0, RANK_MAX) };
  });
}

async function remove(world, uid) {
  const own = await world.get("owner_" + uid, { type: "json" });
  if (!own) return;
  const [cx, cy] = chunkOf(own.x, own.y);
  await casUpdate(world, ckey(cx, cy), (cur) => {
    if (!cur || !cur.v[uid]) return undefined;
    delete cur.v[uid];
    return cur;
  });
  await casUpdate(world, "rank", (cur) => {
    if (!cur || !cur.a.some((r) => r.id === uid)) return undefined;
    return { a: cur.a.filter((r) => r.id !== uid) };
  });
}

// 查詢方框內的城池(不含帳號 id)
async function queryWindow(world, x0, y0, x1, y1, viewer) {
  [x0, y0, x1, y1] = [x0, y0, x1, y1].map((n) => Math.floor(+n));
  if (![x0, y0, x1, y1].every(Number.isFinite)) return [];
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  x1 = Math.min(x1, x0 + MAX_SPAN);
  y1 = Math.min(y1, y0 + MAX_SPAN);
  const keys = [];
  for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++)
    for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) keys.push(ckey(cx, cy));
  const chunks = await Promise.all(keys.map((k) => world.get(k, { type: "json" })));
  const out = [];
  for (const c of chunks) {
    if (!c) continue;
    for (const [id, v] of Object.entries(c.v)) {
      if (v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1) out.push({ x: v.x, y: v.y, n: v.n, f: v.f, p: v.p, b: v.b || 0, a: v.a || "", mine: !!viewer && (v.o || id) === viewer, col: v.m === 0 ? 1 : 0 });
    }
  }
  return out;
}

// 方框內的營寨現況(全服共用的狀態:庫存、重生倒數、誰佔領)
// 把範圍內有玩家城池的格子記進 G.NOCAMP(營寨不蓋在城池上)
async function markCityTiles(world, x0, y0, x1, y1) {
  const seen = new Set();
  for (let cx = Math.floor(x0 / CH) - 0; cx <= Math.floor(x1 / CH); cx++) for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) seen.add(cx + "," + cy);
  await Promise.all([...seen].map(async (k) => {
    const [cx, cy] = k.split(",").map(Number), c = await world.get(ckey(cx, cy), { type: "json" });
    if (c && c.v) for (const v of Object.values(c.v)) G.NOCAMP.add(v.x + "," + v.y);
  }));
}
async function queryCamps(world, x0, y0, x1, y1, viewer, now) {
  [x0, y0, x1, y1] = [x0, y0, x1, y1].map((n) => Math.floor(+n));
  if (![x0, y0, x1, y1].every(Number.isFinite)) return [];
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  x1 = Math.min(x1, x0 + 30); y1 = Math.min(y1, y0 + 30);
  await markCityTiles(world, x0, y0, x1, y1);
  const cells = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const n = G.npcAt(x, y); if (n && !n.zg) cells.push([x, y, n]); }
  const docs = await Promise.all(cells.map(([x, y]) => world.get(`camp_${x}_${y}`, { type: "json" })));
  return cells.map(([x, y, n], i) => { const d = docs[i], v = G.campView(d, n, now); return { x, y, ...v, mine: !!(d && d.o && d.o === viewer) }; });
}

// 這個座標上是不是有玩家的城池
async function findAt(world, x, y) {
  [x, y] = [Math.floor(+x), Math.floor(+y)];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const [cx, cy] = chunkOf(x, y);
  const c = await world.get(ckey(cx, cy), { type: "json" });
  if (!c) return null;
  for (const [uid, v] of Object.entries(c.v)) if (v.x === x && v.y === y) return { uid, rec: v };
  return null;
}

async function topRank(world) {
  const r = await world.get("rank", { type: "json" });
  return ((r && r.a) || []).map(({ x, y, n, f, p, a, m, cn }) => ({ x, y, n, f, p, a: a || "", m: m === 0 ? 0 : 1, cn: cn || "" }));
}

// 存檔裡記錄「上次公開的資料」,威望變化夠大才重新公開,避免每個操作都寫世界資料
function stampPub(state, nick, now) {
  G.S = state;
  const p = G.prest();
  const o = state.pub;
  const pw = G.powers(), h = state.hero, hl = h ? h.lv : 0, hx = h ? h.xp : 0, ar = (state.art || []).length;
  const big = (a, b) => Math.abs(a - (b || 0)) >= Math.max(5, (b || 0) * 0.05);
  const need = !o || o.n !== nick || o.f !== state.fac || big(p, o.p) || big(pw.at, o.at) || big(pw.df, o.df) || o.hl !== hl || o.ar !== ar || now - o.t > 600000;
  if (need) state.pub = { p, t: now, n: nick, f: state.fac, at: pw.at, df: pw.df, hn: h ? h.n : "", hl, hx, ar };
  return need;
}
// 這位玩家(帳號)所屬聯盟的標籤,沒有聯盟回傳 ""
async function tagOf(world, owner) {
  const m = await world.get("alm_" + owner, { type: "json" });
  if (!m || !m.a) return "";
  const a = await world.get("ally_" + m.a, { type: "json" });
  return (a && a.tag) || "";
}
async function publishState(world, key, st, owner) {
  const o = st.own || owner || key;
  let a = ""; try { a = await tagOf(world, o); } catch {}
  try { await require("./chat-run.cjs").registerNick(world, st.pub.n, o); } catch {}
  await publish(world, key, { x: st.pos.x, y: st.pos.y, n: st.pub.n, f: st.pub.f, p: st.pub.p, b: st.born || 0, o, m: st.col ? 0 : 1, a, cn: st.col ? String(st.cname || "").slice(0, 20) : "" });
  try { await publishPlayer(world, o, key, st, a); } catch (e) { console.error("publishPlayer failed", e); }
}
// 英雄榜(玩家榜):同一位玩家所有城池合併。pl_<帳號> 記每座城的數字,prank 是全部玩家的合併結果
const PRANK_MAX = 300;
async function allyInfo(world, owner) {
  const m = await world.get("alm_" + owner, { type: "json" });
  if (!m || !m.a) return { tag: "", name: "" };
  const a = await world.get("ally_" + m.a, { type: "json" });
  return { tag: (a && a.tag) || "", name: (a && a.name) || "" };
}
// 聯盟變動後,更新英雄榜(玩家榜)裡這位玩家的聯盟
async function setPlayerAlly(world, owner) {
  const { tag, name } = await allyInfo(world, owner);
  await casUpdate(world, "prank", (cur) => {
    const r = cur && cur.a.find((x) => x.o === owner);
    return !r || ((r.a || "") === tag && (r.an || "") === name) ? undefined : (r.a = tag, r.an = name, cur);
  });
}
async function publishPlayer(world, owner, key, st, tag) {
  const A = require("./acct.cjs");
  const mine = new Set(await A.list(world, owner));
  const P = st.pub;
  const rk = await world.get("rank", { type: "json" }), old = (rk && rk.a) || [];
  const pl = await casUpdate(world, "pl_" + owner, (cur) => {
    const cs = { ...((cur && cur.cs) || {}) };
    for (const k of Object.keys(cs)) if (!mine.has(k)) delete cs[k];
    // 還沒用新格式公開過的城池:先用舊的排行榜資料湊數,這樣城池數不會少算
    for (const k of mine) if (!cs[k]) { const r = old.find((x) => x.id === k); if (r) cs[k] = { p: r.p || 0, at: 0, df: 0, ar: 0, hn: "", hl: 0, hx: 0, x: r.x, y: r.y, m: r.m ? 1 : 0, f: r.f, n: r.n }; }
    cs[key] = { p: P.p, at: P.at || 0, df: P.df || 0, ar: P.ar || 0, hn: P.hn || "", hl: P.hl || 0, hx: P.hx || 0, x: st.pos.x, y: st.pos.y, m: st.col ? 0 : 1, f: P.f, n: P.n };
    return { cs };
  });
  const cs = Object.values(pl.cs);
  const cap = cs.find((c) => c.m) || cs[0];
  let best = null;
  for (const c of cs) if (c.hl > 0 && (!best || c.hl > best.hl || (c.hl === best.hl && c.hx > best.hx))) best = c;
  const ai = await allyInfo(world, owner);
  const row = { o: owner, n: cap.n, f: cap.f, a: ai.tag || tag || "", an: ai.name, x: cap.x, y: cap.y, c: cs.length, p: cs.reduce((s, c) => s + c.p, 0), at: cs.reduce((s, c) => s + c.at, 0), df: cs.reduce((s, c) => s + c.df, 0), ar: cs.reduce((s, c) => s + c.ar, 0), hn: best ? best.hn : "", hl: best ? best.hl : 0, hx: best ? best.hx : 0 };
  await casUpdate(world, "prank", (cur) => {
    const a = ((cur && cur.a) || []).filter((r) => r.o !== owner);
    a.push(row);
    a.sort((u, v) => v.p - u.p);
    return { a: a.slice(0, PRANK_MAX) };
  });
}
async function removePlayer(world, owner) {
  try { await world.delete("pl_" + owner); } catch {}
  await casUpdate(world, "prank", (cur) => (cur && cur.a.some((r) => r.o === owner) ? { a: cur.a.filter((r) => r.o !== owner) } : undefined));
}
async function topPlayers(world) {
  const r = await world.get("prank", { type: "json" });
  return (r && r.a) || [];
}
// 只更新某座城池在地圖與排行榜上的聯盟標籤(加入、退出聯盟時用)
async function setTag(world, key, pos, tag) {
  if (!pos) return;
  const [cx, cy] = chunkOf(pos.x, pos.y);
  await casUpdate(world, ckey(cx, cy), (cur) => (!cur || !cur.v[key] || (cur.v[key].a || "") === tag ? undefined : (cur.v[key].a = tag, cur)));
  await casUpdate(world, "rank", (cur) => { const r = cur && cur.a.find((x) => x.id === key); return !r || (r.a || "") === tag ? undefined : (r.a = tag, cur); });
}

// 舊存檔(沒有座標)第一次被讀取時,替他分配座標並公開
async function ensureRegistered(saves, world, uid, nick, got, now) {
  if (!got || !got.data || !got.data.state || got.data.state.pos) return got;
  const pos = await allocate(world, uid);
  const data = { ...got.data, state: { ...got.data.state, pos } };
  stampPub(data.state, nick, now);
  const w = await saves.setJSON(uid, data, { onlyIfMatch: got.etag });
  if (w && w.modified === false) return await saves.getWithMetadata(uid, { type: "json" });
  await publishState(world, uid, data.state);
  return await saves.getWithMetadata(uid, { type: "json" });
}

module.exports = { markCityTiles, queryCamps, allyInfo, setPlayerAlly, publishPlayer, removePlayer, topPlayers, tagOf, setTag, claimTile, CH, SPACING, slotLattice, slotPos, ckey, chunkOf, cleanNick, nickOf, casUpdate, allocate, publish, remove, queryWindow, findAt, topRank, stampPub, publishState, ensureRegistered };
