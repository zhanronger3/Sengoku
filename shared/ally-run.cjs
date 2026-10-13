// 奏者番(聯盟):建立、邀請、入盟、退盟、踢人、解散、盟內信件。
//   ally_<id>   聯盟資料 { id, tag, name, lead, m:[{o,n,t}], inv:[{o,n,t}], t }
//   alm_<uid>   玩家(帳號)加入的聯盟 { a }          (用 onlyIfNew 保證一個人只能加入一個)
//   ainv_<uid>  玩家收到的邀請 { a:[{id,tag,name,by,t}] }
//   atag_<小寫標籤> { id }                           (標籤不能重複)
const W = require("./world-store.cjs");
const M = require("./mail-store.cjs");
const A = require("./acct.cjs");
const { cas } = { cas: W.casUpdate };

const CREATE_LV = 3, JOIN_LV = 1, INV_MAX = 20;
const capOf = (leadLv) => 2 * Math.max(3, leadLv);
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>&"'`]/g, "").trim().slice(0, n);
const okTag = (t) => /^[A-Za-z0-9一-鿿]{2,4}$/.test(t);

// 聯盟變動後,更新這位玩家所有城池在地圖/排行榜上的聯盟標籤
async function retag(world, owner) {
  try {
    const tag = await W.tagOf(world, owner);
    for (const k of await A.list(world, owner)) await W.setTag(world, k, await world.get("owner_" + k, { type: "json" }), tag);
  } catch (e) { console.error("retag failed", e); }
}
// 這位玩家所有城池裡最高的奏者番等級
async function embLevel(saves, world, owner) {
  let lv = 0;
  for (const k of await A.list(world, owner)) {
    const g = await saves.get(k, { type: "json" });
    const st = g && g.state;
    if (!st || !A.ownedBy(st, k, owner)) continue;
    for (const x of st.slots || []) if (x && x.b === "emb" && x.l >= 1) lv = Math.max(lv, x.l);
  }
  return lv;
}
const getAlly = async (world, id) => (id ? await world.get("ally_" + id, { type: "json" }) : null);
const myAllyId = async (world, owner) => { const m = await world.get("alm_" + owner, { type: "json" }); return m && m.a; };

// 目前狀態(給畫面用)
async function state({ saves, world, owner }) {
  const lv = await embLevel(saves, world, owner);
  const id = await myAllyId(world, owner);
  let ally = await getAlly(world, id);
  if (id && !ally) { await world.delete("alm_" + owner); ally = null; } // 聯盟已不存在:清掉殘留
  const inv = await world.get("ainv_" + owner, { type: "json" });
  let out = null;
  if (ally) {
    const leadLv = ally.lead === owner ? lv : await embLevel(saves, world, ally.lead);
    out = { id: ally.id, tag: ally.tag, name: ally.name, lead: ally.lead === owner, cap: capOf(leadLv), t: ally.t,
      m: ally.m.map((x) => ({ o: x.o === owner ? "me" : x.o, n: x.n, lead: x.o === ally.lead, me: x.o === owner })),
      inv: ally.lead === owner ? ally.inv.map((x) => ({ o: x.o, n: x.n })) : [] };
  }
  return { lv, ally: out, invites: ((inv && inv.a) || []).map((x) => ({ id: x.id, tag: x.tag, name: x.name, by: x.by })), need: { create: CREATE_LV, join: JOIN_LV } };
}

