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
const A = require("./acct.cjs");

const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLAIM_TTL = 20000;      // 某個請求認領結算後,超過這麼久沒完成,別的請求可以接手
const FIZZLE_GRACE = 30000;   // 出兵紀錄遺失時,抵達時間過了這麼久才取消
const MAIL_LIMIT = 2400;
const akey = (id) => "atk_" + id;
const seedOf = (id) => { let h = 2166136261; for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const ikey = (uid) => "inc_" + uid;
const campKey = (x, y) => `camp_${x}_${y}`;

// 帳號 id:存檔鍵可能是分城(c_ 開頭),信件與來襲通知都歸帳號
const ownerOfAtt = (rec) => rec.att.o || rec.att.uid;
const ownerOfDef = (rec) => (rec.def ? rec.def.o || rec.def.uid : null);

async function registerAttack({ battle, mail, rec, now }) {
  await battle.setJSON(akey(rec.id), { ...rec, state: "pending" }, { onlyIfNew: true });
  if (!rec.def) return; // 開分城:沒有防守方,不需要來襲警報
  const friendly = rec.kind === "reinf";
  if (friendly && ownerOfDef(rec) === ownerOfAtt(rec)) return; // 增援自己的城池:不用通知
  await W.casUpdate(battle, ikey(ownerOfDef(rec)), (cur) => ({
    a: [...((cur && cur.a) || []), { id: rec.id, arrAt: rec.arrAt, n: rec.att.n, x: rec.att.x, y: rec.att.y, tx: rec.def.x, ty: rec.def.y, ...(friendly ? { k: "reinf" } : {}) }].sort((p, q) => p.arrAt - q.arrAt),
  }));
  const mins = Math.max(1, Math.round((rec.arrAt - now) / 60000));
  if (friendly) {
    await M.systemMail(mail, ownerOfDef(rec), "盟軍增援",
      `盟友 ${rec.att.n}(${rec.att.x}|${rec.att.y})派兵前來增援你的城池(${rec.def.x}|${rec.def.y}),預計 ${R.fmtTime(rec.arrAt)} 抵達(約 ${mins} 分鐘後)。\n他們抵達後會一起守城,吃這座城的糧;你隨時可以到軍奉行請他們回去。`,
      now, { id: `atk-${rec.id}-w`, limit: MAIL_LIMIT });
    return;
  }
  await M.systemMail(mail, ownerOfDef(rec), "來襲警報",
    `${rec.att.n}(${rec.att.x}|${rec.att.y})的軍勢正向你的城池(${rec.def.x}|${rec.def.y})進軍!\n預計 ${R.fmtTime(rec.arrAt)} 抵達(約 ${mins} 分鐘後)。\n部隊抵達時才會開戰,戰況會用飛鴿傳書通知你。趁現在整備軍隊、升級城牆吧。`,
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

// 把戰果套用到攻擊方的存檔(出征中 → 返回中,或開分城完成);已經套用過就什麼都不做
async function applyToAttacker({ saves, rec, id, res, now }) {
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
}

// 開分城:部隊抵達時才檢查地點、建立新城。每一步都可以重複執行(新城的存檔鍵由攻擊編號決定)
async function resolveFound({ saves, world, battle, mail, rec, now }) {
  const id = rec.id, ck = "c_" + id, x = rec.tx, y = rec.ty, owner = ownerOfAtt(rec);
  let res;
  if (G.npcAt(x, y)) res = { found: 1, ok: false, why: "這裡是營寨或山城,不能建城。" };
  else {
    const ex = await W.findAt(world, x, y);
    if (ex && ex.uid !== ck) res = { found: 1, ok: false, why: "有別人搶先在這裡建了城。" };
    else if (!(await W.claimTile(world, x, y, ck))) res = { found: 1, ok: false, why: "這塊地已經被別人佔用了。" };
    else {
      let st = null;
      const g = await saves.getWithMetadata(ck, { type: "json" });
      if (g && g.data && g.data.state) st = g.data.state;
      else {
        const no = await A.nextNo(world, owner);
        st = G.initCity(rec.att.fac, { x, y }, { own: owner, cname: `${rec.att.n}的分城${no}`, now: rec.arrAt });
        const w = await saves.setJSON(ck, { state: st, rev: 1, updatedAt: now }, { onlyIfNew: true });
        if (w && w.modified === false) st = (await saves.get(ck, { type: "json" })).state;
      }
      await world.setJSON("owner_" + ck, { x, y }, { onlyIfNew: true });
      await A.add(world, owner, ck);
      W.stampPub(st, rec.att.n, now);
      await W.publishState(world, ck, st, owner);
      res = { found: 1, ok: true };
    }
  }
  await applyToAttacker({ saves, rec, id, res, now });
  const rp = R.buildFound(res, { attNick: rec.att.n, attPos: { x: rec.att.x, y: rec.att.y }, defPos: { x, y }, arrAt: rec.arrAt });
  await M.systemMail(mail, owner, rp.att.s, rp.att.b, now, { id: `atk-${id}-a`, limit: MAIL_LIMIT });
  await battle.delete(akey(id));
  return true;
}

// 對一份存檔做「讀 → 改 → 條件寫入」(fn 回傳 false 代表不用寫)
async function mutateSave(saves, key, now, fn) {
  for (let i = 0; i < 10; i++) {
    const g = await saves.getWithMetadata(key, { type: "json" });
    if (!g || !g.data || !g.data.state) return null;
    const st = clone(g.data.state);
    G.fix(st);
    if (fn(st) === false) return st;
    const w = await saves.setJSON(key, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) return st;
    await sleep(Math.random() * 6 * (i + 1));
  }
  throw new Error("camp: write conflict");
}
const unitStr = (fac, u) => u.map((x, k) => (x ? `${G.UN[fac][k].n}×${x}` : "")).filter(Boolean).join("、") || "無";
function campReport(res, rec, n) {
  const pos = `${n.n}(${rec.tx}|${rec.ty})`;
  if (res.scout) {
    const v = res.view;
    const body = v.occ ? `佔領者:${v.on || "不明"}\n駐軍合計 ${G.garSum(v.gs)} 人,防禦約 ${v.def}\n${v.gs.map((g) => unitStr(g.fac, g.u)).join("\n") || "(目前沒有駐軍,誰派兵進駐就能拿下)"}`
      : `守軍:${Object.entries(v.g).filter(([, c]) => c > 0).map(([u, c]) => `${u}×${c}`).join("、") || "無"}\n防禦合計約 ${v.def}\n庫存(每種資源) ${v.st.map((x) => Math.max(0, Math.floor(x))).join("/")}${v.left ? `\n${Math.ceil(v.left / 60000)} 分鐘後重新集結` : ""}`;
    return { s: `【偵察】${pos}`, b: `${R.fmtTime(rec.arrAt)},偵察兵抵達${pos}。\n\n${body}` };
  }
  const lost = res.deadA.reduce((p, q) => p + q, 0), sent = res.sent.reduce((p, q) => p + q, 0);
  const head = `${R.fmtTime(rec.arrAt)},你的軍勢(出兵 ${sent} 人,英雄帶隊)抵達${pos}${res.occupied ? ",守軍是玩家的駐軍" : ""}。\n我方攻擊力 ${res.A}、守軍防禦力 ${res.D}。\n\n`;
  let tail;
  if (!res.win) tail = `進攻失敗,全軍覆沒,英雄戰死(需要到評定眾復活)。守軍也受到損傷。`;
  else if (res.occupy) tail = `戰勝!陣亡 ${lost} 人,守軍被全滅。\n生還的 ${res.garr.reduce((p, q) => p + q, 0)} 人留下駐守,營寨現在是你的:每種資源每小時 +${15 * (res.tier + 1)}。${res.loot.some((x) => x > 0) ? `\n搶得 ${res.loot.join("/")} 已直接入庫。` : ""}${res.art.length ? `\n英雄在營寨裡找到了名物${res.art.map((id) => `「${((G.ARTM || {})[id] || {}).n || id}」`).join("、")}(藏寶閣有空位、且還沒有同一件才會收進去)。` : ""}`;
  else tail = `戰勝!陣亡 ${lost} 人。${res.loot.some((x) => x > 0) ? `搶得 ${res.loot.join("/")}(部隊返回後入庫)。` : ""}\n守軍已全滅,但這座營寨不在這座城 15×15 範圍內,或評定眾的佔領名額已滿,所以沒有佔領(營寨回到無主,等待重新集結)。`;
  return { s: `【營寨】${res.win ? "戰勝" : "戰敗"} ${pos}`, b: head + tail };
}

// 營寨(全服共用)的戰鬥/偵察/駐守:結算寫進 camp_<x>_<y>,每場戰鬥用攻擊編號去重
async function resolveCamp({ saves, world, battle, mail, rec, now }) {
  const id = rec.id, owner = ownerOfAtt(rec), n = G.npcAt(rec.tx, rec.ty), ck = campKey(rec.tx, rec.ty), key = rec.tx + "," + rec.ty;
  let res = null;
  if (!n || n.zg) res = { void: true };
  else if (rec.kind === "campscout") {
    res = G.campScout(await world.get(ck, { type: "json" }), n, rec.arrAt);
    res.sent = rec.send.slice(); res.deadA = rec.send.map(() => 0); res.surv = rec.send.slice();
  } else if (rec.kind === "campgar") {
    await W.casUpdate(world, ck, (cur) => {
      if (!cur || cur.o !== owner) { res = { reinf: 1, ok: false, why: "這座營寨已經不是你的了" }; return undefined; }
      res = { reinf: 1, ok: true, tk: "camp:" + key };
      if ((cur.gs || []).some((g) => g.gid === id)) return undefined;
      return { ...cur, gs: [...(cur.gs || []), { gid: id, fac: rec.att.fac, o: owner, k: rec.att.uid, u: rec.send.slice() }] };
    });
  } else {
    const ag = await saves.get(rec.att.uid, { type: "json" });
    const oc = ag && ag.state ? G.occCheck(clone(ag.state), rec.tx, rec.ty) : { ok: false };
    const info = { id, uid: owner, cityKey: rec.att.uid, nick: rec.att.n, fac: rec.att.fac, send: rec.send, ab: rec.att.ab, hero: rec.att.hero || null, canOcc: !!oc.ok, tx: rec.tx, ty: rec.ty };
    await W.casUpdate(world, ck, (cur) => {
      if (cur && cur.rs && cur.rs[id]) { res = cur.rs[id].res; return undefined; }
      const doc = G.campCur(cur, n, rec.arrAt);
      const r = G.campBattle(info, doc, n, rec.arrAt);
      res = r.res;
      const old = (cur && cur.rs) || {}, ids = Object.keys(old).slice(-5);
      const rs = {}; for (const k of ids) rs[k] = old[k]; rs[id] = { res: r.res };
      return { ...r.doc, rs };
    });
    // 原本佔領的人:守軍有損失或營寨被奪走,同步他每一座出兵城的存檔並寄信
    if (res.prev) {
      for (const k of res.prev.ks) await mutateSave(saves, k, now, (st) => { core.settleTo(st, now); G.campSync(st, key, res.prev.lost ? null : res.prev.gs); });
      const lostTxt = res.prev.lost ? `營寨${n.n}(${key.replace(",", "|")})被 ${rec.att.n} 攻陷了!你的駐軍全軍覆沒,營寨不再屬於你。` : `營寨${n.n}(${key.replace(",", "|")})遭到 ${rec.att.n} 的攻擊,守軍有損失,但守住了。`;
      await M.systemMail(mail, res.prev.o, res.prev.lost ? "營寨失守" : "營寨遇襲", lostTxt, now, { id: `atk-${id}-d`, limit: MAIL_LIMIT });
    }
  }
  await applyToAttacker({ saves, rec, id, res, now });
  const rp = res.void ? { s: "【營寨】目標已不存在", b: "你的部隊抵達時,目標營寨已經不存在,部隊折返。" } : res.reinf ? { s: res.ok ? "駐守抵達" : "駐守失敗", b: res.ok ? `你派出的 ${rec.send.reduce((p, q) => p + q, 0)} 名士兵已抵達 ${n.n}(${key.replace(",", "|")}),開始駐守。` : `駐守失敗:${res.why}。部隊折返。` } : campReport(res, rec, n);
  await M.systemMail(mail, owner, rp.s, rp.b, now, { id: `atk-${id}-a`, limit: MAIL_LIMIT });
  await battle.delete(akey(id));
  return true;
}

// 增援抵達:放進目標城池的駐防名單(同一場重複結算只會放一次)
async function resolveReinf({ saves, world, battle, mail, rec, now }) {
  const id = rec.id, owner = ownerOfAtt(rec), defOwner = ownerOfDef(rec);
  let res = null;
  for (let i = 0; i < 10 && !res; i++) {
    const g = await saves.getWithMetadata(rec.def.uid, { type: "json" });
    if (!g || !g.data || !g.data.state) { res = { reinf: 1, ok: false, why: "目標城池已經不存在" }; break; }
    const st = clone(g.data.state);
    G.fix(st);
    if (!A.ownedBy(st, rec.def.uid, defOwner)) { res = { reinf: 1, ok: false, why: "那座城池已經易主" }; break; }
    if (defOwner !== owner) {
      const x = await world.get("alm_" + owner, { type: "json" }), y = await world.get("alm_" + defOwner, { type: "json" });
      if (!(x && y && x.a && x.a === y.a)) { res = { reinf: 1, ok: false, why: "你們已經不是同一個聯盟" }; break; }
    }
    core.settleTo(st, rec.arrAt);
    const r = G.garrApply(st, { gid: id, o: owner, n: rec.att.n, fac: rec.att.fac, k: rec.att.uid, u: rec.send });
    if (!r.ok) { res = { reinf: 1, ok: false, why: r.why }; break; }
    if (r.dup) { res = { reinf: 1, ok: true, tk: rec.def.uid }; break; }
    const w = await saves.setJSON(rec.def.uid, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) { res = { reinf: 1, ok: true, tk: rec.def.uid }; break; }
    await sleep(Math.random() * 6 * (i + 1));
  }
  if (!res) {
    await W.casUpdate(battle, akey(id), (cur) => (cur ? { ...cur, state: "pending" } : undefined));
    return false;
  }
  await applyToAttacker({ saves, rec, id, res, now });
  const pos = `${rec.def.n}(${rec.def.x}|${rec.def.y})`, n = rec.send.reduce((p, q) => p + q, 0);
  await M.systemMail(mail, owner, res.ok ? "增援抵達" : "增援失敗",
    res.ok ? `你派出的 ${n} 名士兵已抵達 ${pos},開始駐防。可以在出發城池的軍奉行把他們召回。` : `你派去 ${pos} 的 ${n} 名士兵無法駐防:${res.why}。部隊正在返回。`,
    now, { id: `atk-${id}-a`, limit: MAIL_LIMIT });
  if (res.ok && defOwner !== owner) await M.systemMail(mail, defOwner, "盟軍抵達", `${rec.att.n} 派來的 ${n} 名士兵抵達 ${pos},現在和你的守軍一起守城。`, now, { id: `atk-${id}-d`, limit: MAIL_LIMIT });
  await W.casUpdate(battle, ikey(defOwner), (cur) => (!cur || !cur.a.some((x) => x.id === id) ? undefined : { a: cur.a.filter((x) => x.id !== id) }));
  await battle.delete(akey(id));
  return true;
}

// 城池易主後的收尾(可重複執行):帳號的城池清單、地圖上的擁有者
async function transferCity({ saves, world, rec, now }) {
  const key = rec.def.uid, oldO = ownerOfDef(rec), newO = ownerOfAtt(rec);
  if (oldO !== newO) { await A.drop(world, oldO, key); await A.add(world, newO, key); }
  const g = await saves.getWithMetadata(key, { type: "json" });
  if (g && g.data && g.data.state) {
    const st = clone(g.data.state);
    G.fix(st);
    if ((st.own || key) === newO) { W.stampPub(st, rec.att.n, now); await W.publishState(world, key, st, newO); }
  }
}

// 結算一筆攻擊。回傳 true 代表這次呼叫完成了結算。
async function resolveAttack({ saves, world, battle, mail, id, now }) {
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
  if (rec.kind === "found") return resolveFound({ saves, world, battle, mail, rec, now });
  if (rec.kind === "reinf") return resolveReinf({ saves, world, battle, mail, rec, now });
  if (rec.kind === "camp" || rec.kind === "campscout" || rec.kind === "campgar") return resolveCamp({ saves, world, battle, mail, rec, now });

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
    const ctxA = { id, attNick: rec.att.n, attPos: { x: rec.att.x, y: rec.att.y }, attOwner: ownerOfAtt(rec) };
    let r;
    if (rec.kind === "scout") { r = G.scoutBattle({ fac: rec.att.fac, send: rec.send }, st); G.scoutApplyDef(st, r, ctxA); }
    else { r = G.pvpBattle({ fac: rec.att.fac, send: rec.send, ab: rec.att.ab, tg: rec.tg || [], seed: seedOf(id), hero: rec.att.hero || null, ar: rec.att.ar || 0, ah: rec.att.ah || [] }, st); G.pvpApplyDef(st, r, ctxA); }
    const w = await saves.setJSON(rec.def.uid, { state: st, rev: g.data.rev + 1, updatedAt: now }, { onlyIfMatch: g.etag });
    if (!w || w.modified !== false) { res = r; break; }
    await sleep(Math.random() * 6 * (i + 1));
  }
  if (!res) {
    await W.casUpdate(battle, akey(id), (cur) => (cur ? { ...cur, state: "pending" } : undefined)); // 放掉認領,之後再試
    return false;
  }

  // 2.5 城池易主:更新帳號清單與地圖(失敗會讓這場戰鬥維持「結算中」,稍後別的請求接手重做這一步)
  if (res.conq && res.conq.taken) {
    try { await transferCity({ saves, world, rec, now }); }
    catch (e) { console.error("transferCity failed", e); await W.casUpdate(battle, akey(id), (cur) => (cur ? { ...cur, state: "pending" } : undefined)); return false; }
  }

  // 3 攻擊方:出征中 → 返回中(帶著戰利品與生還的兵)
  await applyToAttacker({ saves, rec, id, res, now });

  // 4 戰報(兩邊各一封;信件編號固定,重複寄也只會有一封)
  const rp = (res.scout ? R.buildScout : R.build)(res, {
    id, attNick: rec.att.n, defNick: rec.def.n, attPos: { x: rec.att.x, y: rec.att.y }, defPos: { x: rec.def.x, y: rec.def.y },
    arrAt: rec.arrAt, dist: rec.dist || 0,
  });
  await M.systemMail(mail, ownerOfAtt(rec), rp.att.s, rp.att.b, now, { id: `atk-${id}-a`, limit: MAIL_LIMIT });
  if (rp.def) await M.systemMail(mail, ownerOfDef(rec), rp.def.s, rp.def.b, now, { id: `atk-${id}-d`, limit: MAIL_LIMIT });

  // 5 收尾
  await W.casUpdate(battle, ikey(ownerOfDef(rec)), (cur) => (!cur || !cur.a.some((x) => x.id === id) ? undefined : { a: cur.a.filter((x) => x.id !== id) }));
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
  if (rec.def) {
    await W.casUpdate(battle, ikey(ownerOfDef(rec)), (cur) => (!cur || !cur.a.some((x) => x.id === rec.id) ? undefined : { a: cur.a.filter((x) => x.id !== rec.id) }));
    if (rec.kind === "reinf" && ownerOfDef(rec) === ownerOfAtt(rec)) { await battle.delete(akey(rec.id)); return; } // 自己城池之間的增援撤回:不用通知
    await M.systemMail(mail, ownerOfDef(rec), "來襲取消",
      `${rec.att.n}(${rec.att.x}|${rec.att.y})的軍勢在半路撤退了,不會抵達你的城池。`,
      now, { id: `atk-${rec.id}-c`, limit: MAIL_LIMIT });
  }
  await battle.delete(akey(rec.id));
}

// 在處理某位玩家(帳號)的請求之前呼叫:把跟他有關、已經到期的攻擊依抵達時間先結算掉
async function resolveDueFor({ saves, world, battle, mail, uid, now }) {
  let n = 0;
  // 他是防守方:依抵達時間排序,一場一場結算
  const inc = (await incomingFor(battle, uid)).filter((e) => e.arrAt <= now).sort((a, b) => a.arrAt - b.arrAt);
  for (const e of inc) {
    if (await resolveAttack({ saves, world, battle, mail, id: e.id, now })) n++;
    else if (!(await battle.get(akey(e.id), { type: "json" }))) {
      // 登記資料已經不存在(例如登記到一半失敗):把這筆殘留的來襲通知清掉
      await W.casUpdate(battle, ikey(uid), (cur) => (!cur || !cur.a.some((x) => x.id === e.id) ? undefined : { a: cur.a.filter((x) => x.id !== e.id) }));
    }
  }
  // 他是攻擊方:自己每座城池出征中的部隊如果已經抵達,也順便結算(防守方可能一直不上線)
  const keys = await A.list(world, uid);
  for (const key of keys) {
    const mine = await saves.get(key, { type: "json" });
    const pend = mine && mine.state ? (mine.state.mv || []).filter((m) => m.pending && m.aid) : [];
    for (const m of pend) {
      const rec = await battle.get(akey(m.aid), { type: "json" });
      if (rec) {
        if (rec.arrAt <= now && (await resolveAttack({ saves, world, battle, mail, id: m.aid, now }))) n++;
      } else if (m.sentAt && now > m.sentAt + (m.dur / G.SPEED) * 1000 + FIZZLE_GRACE) {
        await fizzle({ saves, uid: key, aid: m.aid, now });
        n++;
      }
    }
  }
  return n;
}

module.exports = { campKey, resolveCamp, cancelAttack, uncancelAttack, finishCancel, registerAttack, incomingFor, resolveAttack, resolveDueFor, fizzle, akey, ikey };
