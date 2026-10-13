// 玩家對戰:登記來襲、抵達時結算。
//   atk_<id>   一筆攻擊的完整資料(狀態:pending / resolving)
//   inc_<uid>  某位玩家的「來襲收件匣」:誰、什麼時候會抵達
// 結算可以由「防守方」或「攻擊方」任何一次請求觸發;每一步都是可重複執行的(重複呼叫不會重複計算),
// 防守方存檔裡會記一筆 atkRes[攻擊編號] 當作「已經結算」的唯一依據。
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const M = require("./mail-store.cjs");
const R = require("./battle-report.cjs");

const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLAIM_TTL = 20000;      // 某個請求認領結算後,超過這麼久沒完成,別的請求可以接手
const FIZZLE_GRACE = 30000;   // 出兵紀錄遺失時,抵達時間過了這麼久才取消
const MAIL_LIMIT = 2400;
const akey = (id) => "atk_" + id;
const ikey = (uid) => "inc_" + uid;

async function registerAttack({ battle, mail, rec, now }) {
  await battle.setJSON(akey(rec.id), { ...rec, state: "pending" }, { onlyIfNew: true });
  await W.casUpdate(battle, ikey(rec.def.uid), (cur) => ({
    a: [...((cur && cur.a) || []), { id: rec.id, arrAt: rec.arrAt, n: rec.att.n, x: rec.att.x, y: rec.att.y }].sort((p, q) => p.arrAt - q.arrAt),
  }));
  const mins = Math.max(1, Math.round((rec.arrAt - now) / 60000));
  await M.systemMail(mail, rec.def.uid, "來襲警報",
    `${rec.att.n}(${rec.att.x}|${rec.att.y})的軍勢正向你的城池進軍!\n預計 ${R.fmtTime(rec.arrAt)} 抵達(約 ${mins} 分鐘後)。\n部隊抵達時才會開戰,戰況會用飛鴿傳書通知你。趁現在整備軍隊、升級城牆吧。`,
    now, { id: `atk-${rec.id}-w`, limit: MAIL_LIMIT });
}

async function incomingFor(battle, uid) {
  const l = await battle.get(ikey(uid), { type: "json" });
  return (l && l.a) || [];
}

// 取消一筆找不到登記資料的出兵(部隊折返)
async function fizzle({ saves, uid, aid, now }) {
  for (let i = 0; i < 8; i++) {
    const g = await saves.getWithMetadata(uid, { type: "json" });
    if (!g || !g.data || !g.data.state) return;
    const st = clone(g.data.state);
    G.fix(st);
    if (!G.pvpApplyAtt(st, aid, { fizzled: true }, {})) return;
    const w = await saves.setJSON(uid, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) return;
    await sleep(Math.random() * 5 * (i + 1));
  }
}

// 結算一筆攻擊。回傳 true 代表這次呼叫完成了結算。
async function resolveAttack({ saves, battle, mail, id, now }) {
  // 1 認領:同一時間只會有一個請求在算這場戰鬥
  let rec = null, claimed = false;
  await W.casUpdate(battle, akey(id), (cur) => {
    claimed = false;
    if (!cur || cur.state === "done" || cur.state === "cancelled") return undefined;
    if (cur.state === "resolving" && now - (cur.claimAt || 0) < CLAIM_TTL) return undefined;
    rec = cur;
    claimed = true;
    return { ...cur, state: "resolving", claimAt: now };
  });
  if (!claimed || !rec) return false;

  // 2 對「抵達那一刻」的防守方狀態算出戰果並寫回防守方存檔(寫入成功才算結算完成)
  let res = null;
  for (let i = 0; i < 10 && !res; i++) {
    const g = await saves.getWithMetadata(rec.def.uid, { type: "json" });
    if (!g || !g.data || !g.data.state) { res = { void: true }; break; }
    const st = clone(g.data.state);
    G.fix(st);
    if (st.atkRes && st.atkRes[id]) { res = st.atkRes[id]; break; } // 已經結算過(前一次中途失敗)
    core.settleTo(st, rec.arrAt);                                      // 先把防守方補算到抵達的那一刻
    if (G.pvpProtected(st, rec.arrAt)) { res = { void: true, why: "protected" }; break; }
    const r = G.pvpBattle({ fac: rec.att.fac, send: rec.send, ab: rec.att.ab }, st);
    G.pvpApplyDef(st, r, { id, attNick: rec.att.n, attPos: { x: rec.att.x, y: rec.att.y } });
    const w = await saves.setJSON(rec.def.uid, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) { res = r; break; }
    await sleep(Math.random() * 6 * (i + 1));
  }
  if (!res) {
    await W.casUpdate(battle, akey(id), (cur) => (cur ? { ...cur, state: "pending" } : undefined)); // 放掉認領,之後再試
    return false;
  }

  // 3 攻擊方:出征中 → 返回中(帶著戰利品與生還的兵)
  for (let i = 0; i < 10; i++) {
    const ga = await saves.getWithMetadata(rec.att.uid, { type: "json" });
    if (!ga || !ga.data || !ga.data.state) break;
    const st = clone(ga.data.state);
    G.fix(st);
    if (!G.pvpApplyAtt(st, id, res, {})) break; // 已經套用過
    const w = await saves.setJSON(rec.att.uid, { state: st, rev: ga.data.rev + 1, updatedAt: now }, { onlyIfMatch: ga.etag });
    if (!w || w.modified !== false) break;
    await sleep(Math.random() * 6 * (i + 1));
  }

  // 4 戰報(兩邊各一封;信件編號固定,重複寄也只會有一封)
  const rp = R.build(res, {
    id, attNick: rec.att.n, defNick: rec.def.n, attPos: { x: rec.att.x, y: rec.att.y }, defPos: { x: rec.def.x, y: rec.def.y },
    arrAt: rec.arrAt, dist: rec.dist || 0,
  });
  await M.systemMail(mail, rec.att.uid, rp.att.s, rp.att.b, now, { id: `atk-${id}-a`, limit: MAIL_LIMIT });
  if (rp.def) await M.systemMail(mail, rec.def.uid, rp.def.s, rp.def.b, now, { id: `atk-${id}-d`, limit: MAIL_LIMIT });

  // 5 收尾
  await W.casUpdate(battle, ikey(rec.def.uid), (cur) => (!cur || !cur.a.some((x) => x.id === id) ? undefined : { a: cur.a.filter((x) => x.id !== id) }));
  await battle.delete(akey(id));
  return true;
}

