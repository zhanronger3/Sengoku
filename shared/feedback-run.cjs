// 意見箱:玩家送出意見,管理者在 admin 頁面看(並可直接送金幣)。
//   fb       → { a:[{id,t,u,n,x,y,s,b}] }  最新在前,最多 300 則
//   fbrl_<uid> → { ts:[...] }               最近一小時內的送出時間(每小時最多 3 則)
const W = require("./world-store.cjs");
const M = require("./mail-store.cjs");
const CATS = { bug: "遊戲錯誤", account: "帳號問題", suggest: "建議", report: "檢舉玩家", other: "其他" };
const SUBJ = 40, BODY = 500, PER_HOUR = 3, KEEP = 300, HOUR = 3600e3;
const clean = (s, n, multi) => String(s == null ? "" : s).replace(multi ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

async function submit({ world, user, body, pos, now }) {
  const s = clean(body && body.s, SUBJ), b = clean(body && body.b, BODY, true);
  if (!s) return { ok: false, msg: "請填寫主旨" };
  if (!b) return { ok: false, msg: "請填寫內容" };
  const c = Object.prototype.hasOwnProperty.call(CATS, body && body.c) ? body.c : "other", uid = user.id;
  let blocked = false;
  await W.casUpdate(world, "fbrl_" + uid, (cur) => {
    const ts = ((cur && cur.ts) || []).filter((t) => now - t < HOUR);
    if (ts.length >= PER_HOUR) { blocked = true; return undefined; }
    return { ts: [...ts, now] };
  });
  if (blocked) return { ok: false, msg: `每小時最多送出 ${PER_HOUR} 則意見,請稍後再試` };
  const entry = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, t: now, u: uid, n: W.nickOf(user), x: pos ? pos.x : null, y: pos ? pos.y : null, c, s, b };
  await W.casUpdate(world, "fb", (cur) => ({ a: [entry, ...((cur && cur.a) || [])].slice(0, KEEP) }));
  return { ok: true, msg: "意見已送出,謝謝你!" };
}
const list = async (world) => ((await world.get("fb", { type: "json" })) || { a: [] }).a;
const remove = (world, id) => W.casUpdate(world, "fb", (cur) => (cur && cur.a.some((e) => e.id === id) ? { a: cur.a.filter((e) => e.id !== id) } : undefined));
// 管理者回覆:以系統信寄到玩家收件箱,並在這則意見上記下已回覆
async function reply({ world, mail, id, text, now }) {
  const t = clean(text, 500, true);
  if (!t) return { ok: false, msg: "請填寫回覆內容" };
  const e = ((await world.get("fb", { type: "json" })) || { a: [] }).a.find((x) => x.id === id);
  if (!e) return { ok: false, msg: "找不到這則意見(可能已被刪除)" };
  await M.systemMail(mail, e.u, "客服回覆", `關於你送出的「${e.s}」:\n\n${t}`, now);
  await W.casUpdate(world, "fb", (cur) => (cur && cur.a.some((x) => x.id === id) ? { a: cur.a.map((x) => (x.id === id ? { ...x, r: { t: now, b: t } } : x)) } : undefined));
  return { ok: true, msg: "已回覆(玩家會在飛鴿傳書收到)" };
}
module.exports = { SUBJ, BODY, PER_HOUR, CATS, submit, list, remove, reply };
