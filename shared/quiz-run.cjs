// 每日一題:每天一題四選一的戰國史問題,每個帳號當天只能答一次,答對得金幣。
//   world: qz_<uid> → { d: 日期, p: 選的選項, ok: 是否答對, t: 時間 }
// 題目與答案都在伺服器判定,前端拿不到答案(答完才會回傳解說)。
const W = require("./world-store.cjs");
const Z = require("./quiz-data.cjs");
const QUIZ_GOLD = 5;

function view(t, rec) {
  const done = !!(rec && rec.d === t.day);
  const v = { ok: true, day: t.day, q: t.q, opts: t.opts, gold: QUIZ_GOLD, done };
  if (done) Object.assign(v, { pick: rec.p, ans: t.ans, right: !!rec.ok, exp: t.exp });
  return v;
}
async function state({ world, uid, now }) {
  return view(Z.today(now), await world.get("qz_" + uid, { type: "json" }));
}
async function answer({ world, saves, uid, pick, now }) {
  const t = Z.today(now);
  pick = Math.floor(Number(pick));
  if (!(pick >= 0 && pick < t.opts.length)) return { ok: false, msg: "請選一個選項" };
  const cap = await saves.get(uid, { type: "json" });
  if (!cap || !cap.state) return { ok: false, msg: "還沒開始遊戲,先建立你的城池吧" };
  let first = false;
  const rec = await W.casUpdate(world, "qz_" + uid, (cur) => {
    if (cur && cur.d === t.day) return undefined;
    first = true;
    return { d: t.day, p: pick, ok: pick === t.ans, t: now };
  });
  const v = view(t, rec);
  if (!first) return { ...v, ok: false, msg: "今天已經答過了,明天再來!" };
  if (rec.ok) {
    await W.casUpdate(saves, uid, (c) => (c && c.state ? { ...c, rev: (c.rev || 0) + 1, state: { ...c.state, gold: (c.state.gold || 0) + QUIZ_GOLD } } : undefined));
    return { ...v, msg: `答對了!獲得 ${QUIZ_GOLD} 金幣。` };
  }
  return { ...v, msg: "答錯了,明天再挑戰!" };
}
module.exports = { QUIZ_GOLD, state, answer };
