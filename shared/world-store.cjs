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
  await casUpdate(world, "alloc", (cur) => {
    const n = cur ? cur.n : 0;
    pos = slotPos(n);
    return { n: n + 1 };
  });
  const w = await world.setJSON("owner_" + uid, pos, { onlyIfNew: true });
  if (w && w.modified === false) return await world.get("owner_" + uid, { type: "json" });
  return pos;
}

// 把城池資訊公開到地圖區塊與排行榜。rec: { x, y, n, f, p }
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
async function queryWindow(world, x0, y0, x1, y1) {
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
    for (const v of Object.values(c.v)) {
      if (v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1) out.push({ x: v.x, y: v.y, n: v.n, f: v.f, p: v.p });
    }
  }
  return out;
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
  return ((r && r.a) || []).map(({ x, y, n, f, p }) => ({ x, y, n, f, p }));
}

// 存檔裡記錄「上次公開的資料」,威望變化夠大才重新公開,避免每個操作都寫世界資料
function stampPub(state, nick, now) {
  G.S = state;
  const p = G.prest();
  const o = state.pub;
  const need = !o || o.n !== nick || o.f !== state.fac || Math.abs(p - o.p) >= Math.max(5, o.p * 0.05) || now - o.t > 600000;
  if (need) state.pub = { p, t: now, n: nick, f: state.fac };
  return need;
}
const publishState = (world, uid, st) => publish(world, uid, { x: st.pos.x, y: st.pos.y, n: st.pub.n, f: st.pub.f, p: st.pub.p });

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

module.exports = { CH, SPACING, slotLattice, slotPos, ckey, chunkOf, cleanNick, nickOf, casUpdate, allocate, publish, remove, queryWindow, findAt, topRank, stampPub, publishState, ensureRegistered };
