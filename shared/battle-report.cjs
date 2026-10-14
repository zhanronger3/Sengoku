// 戰報文章:依戰鬥結果寫成一篇給攻守雙方各自看的短文(用攻擊編號做種子,同一場戰鬥每次產生的文字都一樣)
const G = require("./game.cjs");
const RES = ["木材", "泥土", "鐵塊", "糧食"];
const hash = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (arr, seed, salt) => arr[hash(seed + "|" + salt) % arr.length];
function fmtTime(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}
const sum = (a) => a.reduce((p, q) => p + q, 0);
const WEATHER = ["朝霧瀰漫", "細雨初歇", "烈日當空", "秋風蕭瑟", "夜色低垂", "殘雪未消", "晴空萬里", "陣風獵獵"];
const APPROACH = ["戰鼓擂動,大軍翻山越嶺", "軍配一揮,隊伍浩浩蕩蕩", "號角長鳴,旌旗蔽野", "星夜兼程,軍勢悄然"];
const CLASH_FIRST = ["兩軍甫一接觸,箭矢如雨,", "雙方先以鐵砲與弓矢互射,硝煙瀰漫,", "進軍鼓聲未歇,前鋒已經撞在一起,", "喊殺聲震動山谷,"];
const CLOSERS_WIN = ["戰國的世道,強者通吃,這一仗註定被寫進軍記。", "夕陽照著殘破的旗幟,勝負已分。", "此戰之後,城下之盟只是遲早的事。"];
const CLOSERS_LOSE = ["敗軍之將不言勇,殘兵只能咬牙退回。", "這一仗的教訓,只能留待下次雪恥。", "守軍的歡呼聲,在山谷間久久不散。"];
const unitsText = (fac, arr) => arr.map((n, k) => (n > 0 ? `${G.UN[fac][k].n}×${n}` : "")).filter(Boolean).join("、") || "無";
const mainUnit = (fac, arr) => { let k = 0; arr.forEach((n, i) => { if (n > arr[k]) k = i; }); return G.UN[fac][k].n; };
function table(fac, a, b, c, labels) {
  const rows = [];
  a.forEach((n, k) => { if (n > 0 || (b && b[k] > 0)) rows.push(`  ${G.UN[fac][k].n}:${labels[0]} ${n}${c ? `,${labels[1]} ${b[k]}` : ""}${labels[2] ? `,${labels[2]} ${labels[3](k)}` : ""}`); });
  return rows.join("\n");
}
// 攻城段落:破門槌拆城牆、大筒類轟擊建築(沒有攻城器械時回傳空字串)
function siegeText(sg, dFac) {
  if (!sg) return "";
  const L = [];
  const w = G.F[dFac].w.n;
  if (sg.wall) L.push(sg.wall.to < sg.wall.from ? `破門槌 ${sg.rams} 具猛撞${w},城牆從等級 ${sg.wall.from} 被撞到等級 ${sg.wall.to}。` : `破門槌 ${sg.rams} 具撞了半天,${w}依然屹立(等級 ${sg.wall.from})。`);
  else if (sg.rams > 0) L.push("破門槌一路抬到城下,才發現這座城根本沒有城牆可撞。");
  for (const h of sg.hits) {
    if (h.missing) L.push(`砲手把大筒對準${h.name},城裡卻根本沒有這棟建築,砲彈全落了空。`);
    else if (h.to < h.from) L.push(`${h.rnd ? "砲手沒有明確的目標,隨手一陣亂轟" : "砲手依照指令集中轟擊"},${h.name}從等級 ${h.from} 被打到等級 ${h.to}${h.to < 1 ? "(夷為平地)" : ""}。`);
    else L.push(`大筒轟向${h.name}(等級 ${h.from}),但砲火不夠猛,只留下滿牆焦痕。`);
  }
  return L.length ? "【攻城】\n" + L.join("\n") : "";
}
// 行政官說服家臣:降低忠誠度,歸零時城池易主(res.conq 由 G.pvpBattle 算出)
// 英雄的戰場畫面(熱血戰記口吻)。o:{win, seed, fac, target, name};同一場戰鬥用 seed 固定句型
const HERO_STYLE = { wei: ["第六天魔王的旗幟在他身後獵獵作響", "織田的赤色軍旗映紅了戰場"], shu: ["三河武士的忍耐在這一刻化為怒濤", "德川的葵紋旗在硝煙中屹立不搖"], wu: ["猴子出身的氣魄壓過了千軍萬馬", "豐臣的金瓢旗在陣前高高舉起"] };
function heroText(h, side, o = {}) {
  if (!h) return "";
  const n = h.n || o.name || "英雄", sd = o.seed || n, t = o.target || "敵陣", fac = (G.F && o.fac && HERO_STYLE[o.fac]) ? o.fac : "wei";
  const style = pick(HERO_STYLE[fac], sd, "hs");
  if (side === "att") {
    if (h.dead) return `【英雄】${pick([
      `${style}。${n}一馬當先殺入${t}的陣中,長刀所向,敵兵紛紛倒退。然而亂箭如雨,他渾身浴血,仍高呼「衝!」直到力竭倒下。`,
      `${n}橫刀立馬,獨自擋在潰散的友軍之前。${t}的守軍蜂擁而上,他連斬數人,終因寡不敵眾,戰死沙場。其忠勇,軍中無人不嘆。`,
      `${style}。${n}親自率領前鋒突擊,卻在${t}的亂軍中中了埋伏,英雄倒在血泊裡,眼神依然望著前方。`,
    ], sd, "hd")}(需要到評定眾復活)`;
    if (o.win) return `【英雄】${pick([
      `${style}。${n}一馬當先,長刀劈開${t}的防線,身後的將士齊聲吶喊,勢如破竹。此戰他獲得 ${h.xp} 點經驗。`,
      `${n}高舉軍旗,在箭雨中率隊猛衝,連破數道防線,最後親手拔下${t}的守旗,全軍為之沸騰。此戰獲得 ${h.xp} 點經驗。`,
      `${style}。${n}與守軍的主將正面交鋒,數十回合後一刀將其斬落馬下,${t}的抵抗就此瓦解。此戰獲得 ${h.xp} 點經驗。`,
    ], sd, "hw")}`;
    return `【英雄】${pick([
      `${n}在亂軍中奮力殺出一條血路,護著殘部一步步撤離${t}。雖然兵敗,他的背影依然讓追兵不敢逼近。獲得 ${h.xp} 點經驗。`,
      `${style}。可惜${t}的守備太過堅固,${n}咬牙下令收兵,親自斷後,保住了最後的火種。獲得 ${h.xp} 點經驗。`,
    ], sd, "hl")}`;
  }
  if (h.dead) return `【敵將】敵方英雄${n}在陣前力戰而亡,他的軍旗倒在城下,敵軍的士氣為之崩潰。`;
  return `【敵將】${pick([
    `敵方英雄${n}一馬當先衝在最前面,${o.win ? "雖然最後攻破了防線,守軍也讓他付出了代價。" : "卻被守軍頂住,只能悻悻撤退。"}`,
    `敵方英雄${n}揮旗督戰,殺聲震天,${o.win ? "這股氣勢讓守軍節節敗退。" : "終究沒能撕開防線。"}`,
  ], sd, "he")}`;
}
function artText(res, side) {
  if (!res || !res.art || !res.art.length) return "";
  const M = require("./game.cjs").ARTM || {}, names = res.art.map((id) => `「${(M[id] || {}).n || id}」`).join("、");
  return side === "att" ? `【名物】藏寶閣被砸毀,收藏不下的名物落入你手:${names}!` : `【名物】藏寶閣被砸毀,收藏不下的名物被敵軍奪走:${names}!`;
}
function conqText(cq, d, side) {
  if (!cq) return "";
  if (cq.cap) return side === "att" ? "【策反】行政官抵達了" + d + "的本丸,但本丸的家臣忠心耿耿,說服不了任何人,行政官平安撤回。" : "【策反】敵方的行政官潛入本丸,但家臣們忠心不二,策反失敗。";
  if (cq.taken) return side === "att" ? `【策反】${cq.admN} 名行政官輪番遊說,${d}的忠誠度從 ${cq.from} 一路降到 0,家臣紛紛歸順——這座城池現在是你的了!(行政官已留在當地輔佐,城內原有守軍全數離散)` : `【策反】敵方 ${cq.admN} 名行政官輪番遊說,忠誠度從 ${cq.from} 降到 0,家臣紛紛倒戈——這座城池失守了!`;
  return side === "att" ? `【策反】${cq.admN} 名行政官遊說家臣,每人使忠誠度下降約 ${cq.per},${d}的忠誠度 ${cq.from} → ${cq.to}。還沒到 0,需要再派行政官(行政官已留在當地,不會回來)。` : `【策反】敵方 ${cq.admN} 名行政官動搖了民心,忠誠度 ${cq.from} → ${cq.to}。忠誠度會隨時間慢慢回復(本丸御殿越高回復越快)。`;
}
// 開分城報告。res: { found:1, ok, why }
function buildFound(res, ctx) {
  const { attNick: a, attPos, defPos } = ctx;
  if (res.ok) return { att: { s: `【開墾】新城建立於(${defPos.x}|${defPos.y})`, b: `${fmtTime(ctx.arrAt)},${a}派出的 3 名開墾代官自(${attPos.x}|${attPos.y})長途跋涉,抵達了(${defPos.x}|${defPos.y})。\n\n他們在此插下旗幟、平整土地、築起第一座知行所的地基——一座新的分城就此誕生!\n\n新城有 ${G.NSLOTS} 塊空地,資源很少,先蓋知行所吧。新城有 2 個遊戲日(真實 2 天)的新手保護。\n用左上角的城池選單可以切換管理。` }, def: null };
  return { att: { s: `【開墾】(${defPos.x}|${defPos.y})建城失敗`, b: `${fmtTime(ctx.arrAt)},${a}的開墾代官抵達了(${defPos.x}|${defPos.y}),但是——\n${res.why || "無法在此建城"}\n\n開墾代官正在返回中。` }, def: null };
}
// 偵察報告。res: G.scoutBattle 的結果
function buildScout(res, ctx) {
  const { attNick: a, defNick: d, attPos, defPos } = ctx;
  const aFac = res.attFac, dFac = res.defFac, sentN = sum(res.sent), deadN = sum(res.deadA);
  const caught = res.lossFrac > 0;
  if (!res.ok) {
    return {
      att: { s: `【偵察】${d}:偵察失敗`, b: `${fmtTime(ctx.arrAt)},${a}派出的 ${sentN} 名偵察兵潛入(${defPos.x}|${defPos.y}),卻被${d}的偵察兵一一識破,全數被擊殺,沒有帶回任何情報。` },
      def: { s: `【警戒】擊退了${a}的偵察兵`, b: `${fmtTime(ctx.arrAt)},${a}(${attPos.x}|${attPos.y})派出 ${sentN} 名偵察兵窺探城池,被我方偵察兵全數識破、擊殺。` },
    };
  }
  const r = res.rep, names = (arr) => arr.map((n, k) => (n > 0 ? `${G.UN[dFac][k].n}×${n}` : "")).filter(Boolean).join("、") || "無";
  const bl = Object.entries(r.bld).map(([id, l]) => `${(G.B.find((x) => x.id === id) || { n: id }).n} Lv${l}`).join("、") || "無";
  const body = [
    `${fmtTime(ctx.arrAt)},${a}派出的 ${sentN} 名偵察兵潛入${d}的城池(${defPos.x}|${defPos.y}),帶回了以下情報:`,
    `【資源】${RES.map((n, i) => `${n} ${r.res[i]}`).join("、")}\n(埋藏所可藏匿每種資源約 ${r.hide} 單位,這部分搶不走)`,
    `【守軍】${names(r.u)}`,
    `【城牆】${r.wall > 0 ? `${G.F[dFac].w.n} 等級 ${r.wall}` : "尚未築起城牆"}`,
    `【建築】${bl}`,
    caught ? `偵察兵在潛入時被對方的偵察兵發現,折損 ${deadN} 人,對方已經知道有人在窺探。` : "偵察兵全員平安撤出,對方毫不知情。",
    "部隊正在返回中。",
  ].join("\n\n");
  return {
    att: { s: `【偵察】${d}:情報到手`, b: body },
    def: caught ? { s: `【警戒】發現${a}的偵察兵`, b: `${fmtTime(ctx.arrAt)},${a}(${attPos.x}|${attPos.y})派出 ${sentN} 名偵察兵潛入城中,被我方偵察兵發現並擊殺 ${deadN} 人,但仍有人帶著情報逃脫。` } : null,
  };
}
// res: G.pvpBattle 的結果;ctx: { id, attNick, defNick, attPos, defPos, arrAt, dist }
function build(res, ctx) {
  const { id, attNick: a, defNick: d, attPos, defPos } = ctx;
  if (res.void || res.fizzled) {
    const why = res.fizzled ? "出兵的紀錄在途中遺失,部隊已經折返。" : res.why === "protected" ? `${d}的城池正受新手保護,部隊無法開戰,已經折返。` : `${d}的城池已經不在了,部隊撲了個空,已經折返。`;
    return { att: { s: `【戰報】進攻${d}:未能開戰`, b: `${a}軍的前鋒抵達了(${defPos.x}|${defPos.y}),但是——\n${why}\n\n部隊正在返回中。` }, def: null };
  }
  const aFac = res.attFac, dFac = res.defFac;
  const sentN = sum(res.sent), deadA = sum(res.deadA), survN = sum(res.surv);
  const defN = sum(res.defBefore), deadD = sum(res.deadD);
  const ratio = res.D > 0 ? res.A / res.D : 99;
  const weather = pick(WEATHER, id, "w"), approach = pick(APPROACH, id, "a"), first = pick(CLASH_FIRST, id, "c");
  const wallName = G.F[dFac].w.n, cave = res.caveLv > 0 ? `城內的埋藏所(等級 ${res.caveLv})藏起了約 ${res.hide} 單位資源,沒有被搶走。` : "";
  const lootTxt = res.win ? RES.map((n, i) => `${n} ${res.loot[i]}`).join("、") : "無";
  const defMain = defN > 0 ? mainUnit(dFac, res.defBefore) : null, attMain = mainUnit(aFac, res.sent);
  const setting = `${fmtTime(ctx.arrAt)},${weather}。${a}率領 ${sentN} 名將士(${unitsText(aFac, res.sent)}),${approach},自(${attPos.x}|${attPos.y})行軍 ${ctx.dist.toFixed(1)} 格,兵臨${d}(${defPos.x}|${defPos.y})城下。`;
  const defense = defN > 0 ? `${d}軍據${wallName}${res.wallLv > 0 ? `(等級 ${res.wallLv},守備 +${res.wallPct}%)` : "(尚未築起城牆)"}嚴陣以待,城中守軍 ${defN} 人,以${defMain}為主力。` : `${d}的城池幾乎沒有守軍,${res.wallLv > 0 ? `只靠${wallName}(等級 ${res.wallLv})勉強支撐。` : "城牆也尚未築起。"}`;
  let clash;
  if (res.win && ratio >= 2.5) clash = `${attMain}一輪衝鋒便撕開了防線,守軍陣腳大亂,幾乎無力還手。`;
  else if (res.win) clash = `雙方在城門前纏鬥良久,${attMain}付出了沉重的代價,終於在黃昏前壓倒了守軍。`;
  else if (ratio >= 0.75) clash = `攻方一度逼近城門,卻被${defMain || "守軍"}死死頂住,功虧一簣。`;
  else clash = `攻方的攻勢在${wallName}前被一再擊退,守軍反擊如潮,陣線全面潰散。`;
  const firstCav = (fac, arr) => { const k = arr.findIndex((n, i) => n > 0 && G.UN[fac][i].b === "cavb"); return k >= 0 ? G.UN[fac][k].n : null; };
  const attCav = firstCav(aFac, res.sent);
  const mid = attCav
    ? pick([`${attCav}自側翼迂迴,企圖衝散守軍的陣腳。`, `${attCav}捲起漫天塵土,從城側繞向守軍後方。`], id, "m1")
    : pick([`${attMain}舉盾列陣,頂著矢石一步步逼近城門。`, `${attMain}扛著長槍與雲梯,在箭雨中向城牆推進。`], id, "m1");
  const mid2 = defN > 0
    ? pick([`${defMain}自${wallName}後方一輪輪齊射,擋住了攻方的腳步。`, `${d}軍的${defMain}死守缺口,與攻方殺得難分難解。`], id, "m2")
    : "城內幾乎沒有人抵抗。";
  const battle = `${first}${mid}${mid2}`;
  const strength = `雙方戰力:攻方 ${res.A} 對 守方 ${res.D}。`;
  const tAtt = `【我方】出陣 ${sentN} 人 → 陣亡 ${deadA} 人 → 生還 ${survN} 人\n${table(aFac, res.sent, res.deadA, true, ["出陣", "陣亡"])}`;
  const tDef = `【敵方】守軍 ${defN} 人 → 陣亡 ${deadD} 人\n${table(dFac, res.defBefore, res.deadD, true, ["原有", "陣亡"])}`;
  const closerW = pick(CLOSERS_WIN, id, "cw"), closerL = pick(CLOSERS_LOSE, id, "cl");
  const attBody = [
    setting, defense, battle, clash, strength, siegeText(res.sg, dFac), conqText(res.conq, d, "att"), heroText(res.hero, "att", { win: res.win, seed: id, fac: aFac, target: d }), artText(res, "att"),
    res.win ? `結果:大獲全勝!${a}軍攻破${d}的防線。` : `結果:敗北。${a}軍未能攻下${d}的城池,${survN > 0 ? "殘部正在撤退。" : "全軍覆沒。"}`,
    tAtt, tDef.replace("【敵方】", "【對手】"),
    res.win ? `【戰利品】${lootTxt}(部隊返回後入庫)${cave ? "\n" + cave : ""}\n部隊正在返回中。` : (survN > 0 ? "部隊正在返回中。" : ""),
    res.win ? closerW : closerL,
  ].filter(Boolean).join("\n\n");
  const defBody = [
    `${fmtTime(ctx.arrAt)},${weather}。${a}(${attPos.x}|${attPos.y})的軍勢 ${sentN} 人(${unitsText(aFac, res.sent)})殺到城下。`,
    defense, battle.replace(attMain, `敵軍的${attMain}`).replace(attCav || "\u0000", `敵軍的${attCav}`), clash.replace(attMain, `敵軍的${attMain}`), strength, siegeText(res.sg, dFac), conqText(res.conq, d, "def"), heroText(res.hero, "def", { win: res.win, seed: id, fac: aFac, target: d }), artText(res, "def"),
    res.win ? `結果:城池失守!守軍不敵,${a}軍搶掠而去。` : `結果:守城成功!${d}軍擊退了${a}的進攻。`,
    tDef.replace("【敵方】", "【我方】"), tAtt.replace("【我方】", "【敵方】"),
    res.win ? `【被搶走的資源】${lootTxt}${cave ? "\n" + cave : ""}` : "【被搶走的資源】無",
    res.win ? "別灰心,整頓軍備、築起更高的城牆、蓋好埋藏所,才能擋住下一次進攻。" : closerL.replace("敗軍之將不言勇,殘兵只能咬牙退回。", "敵軍丟下滿地的旗幟與武器,倉皇逃去。"),
  ].filter(Boolean).join("\n\n");
  const verdict = res.win ? "攻破" : "被擊退";
  return {
    att: { s: `【戰報】進攻${d}:${res.win ? "大捷" : "敗北"}`, b: attBody },
    def: { s: `【戰報】${a}來襲:${res.win ? "城池失守" : "守城成功"}`, b: defBody },
    verdict,
  };
}
module.exports = { heroText, build, buildScout, buildFound, fmtTime };
