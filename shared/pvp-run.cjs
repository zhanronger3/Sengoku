// 玩家出兵(只登記,不結算):
//   1 驗證 → 2 攻擊方存檔記一筆「出征中」(先寫,成功了才登記攻擊;失敗就什麼都沒發生)→ 3 登記攻擊與來襲警報
// 真正的戰鬥在部隊抵達時由 battle-run.cjs 結算。
const G = require("./game.cjs");
const core = require("./server-core.cjs");
const W = require("./world-store.cjs");
const B = require("./battle-run.cjs");
const clone = (o) => JSON.parse(JSON.stringify(o));
const LOCK_TTL = 15000;

// 同一位玩家的出兵請求一次只處理一個,避免重複送出同一個操作
async function lock(world, uid, now) {
  const key = "lock_" + uid;
  const w = await world.setJSON(key, { t: now }, { onlyIfNew: true });
  if (!w || w.modified !== false) return true;
  const g = await world.getWithMetadata(key, { type: "json" });
  if (g && g.data && now - g.data.t > LOCK_TTL) {
    const w2 = await world.setJSON(key, { t: now }, { onlyIfMatch: g.etag });
    return !(w2 && w2.modified === false);
  }
  return false;
}
const unlock = (world, uid) => world.delete("lock_" + uid);
// 兩位玩家是不是同一個聯盟
async function allied(world, a, b) {
  const x = await world.get("alm_" + a, { type: "json" }), y = await world.get("alm_" + b, { type: "json" });
  return !!(x && y && x.a && x.a === y.a);
}

// uid = 出兵城池的存檔鍵(主城就是帳號 id);owner = 帳號 id(多座城池共用同一個鎖、同一個收件匣)
async function prepare({ saves, world, battle, mail, uid, owner, nick, body, stored, etag, now }) {
  owner = owner || uid;
  const rev = stored.rev;
  if ((body.rev || 0) !== rev) return { status: 409, body: { ...core.view(stored, now), ok: false, msg: "已同步伺服器狀態" } };
  if (!(await lock(world, owner, now))) return { status: 409, body: { ok: false, msg: "上一個出兵操作還在處理中,請稍候再試" } };
  const att = core.settle(clone(stored.state), now);
  const fail = async (msg) => { await unlock(world, owner).catch(() => {}); return { status: 422, body: { ok: false, msg, state: att, rev, now } }; };
  try {
    const a = body.action;
    const found = a.kind === "found", reinf = a.kind === "reinf";
    const tx = Math.floor(+a.tx), ty = Math.floor(+a.ty);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return await fail("座標錯誤");
    let hit = null, act = { ...a };
    let defCity = "";
    if (!found) await W.markCityTiles(world, tx, ty, tx, ty);
    const npc = !found && G.npcAt(tx, ty);
    if (npc) {
      // 營寨(全服共用):無主、被別人佔領、或自己佔領的(自己佔領的就是增援駐軍)
      if (npc.zg) return await fail("菩提山城不能攻擊,請行三顧之禮");
      const cur = G.campCur(await world.get(B.campKey(tx, ty), { type: "json" }), npc, now);
      if (cur.o === owner) {
        // 自己佔領的營寨:這座城自己佔的,或明確按「增援駐防」→ 增援駐軍;另一座城(例如主城)佔的,用「出兵掠奪」就是真的攻打、打贏換成這座城佔領
        if (act.kind !== "scout" && (act.kind === "reinf" || cur.oc === uid)) act.kind = "reinf";
        else if (act.kind !== "scout") {
          if (!act.hero) return await fail("這座營寨是你另一座城佔領的:要攻打它必須由武將領軍(打贏後改由這座城佔領);只想送兵進去請按「增援駐防」");
          const oc = G.occCheck(clone(att), tx, ty);
          if (!oc.ok) return await fail(`這座城無法佔領這座營寨(${oc.why || "不在範圍內或名額已滿"}),不能攻打自己的營寨`);
        }
      } else {
        if (act.kind === "reinf") return await fail("只能增援自己佔領的營寨");
        if (cur.o && (await allied(world, owner, cur.o))) return await fail("盟友佔領的營寨不能攻打");
      }
    } else if (found) {
      if (Math.abs(tx) > 500 || Math.abs(ty) > 500) return await fail("建城的座標太遠了(範圍 -500 ~ 500)");
      if (G.npcAt(tx, ty)) return await fail("這裡是營寨或山城,不能建城");
      if (await W.findAt(world, tx, ty)) return await fail("這個位置已經有城池了");
      const tk = await world.get(`t_${tx}_${ty}`, { type: "json" });
      if (tk) return await fail("這個位置已經被佔用了");
    } else if (!npc) {
      hit = await W.findAt(world, tx, ty);
      if (!hit) return await fail("該座標沒有玩家的城池");
      const hitOwner = hit.rec.o || hit.uid;
      const gotD = await saves.getWithMetadata(hit.uid, { type: "json" });
      if (!gotD || !gotD.data || !gotD.data.state) return await fail("對方還沒開始遊戲");
      { const ds = gotD.data.state; defCity = ds.cname ? ds.cname : ds.col ? "分城" : hit.rec.n + "的主城"; }
      if (reinf) {
        if (hit.uid === uid) return await fail("不能增援這座城自己");
        if (hitOwner !== owner && !(await allied(world, owner, hitOwner))) return await fail("只能增援自己的城池,或同一個聯盟盟友的城池");
      } else {
        if (hitOwner === owner) return await fail("不能攻擊自己的城池");
        const def = core.settle(clone(gotD.data.state), now);
        if (G.pvpProtected(def, now)) return await fail("對方仍在新手保護期,暫時不能攻擊");
      }
    }

    const aid = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const r = G.pvpLaunch(att, act, { aid, defNick: npc ? npc.n : hit && hit.rec.n, defCity, now, camp: npc ? 1 : 0 });
    if (!r.ok) return await fail(r.msg);
    att.saved = now;
    const next = rev + 1;
    const w = await saves.setJSON(uid, { state: att, rev: next, updatedAt: now }, { onlyIfMatch: etag });
    if (w && w.modified === false) {
      await unlock(world, owner).catch(() => {});
      return { status: 409, body: { ...core.view((await saves.get(uid, { type: "json" })) || stored, now), ok: false, msg: "已同步伺服器狀態" } };
    }
    const arrAt = now + Math.round((r.dur / G.SPEED) * 1000);
    try {
      await B.registerAttack({
        battle, mail, now,
        rec: {
          id: aid, att: { uid, o: owner, n: nick, cn: att.cname ? att.cname : att.col ? "分城" : nick + "的主城", x: r.pos.x, y: r.pos.y, fac: r.fac, ab: r.ab, hero: r.hero || null, ar: r.ar || 0, ah: r.ah || [] },
          def: found || npc ? null : { uid: hit.uid, o: hit.rec.o || hit.uid, n: hit.rec.n, x: hit.rec.x, y: hit.rec.y },
          tx, ty, send: r.send, sentAt: now, arrAt, go: r.go, dur: r.dur, dist: r.dist, kind: npc ? (r.kind === "scout" ? "campscout" : r.kind === "reinf" ? "campgar" : "camp") : r.kind || "", tg: r.tg || [],
        },
      });
    } catch (e) { /* 登記失敗:攻擊方的「出征中」紀錄在抵達時間過後會自動取消,部隊折返 */ }
    await unlock(world, owner).catch(() => {});
    const total = r.send.reduce((p, q) => p + q, 0), mins = Math.max(1, Math.round((arrAt - now) / 60000));
    const msg = npc
      ? `已派 ${total} 人前往${npc.n}(${tx}|${ty}),約 ${mins} 分鐘後抵達;${r.kind === "scout" ? "偵察報告" : r.kind === "reinf" ? "抵達後開始駐守" : "戰況"}會用飛鴿傳書通知你`
      : found
      ? `已派 3 名開墾代官前往(${tx}|${ty}),約 ${mins} 分鐘後抵達並建立分城`
      : reinf
      ? `已派 ${total} 名士兵前往 ${hit.rec.n}(${tx}|${ty}) 增援,約 ${mins} 分鐘後抵達並駐防`
      : `已派${r.kind ? "偵察兵" : "兵"} ${total} 人前往 ${hit.rec.n}(${tx}|${ty}),約 ${mins} 分鐘後抵達;抵達時才會開戰,戰況會用飛鴿傳書通知你`;
    return { status: 200, body: { ok: true, msg, state: att, rev: next, now } };
  } catch (e) {
    await unlock(world, owner).catch(() => {});
    throw e;
  }
}

