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
    setting, defense, battle, clash, strength,
    res.win ? `結果:大獲全勝!${a}軍攻破${d}的防線。` : `結果:敗北。${a}軍未能攻下${d}的城池,${survN > 0 ? "殘部正在撤退。" : "全軍覆沒。"}`,
    tAtt, tDef.replace("【敵方】", "【對手】"),
    res.win ? `【戰利品】${lootTxt}(部隊返回後入庫)${cave ? "\n" + cave : ""}\n部隊正在返回中。` : (survN > 0 ? "部隊正在返回中。" : ""),
    res.win ? closerW : closerL,
  ].filter(Boolean).join("\n\n");
  const defBody = [
    `${fmtTime(ctx.arrAt)},${weather}。${a}(${attPos.x}|${attPos.y})的軍勢 ${sentN} 人(${unitsText(aFac, res.sent)})殺到城下。`,
    defense, battle.replace(attMain, `敵軍的${attMain}`).replace(attCav || "\u0000", `敵軍的${attCav}`), clash.replace(attMain, `敵軍的${attMain}`), strength,
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
module.exports = { build, fmtTime };
