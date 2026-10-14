// 聊天頻道:公頻、盟頻、密頻。全部存在 world 儲存空間(跟排行榜一樣),不碰玩家存檔。
//   chat_pub        → { m:[{id,t,n,a,m}] }  最近 100 則
//   chat_a_<盟 id>  → { m:[{id,t,n,m}] }    最近 100 則
//   chatp_<uid>     → { m:[{id,t,f,to,fn,tn,m}] }  跟這位玩家有關的密語,最近 50 則(寄件人與收件人各存一份)
//   nk_<暱稱>        → { u:uid }             暱稱找人用(玩家的城池公開資料更新時順便登記,先到先得)
//   chrl_<uid>      → { t }                 上一次發言時間(每人每 3 秒一則)
const W = require("./world-store.cjs");

const MAXLEN = 100, GAP_MS = 3000, KEEP = { pub: 100, ally: 100, priv: 50 };
const nkKey = (n) => "nk_" + encodeURIComponent(String(n).trim().toLowerCase()).slice(0, 200);
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

async function allyOf(world, uid) {
  const m = await world.get("alm_" + uid, { type: "json" });
  return m && m.a ? m.a : null;
}

// 登記暱稱(公開資料更新時呼叫;已經有人用就不動)
async function registerNick(world, nick, uid) {
  if (!nick) return;
  try { await world.setJSON(nkKey(nick), { u: uid }, { onlyIfNew: true }); } catch {}
}

const after = (arr, s) => (s > 0 ? arr.filter((x) => x.t > s) : arr);

// GET:s = "公頻已看到的時間,盟頻,密頻"(只回傳比這個新的)
async function state({ world, owner, since }) {
  const [sp, sa, sv] = (since || "").split(",").map((x) => Number(x) || 0);
  const pub = await world.get("chat_pub", { type: "json" });
  const aid = await allyOf(world, owner);
  const al = aid ? await world.get("chat_a_" + aid, { type: "json" }) : null;
  const pr = await world.get("chatp_" + owner, { type: "json" });
  return { pub: after((pub && pub.m) || [], sp), ally: aid ? after((al && al.m) || [], sa) : null, hasAlly: !!aid, priv: after((pr && pr.m) || [], sv) };
}

async function push(world, key, msg, keep) {
  await W.casUpdate(world, key, (cur) => ({ m: [...((cur && cur.m) || []), msg].slice(-keep) }));
}

// POST { ch:"pub"|"ally"|"priv", to?, m }
async function send({ world, user, body, now }) {
  const owner = user.id, nick = W.nickOf(user), ch = body && body.ch;
  const text = clean(body && body.m, MAXLEN);
  if (!text) return { ok: false, msg: "請輸入內容" };
  if (!["pub", "ally", "priv"].includes(ch)) return { ok: false, msg: "頻道錯誤" };
  const rl = await world.get("chrl_" + owner, { type: "json" });
  if (rl && now - rl.t < GAP_MS) return { ok: false, msg: "說話太快了,每 3 秒只能發一則" };
  const id = `${now}-${Math.random().toString(36).slice(2, 7)}`;
  let msg;
  if (ch === "pub") {
    const tag = await W.tagOf(world, owner);
    msg = { id, t: now, n: nick, a: tag || "", m: text };
    await world.setJSON("chrl_" + owner, { t: now });
    await push(world, "chat_pub", msg, KEEP.pub);
  } else if (ch === "ally") {
    const aid = await allyOf(world, owner);
    if (!aid) return { ok: false, msg: "你還沒有加入聯盟,不能使用盟頻" };
    msg = { id, t: now, n: nick, m: text };
    await world.setJSON("chrl_" + owner, { t: now });
    await push(world, "chat_a_" + aid, msg, KEEP.ally);
  } else {
    const to = clean(body.to, 30);
    if (!to) return { ok: false, msg: "請輸入對方的暱稱" };
    const hit = await world.get(nkKey(to), { type: "json" });
    if (!hit || !hit.u) return { ok: false, msg: "找不到這位玩家(暱稱要完全一樣;對方需要登入過遊戲)" };
    if (hit.u === owner) return { ok: false, msg: "不能跟自己密語" };
    msg = { id, t: now, f: owner, to: hit.u, fn: nick, tn: to, m: text };
    await world.setJSON("chrl_" + owner, { t: now });
    await push(world, "chatp_" + owner, msg, KEEP.priv);
    await push(world, "chatp_" + hit.u, msg, KEEP.priv);
  }
  return { ok: true, msg: "" };
}

module.exports = { MAXLEN, GAP_MS, KEEP, nkKey, registerNick, state, send };
