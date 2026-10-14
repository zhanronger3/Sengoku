// 意見箱:玩家送出意見,管理者在 admin 頁面看(並可直接送金幣)。
//   fb       → { a:[{id,t,u,n,x,y,s,b}] }  最新在前,最多 300 則
//   fbrl_<uid> → { ts:[...] }               最近一小時內的送出時間(每小時最多 3 則)
const W = require("./world-store.cjs");
const SUBJ = 40, BODY = 500, PER_HOUR = 3, KEEP = 300, HOUR = 3600e3;
const clean = (s, n, multi) => String(s == null ? "" : s).replace(multi ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

async function submit({ world, user, body, pos, now }) {
  const s = clean(body && body.s, SUBJ), b = clean(body && body.b, BODY, true);
  if (!s) return { ok: false, msg: "請填寫主旨" };
  if (!b) return { ok: false, msg: "請填寫內容" };
  const uid = user.id;
  let blocked = false;
  await W.casUpdate(world, "fbrl_" + uid, (cur) => {
    const ts = ((cur && cur.ts) || []).filter((t) => now - t < HOUR);
    if (ts.length >= PER_HOUR) { blocked = true; return undefined; }
    return { ts: [...ts, now] };
  });
  if (blocked) return { ok: false, msg: `每小時最多送出 ${PER_HOUR} 則意見,請稍後再試` };
  const entry = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, t: now, u: uid, n: W.nickOf(user), x: pos ? pos.x : null, y: pos ? pos.y : null, s, b };
  await W.casUpdate(world, "fb", (cur) => ({ a: [entry, ...((cur && cur.a) || [])].slice(0, KEEP) }));
  return { ok: true, msg: "意見已送出,謝謝你!" };
}
const list = async (world) => ((await world.get("fb", { type: "json" })) || { a: [] }).a;
const remove = (world, id) => W.casUpdate(world, "fb", (cur) => (cur && cur.a.some((e) => e.id === id) ? { a: cur.a.filter((e) => e.id !== id) } : undefined));
module.exports = { SUBJ, BODY, PER_HOUR, submit, list, remove };
