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
const WEATHER = ["朝霧瀰漫", "細雨初歇", "烈日當空", "秋風蕭瑟", "夜色低垂", "殘雪未消", "晴空萬里", "陣風獵獵", "山嵐翻湧", "月隱雲間"];
const APPROACH = ["陣太鼓震天,大軍翻山越嶺", "軍配一揮,軍勢浩浩蕩蕩", "法螺貝長鳴,旌旗蔽野", "星夜兼程,銜枚疾進", "旗指物獵獵,足輕列陣而行"];
const CLASH_FIRST = ["兩軍甫一照面,箭矢如雨,", "雙方先以鐵砲與弓矢對射,硝煙瀰漫,", "陣太鼓聲未歇,先鋒已然撞在一處,", "喊殺聲震動山谷,", "一聲法螺貝響,兩軍同時掩殺而上,"];
const CLOSERS_WIN = ["戰國亂世,強者為尊,這一仗註定被寫進軍記。", "夕陽照著殘破的旗幟,勝負已分,勝鬨聲傳遍原野。", "此戰之後,城下之盟只是遲早的事。", "「天下布武」之路,又向前邁進了一步。"];
const CLOSERS_LOSE = ["敗軍之將不言勇,殘兵只能咬牙退回。", "此仇此恨,留待他日雪恥。", "守軍的勝鬨聲,在山谷間久久不散。", "勝敗乃兵家常事,重整旗鼓,再圖後舉。"];
const unitsText = (fac, arr) => arr.map((n, k) => (n > 0 ? `${G.UN[fac][k].n}×${n}` : "")).filter(Boolean).join("、") || "無";
const mainUnit = (fac, arr) => { let k = 0; arr.forEach((n, i) => { if (n > arr[k]) k = i; }); return G.UN[fac][k].n; };
function table(fac, a, b, c, labels) {
  const rows = [];
  a.forEach((n, k) => { if (n > 0 || (b && b[k] > 0)) rows.push(`  ${G.UN[fac][k].n}:${labels[0]} ${n}${c ? `,${labels[1]} ${b[k]}` : ""}${labels[2] ? `,${labels[2]} ${labels[3](k)}` : ""}`); });
  return rows.join("\n");
}
// 攻城段落:破門槌拆城牆、大筒類轟擊建築(沒有攻城器械時回傳空字串)。side: "att" 攻方視角 / "def" 守方視角;同一場戰鬥用 seed 固定句型
function siegeText(sg, dFac, side = "att", o = {}) {
  if (!sg) return "";
  const att = side === "att", sd = o.seed || "s", w = G.F[dFac].w.n;
  const names = (kind) => { const f = o.aFac, s = o.sent; if (!f || !s) return null; const l = []; s.forEach((n, i) => { if (n > 0 && G.UN[f][i].k === kind) l.push(G.UN[f][i].n); }); return l.length ? l.join("、") : null; };
  const ram = names("ram") || "破門槌", gun = names("cat") || "大筒";
  const L = [];
  if (sg.wall) {
    const d = sg.wall.from - sg.wall.to;
    if (d > 0) L.push(att
      ? pick([`${ram} ${sg.rams} 具在箭雨中硬頂上前,一下又一下猛撞${w},轟然巨響中,城牆從等級 ${sg.wall.from} 被撞到等級 ${sg.wall.to}。`, `足輕們推著 ${sg.rams} 具${ram}衝向${w}。木屑與石塵紛飛,城牆自等級 ${sg.wall.from} 崩落至等級 ${sg.wall.to}。`, `${ram}齊聲吶喊,猛撞${w}不休,城牆終於從等級 ${sg.wall.from} 裂至等級 ${sg.wall.to}。`], sd, "sw")
      : pick([`敵軍 ${sg.rams} 具${ram}頂著矢石撞向${w},轟然巨響中,城牆從等級 ${sg.wall.from} 崩落到等級 ${sg.wall.to}。`, `${w}在敵軍${ram}的撞擊下一寸寸龜裂,等級 ${sg.wall.from} 降為等級 ${sg.wall.to}。`], sd, "sw"));
    else L.push(att
      ? pick([`${ram} ${sg.rams} 具猛撞良久,${w}依然屹立不搖(等級 ${sg.wall.from})。`, `${ram}撞得木柄斷裂,卻只在${w}上留下道道白痕(等級 ${sg.wall.from})。`], sd, "sx")
      : pick([`敵軍 ${sg.rams} 具${ram}撞了半天,${w}巍然不動(等級 ${sg.wall.from})。`, `敵軍的${ram}在${w}前撞得七零八落,城牆毫髮無傷(等級 ${sg.wall.from})。`], sd, "sx"));
  } else if (sg.rams > 0) L.push(att ? `${ram}一路抬到城下,才發現此城根本沒有城牆可撞。` : `敵軍的${ram}抬到城下,卻無牆可撞,白費一番功夫。`);
  for (const h of sg.hits) {
    if (h.missing) L.push(att ? `${gun}瞄準${h.name},城中卻無此建築,砲彈盡數落空。` : `敵軍的${gun}朝${h.name}方向轟擊,但城中並無此建築,砲彈落在空地上。`);
    else if (h.to < h.from) {
      const gone = h.to < 1 ? "(夷為平地)" : "";
      L.push(att
        ? (h.rnd ? pick([`砲手並無明確目標,${gun}一陣亂轟,${h.name}從等級 ${h.from} 被打到等級 ${h.to}${gone}。`, `${gun}亂射一氣,偏偏打中了${h.name},從等級 ${h.from} 降為等級 ${h.to}${gone}。`], sd, "sr" + h.id)
          : pick([`砲手依軍令集中轟擊,${gun}怒吼不止,${h.name}從等級 ${h.from} 被打到等級 ${h.to}${gone}。`, `硝煙瀰漫之中,${gun}連發轟向${h.name},轟隆巨響過後,等級 ${h.from} 降為等級 ${h.to}${gone}。`], sd, "sd" + h.id))
        : pick([`敵軍的${gun}轟向${h.name},一聲聲巨響後,等級 ${h.from} 被打到等級 ${h.to}${gone}。`, `${h.name}在敵軍砲火中冒起濃煙,從等級 ${h.from} 降為等級 ${h.to}${gone}。`], sd, "sv" + h.id));
    } else L.push(att ? `${gun}轟向${h.name}(等級 ${h.from}),奈何火力不足,只留下滿牆焦痕。` : `敵軍的${gun}轟向${h.name}(等級 ${h.from}),只留下焦痕,${h.name}撐住了。`);
  }
  return L.length ? "【攻城】\n" + L.join("\n") : "";
}
// 營寨戰報(攻打野外營寨)。res: G.campBattle 的結果;ctx: { id, name, tx, ty, fac, attNick, arrAt }
const CAMP_FLAVOR = {
  "野盜砦": ["野盜們據著木柵,叫囂著要把來犯者的腦袋掛上寨門。", "寨門上插滿破旗,野盜頭領提著缺口的刀,獰笑著等在寨前。"],
  "一向一揆砦": ["寨中傳出整齊的唸佛聲,「進者往生極樂,退者無間地獄」的旗幡在風中翻飛。", "一揆門徒手持竹槍,眼神狂熱,誓與寨共存亡。"],
  "南蠻館": ["南蠻傭兵架起竹束與鐵砲,異國的旗幟在館頂獵獵作響。", "館前的戰犬低吼不止,南蠻鐵砲手已經裝好了火藥。"],
  "山賊山城": ["山賊盤踞險峻山城,箭樓上人影幢幢,滾木礌石堆滿隘口。", "山賊總頭目端坐城頭,冷眼俯視著來犯的軍勢。"],
  "石山本願寺": ["石山本願寺伽藍深處鐘聲長鳴,僧兵與門徒傾巢而出,誓死護法。", "本願寺的大將立於山門,背後是黑壓壓的一向宗門徒。"],
  "大筒陣地": ["竹束圍成層層矮牆,重裝大筒車黑洞洞的砲口,正對著來路。", "大筒陣地一片寂靜,只有砲手點燃火繩時的嗤嗤聲。"],
  "比叡山延曆寺": ["延曆寺的鐘聲響徹山谷,僧兵、戰犬與大筒布滿山道,這是連信長也要側目的鎮護之山。", "比叡山上殺氣沖天,守軍層層佈防,銅牆鐵壁般的陣勢令人望而生畏。"],
};
function buildCamp(res, ctx) {
  const { id, name, tx, ty, fac, attNick: a } = ctx, pos = `${name}(${tx}|${ty})`;
  const sentN = sum(res.sent), deadA = sum(res.deadA), ratio = res.D > 0 ? res.A / res.D : 99;
  const weather = pick(WEATHER, id, "w"), approach = pick(APPROACH, id, "a"), first = pick(CLASH_FIRST, id, "c");
  const main = mainUnit(fac, res.sent), fl = CAMP_FLAVOR[name] ? pick(CAMP_FLAVOR[name], id, "f") : "";
  const setting = `${fmtTime(ctx.arrAt)},${weather}。${a}舉兵 ${sentN} 人(${unitsText(fac, res.sent)}),${res.hero ? "武將領軍," : ""}${approach},陣取${pos}。${res.occupied ? "此寨已為他家駐兵所據。" : ""}${fl}`;
  let clash;
  if (res.win && ratio >= 2.5) clash = `${first}${main}一輪衝鋒便撕開寨門,守軍陣腳大亂,幾乎無力還手。`;
  else if (res.win) clash = `${first}雙方在寨前血戰良久,${main}付出慘重代價,終於在日暮前攻破營寨。`;
  else if (ratio >= 0.75) clash = `${first}攻方一度殺到寨門,卻被守軍死死頂住,功虧一簣。`;
  else clash = `${first}守軍居高臨下,反擊如潮,我軍陣線全面崩潰。`;
  const strength = `【兵力對比】我方攻擊 ${res.A}、守軍防禦 ${res.D}。`;
  const ht = heroText(res.hero, "att", { win: res.win, seed: id, fac, target: name, name: ctx.heroName });
  const loot = res.loot && res.loot.some((x) => x > 0) ? res.loot.join("/") : "";
  let tail;
  if (!res.win) tail = `【結果】敗走!全軍玉碎,守軍亦有折損。\n\n${pick(CLOSERS_LOSE, id, "cl")}`;
  else if (res.occupy) tail = `【結果】大勝!守軍盡數殲滅,${pos}落入我手。\n生還的 ${sum(res.garr)} 人留下駐守,營寨從今歸我方所有:此城每種資源產量 +${res.tier + 1}%。${loot ? `\n【分捕】${loot},已直接入庫。` : ""}\n\n${pick(CLOSERS_WIN, id, "cw")}`;
  else tail = `【結果】大勝!守軍盡數殲滅。${loot ? `\n【分捕】${loot}(待軍勢歸陣後入庫)。` : ""}\n守軍雖已全滅,但${ctx.noOcc ? "此營寨無法佔領,只能掠奪" : !res.hero ? "未有武將領軍,無法佔領營寨,也帶不回名物" : "此營寨不在這座城 15×15 範圍內,或評定眾的佔領名額已滿,故未能佔領"}(營寨回歸無主,待其重新集結)。\n軍勢收兵,正踏上歸途。\n\n${pick(CLOSERS_WIN, id, "cw")}`;
  const tbl = `【我軍】出陣 ${sentN} 人 → 陣亡 ${deadA} 人\n${table(fac, res.sent, res.deadA, true, ["出陣", "陣亡"])}`;
  return [setting, clash, strength, ht, tail.split("\n\n")[0], tbl, tail.split("\n\n").slice(1).join("\n\n")].filter(Boolean).join("\n\n");
}
// 行政官說服家臣:降低忠誠度,歸零時城池易主(res.conq 由 G.pvpBattle 算出)
// 武將的戰場畫面(熱血戰記口吻)。o:{win, seed, fac, target, name};同一場戰鬥用 seed 固定句型
const HERO_STYLE = { wei: ["第六天魔王的旗幟在他身後獵獵作響", "織田的赤色軍旗映紅了戰場"], shu: ["三河武士的忍耐在這一刻化為怒濤", "德川的葵紋旗在硝煙中屹立不搖"], wu: ["猴子出身的氣魄壓過了千軍萬馬", "豐臣的金瓢旗在陣前高高舉起"] };
function heroText(h, side, o = {}) {
  if (!h) return "";
  const n = h.n || o.name || "武將", sd = o.seed || n, t = o.target || "敵陣", fac = (G.F && o.fac && HERO_STYLE[o.fac]) ? o.fac : "wei";
  const style = pick(HERO_STYLE[fac], sd, "hs");
  if (side === "att") {
    if (h.dead) return `【武將】${pick([
      `${style}。${n}一馬當先殺入${t}的陣中,太刀所向,敵兵紛紛倒退。然而亂箭如雨,他渾身浴血,仍高呼「衝!」,直到力竭倒下。`,
      `${n}橫刀立馬,獨自擋在潰散的友軍之前。${t}的守軍蜂擁而上,他連斬數人,終因寡不敵眾,戰死沙場。其忠勇,三軍無不嘆服。`,
      `${style}。${n}親自率領前鋒突擊,卻在${t}的亂軍中中了埋伏,倒在血泊之中,雙眼仍望著前方。`,
    ], sd, "hd")}(需至評定眾復活)`;
    if (o.win) return `【武將】${pick([
      `${style}。${n}一馬當先,太刀劈開${t}的防線,身後的將士齊聲吶喊,勢如破竹。此戰他獲得 ${h.xp} 點經驗。`,
      `${n}高舉軍旗,在箭雨中率隊猛衝,連破數道防線,最後親手拔下${t}的守旗,三軍為之振奮。此戰獲得 ${h.xp} 點經驗。`,
      `${style}。${n}與守軍的主將正面交鋒,數十回合後一刀將其斬於馬下,${t}的抵抗就此瓦解。此戰獲得 ${h.xp} 點經驗。`,
    ], sd, "hw")}`;
    return `【武將】${pick([
      `${n}在亂軍中奮力殺出一條血路,護著殘部一步步撤離${t}。雖然兵敗,他的背影依然讓追兵不敢逼近。獲得 ${h.xp} 點經驗。`,
      `${style}。可惜${t}的守備太過堅固,${n}咬牙下令收兵,親自斷後,保住了最後的火種。獲得 ${h.xp} 點經驗。`,
    ], sd, "hl")}`;
  }
  if (h.dead) return `【敵將】敵方武將${n}在陣前力戰而亡,他的軍旗倒在城下,敵軍士氣為之崩潰。`;
  return `【敵將】${pick([
    `敵方武將${n}一馬當先衝在最前面,${o.win ? "雖然最後攻破了防線,守軍也讓他付出了代價。" : "卻被守軍頂住,只能悻悻撤退。"}`,
    `敵方武將${n}揮旗督戰,殺聲震天,${o.win ? "這股氣勢讓守軍節節敗退。" : "終究沒能撕開防線。"}`,
  ], sd, "he")}`;
}
function artText(res, side) {
  if (!res || !res.art || !res.art.length) return "";
  const M = require("./game.cjs").ARTM || {}, names = res.art.map((id) => `「${(M[id] || {}).n || id}」`).join("、");
  return side === "att" ? `【名物】藏寶閣被砸毀,收藏不下的名物落入你手:${names}!` : `【名物】藏寶閣被砸毀,收藏不下的名物被敵軍奪走:${names}!`;
}
function conqText(cq, d, side) {
  if (!cq) return "";
  if (cq.cap) return side === "att" ? "【策反】行政官抵達" + d + "的主城,然而家臣忠心耿耿,無人動搖,行政官平安撤回。" : "【策反】敵方的行政官潛入主城,但家臣們忠心不二,策反失敗。";
  if (cq.taken) return side === "att" ? `【策反】${cq.admN} 名行政官輪番遊說,${d}的忠誠度從 ${cq.from} 一路降到 0,家臣紛紛歸順——此城從今歸你所有!(行政官已留在當地輔佐,城內原有守軍全數離散)` : `【策反】敵方 ${cq.admN} 名行政官輪番遊說,忠誠度從 ${cq.from} 降到 0,家臣紛紛倒戈——此城易主了!`;
  return side === "att" ? `【策反】${cq.admN} 名行政官遊說家臣,每人使忠誠度下降約 ${cq.per},${d}的忠誠度 ${cq.from} → ${cq.to}。還沒到 0,需要再派行政官(行政官已留在當地,不會回來)。` : `【策反】敵方 ${cq.admN} 名行政官動搖了民心,忠誠度 ${cq.from} → ${cq.to}。忠誠度會隨時間慢慢回復(本丸御殿越高回復越快)。`;
}
// 開分城報告。res: { found:1, ok, why }
function buildFound(res, ctx) {
  const { attNick: a, attPos, defPos } = ctx;
  if (res.ok) return { att: { s: `【開墾】新城建立於(${defPos.x}|${defPos.y})`, b: `${fmtTime(ctx.arrAt)},${a}派出的 3 名開墾代官自(${attPos.x}|${attPos.y})長途跋涉,抵達(${defPos.x}|${defPos.y})。\n\n他們在此豎起旗幟、開墾荒地、奠下知行所的地基——一座新的分城就此誕生!\n\n新城有 ${G.NSLOTS} 塊空地,資源很少,先蓋知行所吧。新城有 2 個遊戲日(真實 2 天)的新手保護。\n用左上角的城池選單可以切換管理。` }, def: null };
  return { att: { s: `【開墾】(${defPos.x}|${defPos.y})建城失敗`, b: `${fmtTime(ctx.arrAt)},${a}的開墾代官抵達了(${defPos.x}|${defPos.y}),然而——\n${res.why || "無法在此建城"}\n\n開墾代官只得折返。` }, def: null };
}
// 偵察報告。res: G.scoutBattle 的結果
function buildScout(res, ctx) {
  const { attNick: a, defNick: d, attPos, defPos } = ctx;
  const aFac = res.attFac, dFac = res.defFac, sentN = sum(res.sent), deadN = sum(res.deadA);
  const caught = res.lossFrac > 0;
  if (!res.ok) {
    return {
      att: { s: `【諜報】${d}:潛入失敗`, b: `${fmtTime(ctx.arrAt)},${a}派出的 ${sentN} 名忍者潛入(${defPos.x}|${defPos.y}),卻被${d}的忍者一一識破、盡數斬殺,未能帶回任何情報。` },
      def: { s: `【警戒】擊退了${a}的忍者`, b: `${fmtTime(ctx.arrAt)},${a}(${attPos.x}|${attPos.y})派出 ${sentN} 名忍者窺探城池,被我方忍者盡數識破、擊殺。` },
    };
  }
  const r = res.rep, names = (arr) => arr.map((n, k) => (n > 0 ? `${G.UN[dFac][k].n}×${n}` : "")).filter(Boolean).join("、") || "無";
  const bl = Object.entries(r.bld).map(([id, l]) => `${(G.B.find((x) => x.id === id) || { n: id }).n} Lv${l}`).join("、") || "無";
  const body = [
    `${fmtTime(ctx.arrAt)},${a}派出的 ${sentN} 名忍者潛入${d}的城池(${defPos.x}|${defPos.y}),帶回以下密報:`,
    `【資源】${RES.map((n, i) => `${n} ${r.res[i]}`).join("、")}\n(埋藏所可藏匿每種資源約 ${r.hide} 單位,這部分搶不走)`,
    `【守軍】${names(r.u)}`,
    `【城牆】${r.wall > 0 ? `${G.F[dFac].w.n} 等級 ${r.wall}` : "尚未築起城牆"}`,
    `【建築】${bl}`,
    caught ? `忍者潛入時被對方的忍者察覺,折損 ${deadN} 人,對方已知有人窺探。` : "忍者全員平安撤出,對方毫不知情。",
    "軍勢收兵,正踏上歸途。",
  ].join("\n\n");
  return {
    att: { s: `【諜報】${d}:密報到手`, b: body },
    def: caught ? { s: `【警戒】發現${a}的忍者`, b: `${fmtTime(ctx.arrAt)},${a}(${attPos.x}|${attPos.y})派出 ${sentN} 名忍者潛入城中,被我方忍者察覺並斬殺 ${deadN} 人,但仍有人帶著情報逃脫。` } : null,
  };
}
// res: G.pvpBattle 的結果;ctx: { id, attNick, defNick, attPos, defPos, arrAt, dist }
function build(res, ctx) {
  const { id, attNick: a, defNick: d, attPos, defPos } = ctx;
  if (res.void || res.fizzled) {
    const why = res.fizzled ? "出陣的軍令在途中遺失,軍勢只得收兵。" : res.why === "protected" ? `${d}的城池尚在庇護之下,不可興兵,軍勢只得收兵。` : `${d}的城池已不復存在,軍勢撲了個空,只得收兵。`;
    return { att: { s: `【戰報】進攻${d}:未能交鋒`, b: `${a}軍的先鋒抵達(${defPos.x}|${defPos.y}),然而——\n${why}\n\n軍勢收兵,正踏上歸途。` }, def: null };
  }
  const aFac = res.attFac, dFac = res.defFac;
  const sentN = sum(res.sent), deadA = sum(res.deadA), survN = sum(res.surv);
  const defN = sum(res.defBefore), deadD = sum(res.deadD);
  const ratio = res.D > 0 ? res.A / res.D : 99;
  const weather = pick(WEATHER, id, "w"), approach = pick(APPROACH, id, "a"), first = pick(CLASH_FIRST, id, "c");
  const wallName = G.F[dFac].w.n, cave = res.caveLv > 0 ? `城內的埋藏所(等級 ${res.caveLv})藏起了約 ${res.hide} 單位資源,沒有被搶走。` : "";
  const lootTxt = res.win ? RES.map((n, i) => `${n} ${res.loot[i]}`).join("、") : "無";
  const defMain = defN > 0 ? mainUnit(dFac, res.defBefore) : null, attMain = mainUnit(aFac, res.sent);
  const setting = `${fmtTime(ctx.arrAt)},${weather}。${a}舉兵 ${sentN} 人(${unitsText(aFac, res.sent)}),${approach},自(${attPos.x}|${attPos.y})進軍 ${ctx.dist.toFixed(1)} 格,陣取${d}(${defPos.x}|${defPos.y})城下。`;
  const defense = defN > 0 ? `${d}軍據${wallName}${res.wallLv > 0 ? `(等級 ${res.wallLv},守備 +${res.wallPct}%)` : "(尚未築起城牆)"}嚴陣以待,城中守軍 ${defN} 人,以${defMain}為主力。` : `${d}的城池幾無守軍,${res.wallLv > 0 ? `只靠${wallName}(等級 ${res.wallLv})勉強支撐。` : "城牆也尚未築起。"}`;
  let clash;
  if (res.win && ratio >= 2.5) clash = `${attMain}一輪衝鋒便撕開防線,守軍陣腳大亂,幾乎無力還手。`;
  else if (res.win) clash = `雙方在城門前血戰良久,${attMain}付出慘重代價,終於在日暮前壓倒守軍。`;
  else if (ratio >= 0.75) clash = `攻方一度逼近城門,卻被${defMain || "守軍"}死死頂住,功虧一簣。`;
  else clash = `攻方在${wallName}前被一再擊退,守軍乘勢反攻,陣線全面崩潰。`;
  const firstCav = (fac, arr) => { const k = arr.findIndex((n, i) => n > 0 && G.UN[fac][i].b === "cavb"); return k >= 0 ? G.UN[fac][k].n : null; };
  const attCav = firstCav(aFac, res.sent);
  const mid = attCav
    ? pick([`${attCav}自側翼迂迴,直撲守軍本陣。`, `${attCav}捲起漫天塵土,繞向守軍後方。`], id, "m1")
    : pick([`${attMain}舉盾列陣,頂著矢石步步逼近城門。`, `${attMain}扛著長槍與雲梯,冒著箭雨攀向城牆。`], id, "m1");
  const mid2 = defN > 0
    ? pick([`${defMain}自${wallName}後一輪輪齊射,擋住攻方的腳步。`, `${d}軍的${defMain}死守缺口,與攻方殺得難解難分。`], id, "m2")
    : "城中幾乎無人抵抗。";
  const battle = `${first}${mid}${mid2}`;
  const strength = `【兵力對比】攻方 ${res.A} 對 守方 ${res.D}。`;
  const tAtt = `【我方】出陣 ${sentN} 人 → 陣亡 ${deadA} 人 → 生還 ${survN} 人\n${table(aFac, res.sent, res.deadA, true, ["出陣", "陣亡"])}`;
  const tDef = `【敵方】守軍 ${defN} 人 → 陣亡 ${deadD} 人\n${table(dFac, res.defBefore, res.deadD, true, ["原有", "陣亡"])}`;
  const closerW = pick(CLOSERS_WIN, id, "cw"), closerL = pick(CLOSERS_LOSE, id, "cl");
  const attBody = [
    setting, defense, battle, clash, strength, siegeText(res.sg, dFac, "att", { seed: id, aFac, sent: res.sent }), conqText(res.conq, d, "att"), heroText(res.hero, "att", { win: res.win, seed: id, fac: aFac, target: d }), artText(res, "att"),
    res.win ? `【結果】大勝!${a}軍攻破${d}的防線,城頭換上了我軍的旗幟。` : `【結果】敗走。${a}軍攻不下${d}的城池,${survN > 0 ? "殘兵負傷收兵。" : "全軍玉碎,無一生還。"}`,
    tAtt, tDef.replace("【敵方】", "【對手】"),
    res.win ? `【分捕】${lootTxt}(待軍勢歸陣後入庫)${cave ? "\n" + cave : ""}\n軍勢收兵,正踏上歸途。` : (survN > 0 ? "軍勢收兵,正踏上歸途。" : ""),
    res.win ? closerW : closerL,
  ].filter(Boolean).join("\n\n");
  const defBody = [
    `${fmtTime(ctx.arrAt)},${weather}。${a}(${attPos.x}|${attPos.y})的軍勢 ${sentN} 人(${unitsText(aFac, res.sent)})壓境,直逼城下。`,
    defense, battle.replace(attMain, `敵軍的${attMain}`).replace(attCav || "\u0000", `敵軍的${attCav}`), clash.replace(attMain, `敵軍的${attMain}`), strength, siegeText(res.sg, dFac, "def", { seed: id, aFac, sent: res.sent }), conqText(res.conq, d, "def"), heroText(res.hero, "def", { win: res.win, seed: id, fac: aFac, target: d }), artText(res, "def"),
    res.win ? `【結果】城池陷落!守軍不敵,${a}軍大肆掠奪而去。` : `【結果】守城成功!${d}軍擊退了${a}的來襲,敵軍丟盔棄甲而逃。`,
    tDef.replace("【敵方】", "【我方】"), tAtt.replace("【我方】", "【敵方】"),
    res.win ? `【遭掠奪的資源】${lootTxt}${cave ? "\n" + cave : ""}` : "【遭掠奪的資源】無",
    res.win ? "勝敗乃兵家常事。整頓軍備、加高城牆、築好埋藏所,方能擋住下一次來襲。" : closerL.replace("敗軍之將不言勇,殘兵只能咬牙退回。", "敵軍丟下滿地的旗指物與兵器,倉皇潰逃。"),
  ].filter(Boolean).join("\n\n");
  const verdict = res.win ? "攻破" : "被擊退";
  return {
    att: { s: `【戰報】進攻${d}:${res.win ? "大勝" : "敗走"}`, b: attBody },
    def: { s: `【戰報】${a}來襲:${res.win ? "城池陷落" : "擊退來襲"}`, b: defBody },
    verdict,
  };
}
module.exports = { heroText, build, buildScout, buildFound, buildCamp, fmtTime };
