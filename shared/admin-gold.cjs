// 管理者發送金幣:只有持有 ADMIN_SECRET 的人能用。
// 純邏輯(不碰 Netlify 環境),所以可以用假的儲存空間完整測試。
const crypto = require("crypto");
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const M = require("./mail-store.cjs");

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
