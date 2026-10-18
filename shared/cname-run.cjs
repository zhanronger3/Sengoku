// 玩家自訂城池名稱(主城、分城都可以)。
// 規則:2~8 個字(漢字、假名、英數字);每座城 24 小時(現實時間)只能改一次;
//       不能含髒話或保留字;不能跟別的玩家暱稱相同(或包含他人 3 字以上的暱稱);
//       全服用過的名字不能再用(包含自己以前用過的)。
// 名字佔用記在 world 的 cnm_<名字的十六進位>,用 onlyIfNew 保證同時搶同一個名字只有一個人成功。
const world = require("./world-store.cjs");
const A = require("./acct.cjs");

const COOLDOWN = 24 * 3600 * 1000;
const MIN = 2, MAX = 8;
const OK_CHARS = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々A-Za-z0-9]+$/u;
// 髒話與不適合當城名的字(簡繁、常見諧音與英文;名單不可能涵蓋所有說法,有漏的再補)
const BAD = [
  "幹你", "干你", "操你", "肏", "靠北", "靠邀", "雞掰", "机掰", "機掰", "雞巴", "鸡巴", "屌", "他媽", "他妈", "媽的", "妈的", "三小", "白癡", "白痴", "智障", "腦殘", "脑残", "賤人", "贱人", "婊", "幹恁", "干恁", "垃圾", "去死", "死全家", "王八", "混蛋", "畜生", "狗屎", "傻逼", "傻屄", "屄", "尻", "強姦", "强奸", "性愛", "做愛", "約砲", "援交", "色情", "賣淫", "毒品", "自殺", "希特勒", "納粹", "纳粹",
  "fuck", "shit", "bitch", "cunt", "pussy", "nigger", "nigga", "asshole", "slut", "whore", "porn", "hitler",
  // 假冒官方
  "系統", "系统", "管理", "客服", "官方", "站長", "站长", "營運", "运营", "admin", "official", "moderator",
];
// 短的英文字容易誤傷(Essex、Dickson、grape),只有整個名字剛好是這個字才擋
const EXACT = new Set(["gm", "sex", "dick", "rape", "nazi"]);
const norm = (s) => String(s || "").normalize("NFKC").trim();
const keyOf = (s) => norm(s).toLowerCase();
const ck = (s) => "cnm_" + Buffer.from(keyOf(s), "utf8").toString("hex");

// 回傳 {ok:true,name} 或 {ok:false,msg}(只檢查名字本身的規則,不查全服)
function check(raw) {
  if (typeof raw !== "string") return { ok: false, msg: "請輸入城名" };
  const s = norm(raw);
  if (!s) return { ok: false, msg: "請輸入城名" };
  const n = [...s].length;
  if (n < MIN || n > MAX) return { ok: false, msg: `城名要 ${MIN} 到 ${MAX} 個字(目前 ${n} 個字)` };
  if (!OK_CHARS.test(s)) return { ok: false, msg: "城名只能用中文、日文假名、英文和數字(不能有空格或符號)" };
  const k = keyOf(s).replace(/[0-9]/g, "");
  if (EXACT.has(k)) return { ok: false, msg: "這個名稱不能使用,請換一個" };
  for (const w of BAD) if (k.includes(w.toLowerCase())) return { ok: false, msg: "這個名稱不能使用,請換一個" };
  return { ok: true, name: s };
}

async function rename({ saves, world: wstore, owner, ckey, name, nick, now }) {
  const g = await saves.getWithMetadata(ckey, { type: "json" });
  if (!g || !g.data || !g.data.state || !A.ownedBy(g.data.state, ckey, owner)) return { ok: false, msg: "這座城池已經不屬於你了" };
  const st0 = g.data.state;
  const c = check(name);
  if (!c.ok) return c;
  const s = c.name;
  if (s === (st0.cname || "")) return { ok: false, msg: "跟目前的城名一樣" };
  const wait = (st0.cnAt || 0) + COOLDOWN - now;
  if (st0.cnAt && wait > 0) {
    const mins = Math.max(1, Math.ceil(wait / 60000)), h = Math.floor(mins / 60), m = mins % 60;
    return { ok: false, msg: `這座城 24 小時只能改一次名,還要等 ${[h > 0 ? h + " 小時" : "", m > 0 || h === 0 ? m + " 分鐘" : ""].filter(Boolean).join(" ")}` };
  }
  // 冒用別人的暱稱(排行榜上的玩家;自己的暱稱可以用)
  const me = keyOf(nick), ks = keyOf(s);
  let rows = [];
  try { rows = await world.topPlayers(wstore); } catch {}
  for (const r of rows) {
    if (!r || r.o === owner) continue;
    const rn = keyOf(r.n);
    if (!rn || rn === me) continue;
    if (rn === ks || ([...rn].length >= 3 && ks.includes(rn))) return { ok: false, msg: "這個名稱跟其他玩家的暱稱太像,請換一個" };
  }
  // 全服不能重複(用過的都算,包含自己以前用過的)
  const claim = await wstore.setJSON(ck(s), { o: owner, k: ckey, t: now }, { onlyIfNew: true });
  if (claim && claim.modified === false) return { ok: false, msg: "這個名稱已經有人用過了,請換一個" };
  for (let i = 0; i < 6; i++) {
    const cur = i === 0 ? g : await saves.getWithMetadata(ckey, { type: "json" });
    if (!cur || !cur.data || !cur.data.state || !A.ownedBy(cur.data.state, ckey, owner)) { await wstore.delete(ck(s)).catch(() => {}); return { ok: false, msg: "這座城池已經不屬於你了" }; }
    if (i > 0 && cur.data.state.cnAt && now - cur.data.state.cnAt < COOLDOWN) { await wstore.delete(ck(s)).catch(() => {}); return { ok: false, msg: "這座城剛剛已經改過名了" }; }
    const st = JSON.parse(JSON.stringify(cur.data.state));
    st.cname = s; st.cnAt = now;
    const w = await saves.setJSON(ckey, { ...cur.data, state: st, rev: (cur.data.rev || 0) + 1, updatedAt: cur.data.updatedAt }, { onlyIfMatch: cur.etag });
    if (!w || w.modified !== false) {
      try { world.stampPub(st, nick, now); await world.publishState(wstore, ckey, st, owner); } catch {}
      return { ok: true, msg: `城名已改為「${s}」` };
    }
  }
  await wstore.delete(ck(s)).catch(() => {});
  return { ok: false, msg: "同步衝突,請再試一次" };
}

module.exports = { rename, check, COOLDOWN, MIN, MAX };
