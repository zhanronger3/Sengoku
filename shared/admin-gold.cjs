// 管理者發送金幣:只有持有 ADMIN_SECRET 的人能用。
// 純邏輯(不碰 Netlify 環境),所以可以用假的儲存空間完整測試。
const crypto = require("crypto");
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const M = require("./mail-store.cjs");
const FB = require("./feedback-run.cjs");
const A = require("./acct.cjs");

const MAX_AMOUNT = 1_000_000;
const LOG_KEY = "gold_log";
const LOG_MAX = 200;
const clone = (o) => JSON.parse(JSON.stringify(o));

// 固定時間比對,避免被一個字一個字猜出密碼
function checkSecret(provided, expected) {
  if (!expected || typeof expected !== "string" || expected.length < 8) return "unset";
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(expected);
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb) ? "ok" : "bad";
}

// 找到收件玩家:座標 (x,y)、暱稱 nick(只找得到排行榜前 200 名)、或帳號 uid
async function findTarget(world, q) {
  if (q.uid) {
    const pos = await world.get("owner_" + q.uid, { type: "json" });
    return pos ? { uid: String(q.uid), n: null, x: pos.x, y: pos.y } : null;
  }
  if (q.x != null && q.y != null && q.x !== "" && q.y !== "") {
    const hit = await W.findAt(world, q.x, q.y);
    return hit ? { uid: hit.rec.o || hit.uid, n: hit.rec.n, x: hit.rec.x, y: hit.rec.y } : null;
  }
  if (q.nick) {
    const rows = await world.get("rank", { type: "json" });
    const list = ((rows && rows.a) || []).filter((r) => r.n === String(q.nick).trim());
    if (list.length > 1) return { ambiguous: list.map((r) => `${r.n}(${r.x}|${r.y})`) };
    return list[0] ? { uid: list[0].id, n: list[0].n, x: list[0].x, y: list[0].y } : null;
  }
  return null;
}

// 所有玩家的帳號代號(每位玩家的主城都有一個 owner_<uid>,分城是 owner_c_…)
async function listPlayers(world) {
  const out = [];
  let cursor;
  for (let i = 0; i < 200; i++) {
    const r = await world.list(cursor ? { prefix: "owner_", cursor } : { prefix: "owner_" });
    for (const b of (r && r.blobs) || []) { const u = b.key.slice(6); if (u && !u.startsWith("c_")) out.push(u); }
    cursor = r && r.cursor;
    if (!cursor) break;
  }
  return out;
}