async function act({ saves, world, mail, user, body, now }) {
  const owner = user.id, nick = W.nickOf(user), a = body.action || {};
  const lv = await embLevel(saves, world, owner);
  const myId = await myAllyId(world, owner);
  let ally = await getAlly(world, myId);
  if (myId && !ally) { await world.delete("alm_" + owner); ally = null; }
  const bad = (msg) => ({ ok: false, msg });
  const done = async (msg) => ({ ok: true, msg, ...(await state({ saves, world, owner })) });

  switch (a.t) {
    case "create": {
      if (ally) return bad("你已經在聯盟裡了");
      if (lv < CREATE_LV) return bad(`奏者番要 ${CREATE_LV} 級才能建立聯盟(目前 ${lv} 級)`);
      const tag = clean(a.tag, 8), name = clean(a.name, 16);
      if (!okTag(tag)) return bad("聯盟標籤要 2~4 個字(中文、英文或數字)");
      if (name.length < 2) return bad("聯盟名稱至少 2 個字");
      const id = `a${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const tk = "atag_" + tag.toLowerCase();
      const t1 = await world.setJSON(tk, { id }, { onlyIfNew: true });
      if (t1 && t1.modified === false) return bad("這個標籤已經被使用了");
      const t2 = await world.setJSON("alm_" + owner, { a: id }, { onlyIfNew: true });
      if (t2 && t2.modified === false) { await world.delete(tk); return bad("你已經在聯盟裡了"); }
      await world.setJSON("ally_" + id, { id, tag, name, lead: owner, m: [{ o: owner, n: nick, t: now }], inv: [], t: now }, { onlyIfNew: true });
      await retag(world, owner);
      return done(`聯盟「${name}」[${tag}] 成立了`);
    }
    case "invite": {
      if (!ally || ally.lead !== owner) return bad("只有盟主可以邀請");
      const x = Math.floor(+a.x), y = Math.floor(+a.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return bad("請輸入對方城池的座標");
      const hit = await W.findAt(world, x, y);
      if (!hit) return bad("該座標沒有玩家的城池");
      const o = hit.rec.o || hit.uid;
      if (o === owner) return bad("不能邀請自己");
      if (ally.m.some((z) => z.o === o)) return bad("對方已經在聯盟裡了");
      if (ally.inv.some((z) => z.o === o)) return bad("已經邀請過他了");
      if (ally.inv.length >= INV_MAX) return bad(`同時最多 ${INV_MAX} 筆邀請`);
      const leadCap = capOf(lv);
      if (ally.m.length >= leadCap) return bad(`聯盟人數已滿(${leadCap} 人;奏者番等級越高上限越高)`);
      const nn = hit.rec.n;
      await cas(world, "ally_" + ally.id, (c) => (c && !c.inv.some((z) => z.o === o) ? { ...c, inv: [...c.inv, { o, n: nn, t: now }] } : undefined));
      await cas(world, "ainv_" + o, (c) => ({ a: [...((c && c.a) || []).filter((z) => z.id !== ally.id), { id: ally.id, tag: ally.tag, name: ally.name, by: nick, t: now }].slice(-10) }));
      await M.systemMail(mail, o, "【聯盟】收到入盟邀請", `${nick} 邀請你加入聯盟「${ally.name}」[${ally.tag}]。\n到奏者番(需要 ${JOIN_LV} 級)的頁面就可以接受或拒絕。`, now);
      return done(`已邀請 ${nn}`);
    }
    case "uninvite": {
      if (!ally || ally.lead !== owner) return bad("只有盟主可以取消邀請");
      const o = String(a.o || "");
      await cas(world, "ally_" + ally.id, (c) => (c && c.inv.some((z) => z.o === o) ? { ...c, inv: c.inv.filter((z) => z.o !== o) } : undefined));
      await cas(world, "ainv_" + o, (c) => (c && c.a.some((z) => z.id === ally.id) ? { a: c.a.filter((z) => z.id !== ally.id) } : undefined));
      return done("已取消邀請");
    }
    case "decline": {
      const id = String(a.id || "");
      await cas(world, "ainv_" + owner, (c) => (c && c.a.some((z) => z.id === id) ? { a: c.a.filter((z) => z.id !== id) } : undefined));
      await cas(world, "ally_" + id, (c) => (c && c.inv.some((z) => z.o === owner) ? { ...c, inv: c.inv.filter((z) => z.o !== owner) } : undefined));
      return done("已拒絕邀請");
    }
    case "accept": {
      if (ally) return bad("你已經在聯盟裡了,要先退出才能加入別的聯盟");
      if (lv < JOIN_LV) return bad(`奏者番要 ${JOIN_LV} 級才能加入聯盟`);
      const id = String(a.id || "");
      const invs = await world.get("ainv_" + owner, { type: "json" });
      if (!invs || !invs.a.some((z) => z.id === id)) return bad("找不到這筆邀請(可能已被取消)");
      const target = await getAlly(world, id);
      if (!target) { await cas(world, "ainv_" + owner, (c) => ({ a: ((c && c.a) || []).filter((z) => z.id !== id) })); return bad("這個聯盟已經解散了"); }
      const cap = capOf(await embLevel(saves, world, target.lead));
      const t2 = await world.setJSON("alm_" + owner, { a: id }, { onlyIfNew: true });
      if (t2 && t2.modified === false) return bad("你已經在聯盟裡了");
      let joined = false, full = false;
      await cas(world, "ally_" + id, (c) => {
        joined = false; full = false;
        if (!c) return undefined;
        if (c.m.some((z) => z.o === owner)) { joined = true; return undefined; }
        if (c.m.length >= cap) { full = true; return undefined; }
        joined = true;
        return { ...c, m: [...c.m, { o: owner, n: nick, t: now }], inv: c.inv.filter((z) => z.o !== owner) };
      });
      if (!joined) { await world.delete("alm_" + owner); return bad(full ? "聯盟人數已滿" : "加入失敗"); }
      await cas(world, "ainv_" + owner, (c) => ({ a: ((c && c.a) || []).filter((z) => z.id !== id) }));
      await M.systemMail(mail, target.lead, "【聯盟】新成員加入", `${nick} 加入了聯盟「${target.name}」。`, now);
      await retag(world, owner);
      return done(`已加入聯盟「${target.name}」`);
    }
    case "leave": {
      if (!ally) return bad("你還沒有加入聯盟");
      if (ally.lead === owner && ally.m.length > 1) {
        const next = ally.m.filter((z) => z.o !== owner).sort((p, q) => p.t - q.t)[0];
        await cas(world, "ally_" + ally.id, (c) => (c ? { ...c, lead: next.o, m: c.m.filter((z) => z.o !== owner) } : undefined));
        await M.systemMail(mail, next.o, "【聯盟】你成為盟主", `原盟主 ${nick} 離開了聯盟「${ally.name}」,你是資歷最久的成員,現在由你擔任盟主。`, now);
      } else if (ally.lead === owner) {
        await disband(world, ally);
      } else {
        await cas(world, "ally_" + ally.id, (c) => (c ? { ...c, m: c.m.filter((z) => z.o !== owner) } : undefined));
      }
      await world.delete("alm_" + owner);
      await retag(world, owner);
      return done("已退出聯盟");
    }
    case "kick": {
      if (!ally || ally.lead !== owner) return bad("只有盟主可以踢人");
      const o = String(a.o || "");
      if (o === owner) return bad("不能踢自己(要離開請按「退出聯盟」)");
      if (!ally.m.some((z) => z.o === o)) return bad("他已經不在聯盟裡了");
      await cas(world, "ally_" + ally.id, (c) => (c ? { ...c, m: c.m.filter((z) => z.o !== o) } : undefined));
      await world.delete("alm_" + o);
      await retag(world, o);
      await M.systemMail(mail, o, "【聯盟】被移出聯盟", `你被盟主移出了聯盟「${ally.name}」。`, now);
      return done("已移出成員");
    }
    case "disband": {
      if (!ally || ally.lead !== owner) return bad("只有盟主可以解散聯盟");
      await disband(world, ally, mail, now);
      return done("聯盟已解散");
    }
    case "msg": {
      if (!ally) return bad("你還沒有加入聯盟");
      const s = clean(a.s, 40) || "(盟內通知)", b = clean(a.b, 800);
      if (!b) return bad("內容不能是空的");
      const rl = await world.get("almsg_" + owner, { type: "json" });
      const recent = ((rl && rl.t) || []).filter((t) => now - t < 600000);
      if (recent.length >= 5) return bad("盟內發信太頻繁了(每 10 分鐘最多 5 封)");
      await world.setJSON("almsg_" + owner, { t: [...recent, now] });
      const others = ally.m.filter((z) => z.o !== owner);
      for (const z of others) {
        const msg = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, t: now, from: { n: nick, x: null, y: null }, to: { n: z.n, x: null, y: null }, s: `【盟】${s}`, b, r: false };
        await W.casUpdate(mail, "inbox_" + z.o, (cur) => ({ m: [msg, ...((cur && cur.m) || [])].slice(0, M.LIMITS.inbox) }));
      }
      return done(`已發給 ${others.length} 位盟友`);
    }
    default:
      if (a.t === "get") return { ok: true, ...(await state({ saves, world, owner })) };
      return bad("未知的操作");
  }
}

async function disband(world, ally, mail, now) {
  for (const z of ally.m) {
    await world.delete("alm_" + z.o);
    await retag(world, z.o);
    if (mail && z.o !== ally.lead) await M.systemMail(mail, z.o, "【聯盟】聯盟解散", `聯盟「${ally.name}」已被盟主解散。`, now);
  }
  for (const z of ally.inv || []) await cas(world, "ainv_" + z.o, (c) => (c ? { a: c.a.filter((q) => q.id !== ally.id) } : undefined));
  await world.delete("atag_" + ally.tag.toLowerCase());
  await world.delete("ally_" + ally.id);
}

module.exports = { act, state, embLevel, capOf };
