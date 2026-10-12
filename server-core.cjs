// 伺服器端的存檔處理(純函式,不碰網路與資料庫,方便測試)
const G = require("./game.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const MAX_OFFLINE_SEC = 7 * 86400; // 離線補算上限:7 天

// 依真實經過的時間,把存檔補算到「現在」
function settle(state, now) {
  G.fix(state);
  G.S = state;
  const real = Math.max(0, (now - (state.saved || now)) / 1000);
  // 離開超過 5 分鐘:期間的山賊來襲不處理,避免玩家回來發現被洗劫
  G.adv(Math.min(real, MAX_OFFLINE_SEC) * G.SPEED, { quiet: real > 300 });
  state.saved = now;
  return state;
}

function view(stored, now) {
  if (!stored) return { ok: true, state: null, rev: 0, now };
  return { ok: true, state: settle(clone(stored.state), now), rev: stored.rev, now };
}

// stored: { state, rev } 或 null;body: { action, rev }
// 回傳 { status, body, store? },store 為要寫入的新內容,或 "delete"
function act(stored, body, now, ctx) {
  const a = body && body.action;
  if (!a || typeof a.t !== "string") return { status: 400, body: { ok: false, msg: "無效的操作" } };
  const rev = stored ? stored.rev : 0;
  if ((body.rev || 0) !== rev) {
    return { status: 409, body: { ...view(stored, now), ok: false, msg: "已同步伺服器狀態" } };
  }
  if (a.t === "reset") return { status: 200, body: { ok: true, state: null, rev: 0, now }, store: "delete" };
  if (a.t === "init") {
    if (stored) return { status: 409, body: { ...view(stored, now), ok: false, msg: "已有進行中的遊戲" } };
    if (!["wei", "shu", "wu"].includes(a.fac)) return { status: 400, body: { ok: false, msg: "勢力錯誤" } };
    const st = G.init(a.fac, ctx && ctx.pos);
    st.saved = now;
    return { status: 200, body: { ok: true, state: st, rev: 1, now }, store: { state: st, rev: 1, updatedAt: now } };
  }
  if (!stored) return { status: 400, body: { ok: false, msg: "尚未開始遊戲" } };
  const st = settle(clone(stored.state), now);
  const r = G.perform(a);
  if (!r.ok) return { status: 422, body: { ok: false, msg: r.msg, state: st, rev, now } };
  const next = rev + 1;
  return { status: 200, body: { ok: true, msg: r.msg, state: st, rev: next, now }, store: { state: st, rev: next, updatedAt: now } };
}

module.exports = { settle, view, act };
