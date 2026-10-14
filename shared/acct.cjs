// 帳號的城池清單:一個帳號可以有多座城池,每座城池各有一份存檔。
//   本丸(主城)的存檔鍵就是帳號 id;分城/佔領的城池用 "c_" 開頭的鍵。
//   清單只是索引,「這座城是誰的」以存檔裡的 own 欄位為準(清單暫時不一致時,以存檔為準)。
const W = require("./world-store.cjs");
const key = (uid) => "acct_" + uid;
const isCityKey = (k) => typeof k === "string" && /^c_[0-9a-z_-]{4,60}$/i.test(k);

// 回傳 [本丸, ...其他城池] 的存檔鍵
async function list(world, uid) {
  const a = await world.get(key(uid), { type: "json" });
  return [uid, ...(((a && a.c) || []).filter((k) => k !== uid))];
}
// 加入/移除(可重複執行,結果相同)
async function add(world, uid, ck) {
  if (ck === uid) return;
  await W.casUpdate(world, key(uid), (cur) => {
    const c = (cur && cur.c) || [];
    return c.includes(ck) ? undefined : { ...(cur || {}), c: [...c, ck] };
  });
}
async function drop(world, uid, ck) {
  await W.casUpdate(world, key(uid), (cur) => {
    const c = (cur && cur.c) || [];
    return c.includes(ck) ? { ...(cur || {}), c: c.filter((k) => k !== ck) } : undefined;
  });
}
// 分城編號:依「開城順序」整個帳號統一排,用過的號碼不會重複使用
async function nextNo(world, uid) {
  const r = await W.casUpdate(world, key(uid), (cur) => {
    const c = (cur && cur.c) || [];
    return { ...(cur || {}), c, n: ((cur && cur.n) != null ? cur.n : c.length) + 1 };
  });
  return r.n;
}
// 這座城是否屬於這位玩家(以存檔為準)
const ownedBy = (state, ck, uid) => !!state && (state.own || ck) === uid;

module.exports = { nextNo, key, isCityKey, list, add, drop, ownedBy };