// ===== 武將修正(把暴衝的武將降回指定等級)=====
// 一位玩家的每座城各有一位武將。到等級 L 總共獲得 5×L 點屬性點(開局 5 點,每升一級 +5)。
// 降級後:已分配的點數(攻/防/速/載)總和超過新的可用點數就全部歸零重領;沒超過就只扣掉多的。
const heroEarned = (lv) => 5 * lv;
function planHero(h, level, xp) {
  const lv = Math.max(1, Math.min(G.HERO_MAXLV, level)), nx = Math.max(0, Math.min(xp, G.heroNeed(lv) - 1));
  const spent = (h.a || 0) + (h.d || 0) + (h.s || 0) + (h.c || 0), earned = heroEarned(lv);
  const reset = spent > earned;
  return { lv, xp: nx, a: reset ? 0 : h.a || 0, d: reset ? 0 : h.d || 0, s: reset ? 0 : h.s || 0, c: reset ? 0 : h.c || 0, pts: reset ? earned : earned - spent, reset };
}
const heroView = (h) => ({ n: h.n, lv: h.lv, xp: h.xp, pts: h.pts || 0, a: h.a || 0, d: h.d || 0, s: h.s || 0, c: h.c || 0, st: h.st });
// 列出玩家各城的武將;level 有給就試算(confirm=true 才真的寫入),只會降、不會升
async function heroFix({ saves, world, mail, target, level, xp, confirm, city, reason, now }) {
  const keys = await A.list(world, target.uid);
  const rows = [];
  for (const key of keys) {
    if (city && key !== city) continue;
    for (let i = 0; i < 12; i++) {
      const g = await saves.getWithMetadata(key, { type: "json" });
      if (!g || !g.data || !g.data.state) break;
      const st = clone(g.data.state), h = st.hero;
      if (!h) { rows.push({ key, hero: null }); break; }
      const row = { key, cname: st.cname || (st.col ? "分城" : "主城"), before: heroView(h) };
      if (level == null || h.lv <= level) { row.after = row.before; row.changed = false; rows.push(row); break; }
      const pl = planHero(h, level, xp || 0);
      row.after = { ...heroView(h), lv: pl.lv, xp: pl.xp, pts: pl.pts, a: pl.a, d: pl.d, s: pl.s, c: pl.c };
      row.reset = pl.reset; row.changed = true;
      if (!confirm) { rows.push(row); break; }
      h.lv = pl.lv; h.xp = pl.xp; h.pts = pl.pts; h.a = pl.a; h.d = pl.d; h.s = pl.s; h.c = pl.c;
      st.saved = now;
      const nick = (st.pub && st.pub.n) || target.n || "";
      W.stampPub(st, nick, now);
      const w = await saves.setJSON(key, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
      if (!w || w.modified !== false) {
        try { await W.publishState(world, key, st, target.uid); } catch {}
        try { await M.systemMail(mail, target.uid, "武將等級調整", `${h.n}的等級已調整為 ${pl.lv} 級。${pl.reset ? "已分配的屬性點全部退回,請到評定眾重新分配。" : "多出的屬性點已扣除。"}${reason ? `\n原因:${reason}` : ""}`, now); } catch {}
        row.written = true; rows.push(row); break;
      }
      await new Promise((r) => setTimeout(r, Math.random() * 5 * (i + 1)));
      if (i === 11) { row.written = false; row.err = "存檔正忙"; rows.push(row); }
    }
  }
  return rows;
}
async function addLog(world, entry) {
  await W.casUpdate(world, LOG_KEY, (cur) => ({ a: [entry, ...((cur && cur.a) || [])].slice(0, LOG_MAX) }));
}

// 把金幣加進玩家的存檔(版本比對 + 重試,玩家同時在玩也不會互相覆蓋)
async function grant({ saves, world, mail, target, amount, reason, now }) {
  for (let i = 0; i < 12; i++) {
    const g = await saves.getWithMetadata(target.uid, { type: "json" });
    if (!g || !g.data || !g.data.state) return { ok: false, msg: "這位玩家還沒開始遊戲" };
    const st = core.settle(clone(g.data.state), now);
    G.S = st;
    st.gold = (st.gold || 0) + amount;
    G.logm(`收到系統贈送的 ${amount} 金幣${reason ? `(${reason})` : ""}`);
    st.saved = now;
    const w = await saves.setJSON(target.uid, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) {
      await M.systemMail(mail, target.uid, `系統贈送 ${amount} 金幣`, `你收到了 ${amount} 金幣。${reason ? `\n原因:${reason}` : ""}`, now);
      return { ok: true, gold: Math.floor(st.gold) };
    }
    await new Promise((r) => setTimeout(r, Math.random() * 5 * (i + 1)));
  }
  return { ok: false, msg: "玩家的存檔正忙,請稍後再試" };
}

// method / secret / expected / body 由函式層傳進來;回傳 { status, body }
async function handle({ method, secret, expected, body, saves, world, mail, now }) {
  const auth = checkSecret(secret, expected);
  if (auth === "unset") return { status: 503, body: { ok: false, msg: "伺服器還沒設定 ADMIN_SECRET(至少 8 個字元),請先到 Netlify 設定環境變數並重新部署" } };
  if (auth !== "ok") return { status: 401, body: { ok: false, msg: "管理密碼不對" } };

  if (method === "GET") {
    const l = await world.get(LOG_KEY, { type: "json" });
    return { status: 200, body: { ok: true, log: (l && l.a) || [] } };
  }
  if (method !== "POST") return { status: 405, body: { ok: false, msg: "Method Not Allowed" } };

  if (body && body.t === "fblist") return { status: 200, body: { ok: true, list: await FB.list(world) } };
  if (body && body.t === "fbreply") {
    const r = await FB.reply({ world, mail, id: String(body.id || ""), text: body.text, now });
    return { status: r.ok ? 200 : 422, body: { ...r, list: await FB.list(world) } };
  }
  if (body && body.t === "fbdel") { await FB.remove(world, String(body.id || "")); return { status: 200, body: { ok: true, list: await FB.list(world) } }; }
  // 全服發信:寄一封系統信給每一位玩家(以公告編號去重,重送也不會重複收到)。留一份紀錄在 "bc"
  if (body && body.t === "bclist") { const b = await world.get("bc", { type: "json" }); return { status: 200, body: { ok: true, list: (b && b.a) || [] } }; }
  if (body && body.t === "bcsend") {
    const m = M.clean(body.m, 1000), subj = M.clean(body.s, 40) || "全服公告";
    if (!m) return { status: 422, body: { ok: false, msg: "請輸入信件內容" } };
    const id = `bc-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const uids = await listPlayers(world);
    let n = 0;
    for (let i = 0; i < uids.length; i += 20) await Promise.all(uids.slice(i, i + 20).map(async (u) => { try { await M.systemMail(mail, u, subj, m, now, { id, limit: 1000 }); n++; } catch {} }));
    const b = await W.casUpdate(world, "bc", (cur) => ({ a: [{ id, t: now, s: subj, m, n }, ...((cur && cur.a) || [])].slice(0, 30) }));
    return { status: 200, body: { ok: true, msg: `已寄給 ${n} 位玩家(共 ${uids.length} 位)`, list: b.a } };
  }
  if (body && (body.t === "herolist" || body.t === "herofix")) {
    const target = await findTarget(world, body);
    if (!target) return { status: 422, body: { ok: false, msg: "找不到這位玩家(暱稱只找得到排行榜前 200 名,找不到請改用座標)" } };
    if (target.ambiguous) return { status: 422, body: { ok: false, msg: "有同名的玩家,請改用座標:" + target.ambiguous.join("、") } };
    const fix = body.t === "herofix";
    const level = fix ? Math.floor(Number(body.level)) : null;
    if (fix && !(level >= 1 && level <= G.HERO_MAXLV)) return { status: 422, body: { ok: false, msg: `目標等級要是 1 到 ${G.HERO_MAXLV}` } };
    const confirm = fix && body.confirm === true;
    const rows = await heroFix({ saves, world, mail, target, level, xp: Math.max(0, Math.floor(Number(body.xp) || 0)), confirm, city: body.city ? String(body.city) : null, reason: M.clean(body.reason, 60), now });
    if (confirm) await addLog(world, { t: now, uid: target.uid, n: target.n, x: target.x, y: target.y, amount: 0, reason: `武將修正→${level} 級 ${rows.filter((r) => r.written).length} 座城` });
    return { status: 200, body: { ok: true, msg: `${target.n || target.uid}(${target.x}|${target.y}) ${fix ? (confirm ? "已寫入" : "試算(尚未寫入)") : "武將列表"}`, rows } };
  }
  const amount = Math.floor(Number(body && body.amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_AMOUNT) return { status: 422, body: { ok: false, msg: `金額要是 1 到 ${MAX_AMOUNT} 的整數` } };
  const reason = M.clean(body.reason, 60);
  const target = await findTarget(world, body || {});
  if (!target) return { status: 422, body: { ok: false, msg: "找不到這位玩家(暱稱只找得到排行榜前 200 名,找不到請改用座標)" } };
  if (target.ambiguous) return { status: 422, body: { ok: false, msg: "有同名的玩家,請改用座標:" + target.ambiguous.join("、") } };

  const r = await grant({ saves, world, mail, target, amount, reason, now });
  if (!r.ok) return { status: 422, body: r };
  const entry = { t: now, uid: target.uid, n: target.n, x: target.x, y: target.y, amount, reason };
  await addLog(world, entry);
  return { status: 200, body: { ok: true, msg: `已發送 ${amount} 金幣給 ${target.n || target.uid}(${target.x}|${target.y}),他現在有 ${r.gold} 金幣`, entry } };
}

module.exports = { MAX_AMOUNT, checkSecret, findTarget, grant, handle };