// 撤回:只有「還沒抵達、也還沒被認領結算」的攻擊才能撤回。成功回傳登記資料;否則回傳 null
async function cancelAttack({ battle, id, now }) {
  let rec = null;
  await W.casUpdate(battle, akey(id), (cur) => {
    rec = null;
    if (!cur || cur.state !== "pending" || now >= cur.arrAt) return undefined;
    rec = cur;
    return { ...cur, state: "cancelled" };
  });
  return rec;
}
// 撤回失敗(例如存檔寫入一直衝突)時,把攻擊恢復成可結算
async function uncancelAttack({ battle, id }) {
  await W.casUpdate(battle, akey(id), (cur) => (cur && cur.state === "cancelled" ? { ...cur, state: "pending" } : undefined));
}
// 撤回成功後的收尾:清掉防守方的來襲通知、攻擊登記,並通知防守方
async function finishCancel({ battle, mail, rec, now }) {
  await W.casUpdate(battle, ikey(rec.def.uid), (cur) => (!cur || !cur.a.some((x) => x.id === rec.id) ? undefined : { a: cur.a.filter((x) => x.id !== rec.id) }));
  await battle.delete(akey(rec.id));
  await M.systemMail(mail, rec.def.uid, "來襲取消",
    `${rec.att.n}(${rec.att.x}|${rec.att.y})的軍勢在半路撤退了,不會抵達你的城池。`,
    now, { id: `atk-${rec.id}-c`, limit: MAIL_LIMIT });
}

// 在處理某位玩家的請求之前呼叫:把跟他有關、已經到期的攻擊依抵達時間先結算掉
async function resolveDueFor({ saves, battle, mail, uid, now }) {
  let n = 0;
  // 他是防守方:依抵達時間排序,一場一場結算
  const inc = (await incomingFor(battle, uid)).filter((e) => e.arrAt <= now).sort((a, b) => a.arrAt - b.arrAt);
  for (const e of inc) {
    if (await resolveAttack({ saves, battle, mail, id: e.id, now })) n++;
    else if (!(await battle.get(akey(e.id), { type: "json" }))) {
      // 登記資料已經不存在(例如登記到一半失敗):把這筆殘留的來襲通知清掉
      await W.casUpdate(battle, ikey(uid), (cur) => (!cur || !cur.a.some((x) => x.id === e.id) ? undefined : { a: cur.a.filter((x) => x.id !== e.id) }));
    }
  }
  // 他是攻擊方:自己出征中的部隊如果已經抵達,也順便結算(防守方可能一直不上線)
  const mine = await saves.get(uid, { type: "json" });
  const pend = mine && mine.state ? (mine.state.mv || []).filter((m) => m.pending && m.aid) : [];
  for (const m of pend) {
    const rec = await battle.get(akey(m.aid), { type: "json" });
    if (rec) {
      if (rec.arrAt <= now && (await resolveAttack({ saves, battle, mail, id: m.aid, now }))) n++;
    } else if (m.sentAt && now > m.sentAt + (m.dur / G.SPEED) * 1000 + FIZZLE_GRACE) {
      await fizzle({ saves, uid, aid: m.aid, now });
      n++;
    }
  }
  return n;
}

module.exports = { cancelAttack, uncancelAttack, finishCancel, registerAttack, incomingFor, resolveAttack, resolveDueFor, fizzle, akey, ikey };
