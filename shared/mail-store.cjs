// 飛鴿傳書:玩家之間的信件。每位玩家一個收件匣、一個寄件匣(Blobs),都限制數量。
const W = require("./world-store.cjs");

const LIMITS = { inbox: 60, sent: 40, subject: 40, body: 1000, windowMs: 10 * 60 * 1000, rateMax: 10 };
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

async function listMail(mail, uid) {
  const [i, s] = await Promise.all([mail.get("inbox_" + uid, { type: "json" }), mail.get("sent_" + uid, { type: "json" })]);
  const inbox = (i && i.m) || [], sent = (s && s.m) || [];
  return { inbox, sent, unread: inbox.filter((m) => !m.r).length };
}

async function unreadCount(mail, uid) {
  const i = await mail.get("inbox_" + uid, { type: "json" });
  return ((i && i.m) || []).filter((m) => !m.r).length;
}

// 收件人用「城池座標」指定;回傳 { ok, msg }
async function send(mail, world, { uid, nick, pos, tx, ty, subject, body, now }) {
  tx = Math.floor(+tx); ty = Math.floor(+ty);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return { ok: false, msg: "請輸入收件人的城池座標" };
  const s = clean(subject, LIMITS.subject) || "(無主旨)";
  const b = clean(body, LIMITS.body);
  if (!b) return { ok: false, msg: "信件內容不能是空的" };
  const hit = await W.findAt(world, tx, ty);
  if (!hit) return { ok: false, msg: "該座標沒有玩家的城池" };
  if (hit.uid === uid) return { ok: false, msg: "不能寄給自己" };
  const sentBox = await mail.get("sent_" + uid, { type: "json" });
  const recent = ((sentBox && sentBox.m) || []).filter((m) => now - m.t < LIMITS.windowMs).length;
  if (recent >= LIMITS.rateMax) return { ok: false, msg: `寄信太頻繁了(每 10 分鐘最多 ${LIMITS.rateMax} 封),請稍後再試` };
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const msg = { id, t: now, from: { n: nick, x: pos.x, y: pos.y }, to: { n: hit.rec.n, x: tx, y: ty }, s, b, r: false };
  await W.casUpdate(mail, "inbox_" + hit.uid, (cur) => ({ m: [msg, ...((cur && cur.m) || [])].slice(0, LIMITS.inbox) }));
  await W.casUpdate(mail, "sent_" + uid, (cur) => ({ m: [{ ...msg, r: true }, ...((cur && cur.m) || [])].slice(0, LIMITS.sent) }));
  return { ok: true, msg: `信已寄給 ${hit.rec.n}` };
}

// 系統信:不經過收件人查詢(寄件人沒有座標)
async function systemMail(mail, uid, subject, body, now) {
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const msg = { id, t: now, from: { n: "系統", x: null, y: null }, to: { n: "", x: null, y: null }, s: clean(subject, LIMITS.subject) || "(系統通知)", b: clean(body, LIMITS.body), r: false, sys: true };
  await W.casUpdate(mail, "inbox_" + uid, (cur) => ({ m: [msg, ...((cur && cur.m) || [])].slice(0, LIMITS.inbox) }));
}

async function markRead(mail, uid, id) {
  await W.casUpdate(mail, "inbox_" + uid, (cur) => {
    if (!cur) return undefined;
    const m = cur.m.find((x) => x.id === id);
    if (!m || m.r) return undefined;
    m.r = true;
    return cur;
  });
}

async function remove(mail, uid, box, id) {
  if (box !== "inbox" && box !== "sent") return;
  await W.casUpdate(mail, box + "_" + uid, (cur) => {
    if (!cur || !cur.m.some((x) => x.id === id)) return undefined;
    return { m: cur.m.filter((x) => x.id !== id) };
  });
}

module.exports = { LIMITS, clean, listMail, unreadCount, send, systemMail, markRead, remove };