// 撤回出兵:已走多少時間就再走回去
async function recall({ saves, world, battle, mail, uid, owner, body, stored, etag, now }) {
  owner = owner || uid;
  const rev = stored.rev;
  if ((body.rev || 0) !== rev) return { status: 409, body: { ...core.view(stored, now), ok: false, msg: "已同步伺服器狀態" } };
  if (!(await lock(world, owner, now))) return { status: 409, body: { ok: false, msg: "上一個出兵操作還在處理中,請稍候再試" } };
  const aid = String((body.action && body.action.aid) || "");
  const att = core.settle(clone(stored.state), now);
  try {
    const r0 = G.pvpRecall(clone(att), aid);                       // 先試算,不能撤回就不動任何東西
    if (!r0.ok) return { status: 422, body: { ok: false, msg: r0.msg, state: att, rev, now } };
    const rec = await B.cancelAttack({ battle, id: aid, now });     // 搶先把攻擊標成「已撤回」,之後它就不會被結算
    if (!rec) {
      // 登記資料已遺失(或剛好抵達):遺失的情況交給原本的折返機制處理
      const left = await battle.get(B.akey(aid), { type: "json" });
      return { status: 422, body: { ok: false, msg: left ? "部隊已經抵達,無法撤回" : "找不到這筆出兵紀錄,部隊會自動折返", state: att, rev, now } };
    }
    const r = G.pvpRecall(att, aid);
    att.saved = now;
    const w = await saves.setJSON(uid, { state: att, rev: rev + 1, updatedAt: now }, { onlyIfMatch: etag });
    if (w && w.modified === false) {
      await B.uncancelAttack({ battle, id: aid }).catch(() => {});
      return { status: 409, body: { ...core.view((await saves.get(uid, { type: "json" })) || stored, now), ok: false, msg: "已同步伺服器狀態,請再按一次撤軍" } };
    }
    try { await B.finishCancel({ battle, mail, rec, now }); } catch (e) { /* 收尾失敗不影響撤回:攻擊已標記為取消,不會被結算 */ }
    return { status: 200, body: { ok: true, msg: `已撤回前往 ${r.name} 的部隊,已走多久就再走多久回來`, state: att, rev: rev + 1, now } };
  } finally {
    await unlock(world, owner).catch(() => {});
  }
}

module.exports = { prepare, recall, lock, unlock, allied };
