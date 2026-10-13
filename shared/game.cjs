// 遊戲規則:同時給瀏覽器(dist/game.js)和 Netlify 函式(server-core.cjs)使用。
// 沒有任何畫面相關的程式,所有操作都透過 perform() 進行。
const G=(()=>{
const SPEED=60,CD=6*3600,CAMP_RESPAWN=12*3600,STASH_MULT=3,TRAIN_QMAX=10,DEMOLISH_GOV=3,NSLOTS=27,NU=10,TRB=['infb','cavb','wsh','pal'],MULTI=['wh','gr','cave']; // 城內 21 塊建地;藏屋敷、米藏、埋藏所在舊的升到滿級後可再蓋新的
const GOLD_RATE=200,EXCHANGE_COST=1,PROTECT_DAYS=2; // 1 金幣買 200 單位資源;平倉每次 1 金幣;新手保護 2 個真實日(依開城時間 born 計算,與時間倍率無關)
const RN=['木材','泥土','鐵塊','糧食'],FN=['伐木場','泥坑','鐵礦場','農田'];
const FT=[0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,3,3];
const FC=[[40,100,50,60],[80,40,80,50],[100,80,30,60],[70,90,70,20]];
const F={
 wei:{n:'織田家',s:'織',t:'織田',d:'以「天下布武」為目標。知行所可讓外城與內城同時施工;木柵防禦強但耐久低;內政指令最多(勸農、御用金、普請)。',w:{n:'木柵',r:[90,150,60,70]}},
 shu:{n:'德川家',s:'德',t:'德川',d:'以忍耐與穩健著稱,三河武士忠勇善戰。軍隊多為高防禦的鐵砲與足輕;石垣耐久高。德川家出兵攻擊時,對方埋藏所的效果只有 2/3。外城與內城共用一條施工佇列。',w:{n:'石垣',r:[60,130,100,80]}},
 wu:{n:'豐臣家',s:'豐',t:'豐臣',d:'從足輕崛起的天下人。埋藏所的容量為兩倍;土壘漆壁防禦中等;兵種成本低廉。外城與內城共用一條施工佇列。',w:{n:'土壘漆壁',r:[100,110,100,60]}}};

const W={wei:[0,4,7,11,14,18,21,25,28,32,35,39,42,46,49,53,56,60,63,67,70],wu:[0,3,6,9,12,15,18,21,24,27,30,33,36,39,42,45,48,51,54,57,60],shu:[0,3,5,8,10,13,15,18,20,23,25,28,30,33,35,38,40,42,45,47,50]};
// 單位:[名稱,攻,步防,騎防,速度,攜帶,耗糧,木,泥,鐵,糧,訓練秒數, 特殊類別k, 訓練建築b, 兵學塾解鎖等級lv, 尚未開放soon]
// k:scout 偵察 / ram 破門槌(拆城牆) / cat 大筒類(可指定建築) / adm 行政官 / set 開墾代官
const mk=a=>({n:a[0],a:a[1],di:a[2],dc:a[3],s:a[4],c:a[5],up:a[6],r:a.slice(7,11),t:a[11],k:a[12]||'',b:a[13]||(a[4]>=10?'cavb':'infb'),lv:a[14]||0,soon:a[15]||0});
const LV=[0,1,3,7,10]; // 兵學塾等級:原有 5 種兵依序解鎖
const UN={
 wei:[['足輕長槍兵',40,40,30,7,50,1,115,80,160,35,1040],['旗本武士',70,35,30,6,40,1,150,110,180,65,1200],['赤母衣眾',90,50,50,14,90,2,400,280,360,120,1600],['黑印狀武者',60,80,120,12,80,3,550,400,320,130,2200],['織田精銳騎',180,80,100,10,70,4,550,600,650,200,2800],
  ['忍騎',0,20,10,16,0,2,130,130,20,40,960,'scout','cavb',3],['破門槌',60,30,75,4,0,3,900,300,600,70,3600,'ram','wsh',10],['大筒',50,60,10,3,0,6,1000,1500,650,100,9000,'cat','wsh',15],['管領',50,40,30,4,0,4,25000,35000,50000,40000,72000,'adm','pal',20],['開墾代官',10,80,80,5,3000,1,5500,5000,7000,5000,19200,'set','pal',5]].map(mk),
 shu:[['鄉士足輕',40,20,10,8,60,1,90,70,50,40,640],['三河武士',15,30,50,7,40,1,150,70,75,40,800],['鐵砲組',70,100,85,5,30,1,400,250,400,60,2000],['竹束安宅車',85,100,75,10,110,2,550,270,290,75,2000],['武田赤備騎',150,60,90,13,80,3,450,515,480,80,2400],
  ['伊賀忍者',0,10,5,9,0,1,120,100,50,50,800,'scout','infb',3],['龜甲車',65,30,80,4,0,3,800,500,400,70,3600,'ram','wsh',10],['飛石機',45,60,10,3,0,6,800,1600,750,100,9000,'cat','wsh',15],['軍配者',40,60,40,4,0,4,30000,30000,50000,40000,72000,'adm','pal',20],['開墾代官',10,80,80,5,3000,1,5000,5500,5000,7000,19200,'set','pal',5]].map(mk),
 wu:[['國人眾',20,30,45,7,40,1,100,120,50,50,720],['弓足輕',15,50,35,7,50,1,120,90,120,50,800],['雜賀眾',60,35,40,8,60,1,170,150,160,50,1120],['馬廻眾',90,120,60,10,70,2,360,350,300,120,2000],['水軍武者',130,60,150,12,100,3,500,550,600,200,2400],
  ['早馬眾',0,20,10,17,0,2,120,130,20,50,960,'scout','cavb',3],['攻城槌',55,30,105,4,0,3,850,550,350,80,3600,'ram','wsh',10],['焙烙火砲車',40,45,10,3,0,6,1050,1500,600,100,9000,'cat','wsh',15],['水軍頭領',40,50,50,5,0,4,32500,27500,50000,40000,72000,'adm','pal',20],['開墾代官',10,80,80,5,3000,1,7000,5000,5000,5500,19200,'set','pal',5]].map(mk)};
for(const f of['wei','shu','wu'])UN[f].forEach((u,i)=>{if(i<5)u.lv=LV[i]});
const UDESC={"足輕長槍兵": "戰國普遍的主力長槍足輕部隊", "旗本武士": "主公身邊近衛精銳武士", "赤母衣眾": "信長麾下勇猛的騎兵傳令與突擊隊", "忍騎": "負責快速搜集情報與敵情偵察的騎馬忍軍", "黑印狀武者": "具備堅實防禦力的重裝武士騎兵隊", "織田精銳騎": "極具破壞力的頂級主力突擊騎兵", "破門槌": "用於撞擊城門的傳統攻城器具", "大筒": "戰國時期使用的大型火炮/大砲", "管領": "幕府與大名麾下的最高行政主管", "開墾代官": "負責領地開發與建立新城池的官員", "鄉士足輕": "地方徵召的基礎快速步兵", "三河武士": "以堅忍、忠誠與強悍著稱的防禦精銳", "鐵砲組": "最具殺傷力的高輸出火繩槍部隊", "伊賀忍者": "潛伏敵後探查敵情的諜報人員", "竹束安宅車": "設有竹束防禦的攻防推進戰車", "武田赤備騎": "以勇猛與強悍衝鋒力著稱的精銳騎兵", "龜甲車": "包覆鐵皮或濕牛皮的衝城器具", "飛石機": "遠程投射巨石的攻城器械", "軍配者": "大名身邊負責戰略與戰術指導的參謀", "普請頭": "負責建築、築城與土地開發的工兵組長", "國人眾": "地方豪族與民間組成的自衛武裝", "弓足輕": "使用和弓進行遠程支援的步兵", "早馬眾": "高速移動、負責訊息傳遞與騷擾的輕騎", "雜賀眾": "熟諳特殊地形與靈活戰術的精銳傭兵", "馬廻眾": "大名身邊直轄的親衛精銳部隊", "水軍武者": "兼具陸戰與水陸優勢的高級重裝騎兵", "攻城槌": "用於破壞敵城防禦設施的衝擊器具", "焙烙火砲車": "攜帶火藥與火攻特性的攻城拋射器具", "水軍頭領": "統轄水陸全軍的最高軍事指揮官", "拓墾奉行": "負責開拓新領地與建城的行政官員", "野盜": "盤踞山林掠奪的流民武裝", "南蠻傭兵": "帶有異國防具與武器的海外傭兵", "一向一揆門徒": "由宗教信仰發動起義的農民信徒武裝", "竹束防護眾": "裝備特殊竹甲、具備防護力的浪人", "野盜頭領": "野外中階賊寇指揮官", "一向一揆坊官": "起義宗教軍的基層組織者與僧兵", "山賊總頭目": "強悍的山林匪幫大頭領", "戰犬眾": "訓練猛獸作戰的特殊野外單位", "一向一揆大將": "規模龐大的宗教起義軍核心大將", "重裝大筒車": "大型巨獸或巨型重裝攻城機具單位"};
['wei','shu','wu'].forEach(f=>UN[f].forEach(u=>u.desc=UDESC[u.n]||''));
const N={野盜:[20,20,15],南蠻傭兵:[25,40,35],一向一揆門徒:[50,30,40],竹束防護眾:[70,65,55],野盜頭領:[70,50,65],一向一揆坊官:[100,70,80],山賊總頭目:[250,120,180],戰犬眾:[300,240,360],一向一揆大將:[400,220,200],重裝大筒車:[600,440,520]};
// 舊存檔裡營寨守軍的名稱對照(三國版 → 戰國版)
const OLDN={山賊:'野盜',南蠻兵:'南蠻傭兵',黃巾軍:'一向一揆門徒',藤甲兵:'竹束防護眾',山賊頭目:'野盜頭領',黃巾軍頭目:'一向一揆坊官',山賊首領:'山賊總頭目',猛獸兵:'戰犬眾',黃巾軍將領:'一向一揆大將',象兵:'重裝大筒車'};
const hash=(x,y,s)=>{let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul((s||0)|0,2147483647);h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296};
const mod=(a,m)=>((a%m)+m)%m;
const TIERS=[
 {n:'野盜砦',e:'🏕️',g:{野盜:20,野盜頭領:3}},
 {n:'一向一揆砦',e:'🚩',g:{一向一揆門徒:30,一向一揆坊官:5}},
 {n:'南蠻館',e:'⛵',g:{南蠻傭兵:30,竹束防護眾:20,戰犬眾:2}},
 {n:'山賊山城',e:'⛰️',g:{野盜:40,野盜頭領:10,山賊總頭目:6}},
 {n:'石山本願寺',e:'🛕',g:{一向一揆門徒:60,一向一揆坊官:10,一向一揆大將:4}},
 {n:'大筒陣地',e:'💣',g:{竹束防護眾:30,重裝大筒車:8}}];
const ZG={x:4,y:1};
const defOf=g=>Object.entries(g).reduce((a,[u,c])=>a+c*(N[u][1]+N[u][2])/2,0);
function npcAt(x,y){
 if(x===ZG.x&&y===ZG.y)return {n:'菩提山城',e:'🏯',zg:1};
 if(mod(x,3)!==1||mod(y,3)!==1)return null;
 if(hash(x,y,1)>0.45)return null;
 const t=TIERS[Math.min(5,Math.floor(Math.hypot(x,y)/9))],k=.8+hash(x,y,2)*.5,g={};
 for(const [u,c] of Object.entries(t.g))g[u]=Math.max(1,Math.round(c*k));
 const def=defOf(g);
 return {n:t.n,e:t.e,g,def,stash:Math.floor(def*0.5*STASH_MULT)}}
// 營寨的狀態(每位玩家各自一份):被打過會損兵、庫存會減少,隔一段時間重新集結
function campGet(x,y){const key=x+','+y,n=npcAt(x,y);if(!n||n.zg)return null;let c=S.camps[key];
 if(c&&S.t-c.t>=CAMP_RESPAWN){delete S.camps[key];c=null}
 if(!c)return {n,key,fresh:true,g:{...n.g},st:[n.stash,n.stash,n.stash,n.stash],t:S.t};
 return {n,key,fresh:false,g:c.g,st:c.st,t:c.t}}
function campInfo(x,y){const c=campGet(x,y);if(!c)return null;const left=c.fresh?null:Math.max(0,CAMP_RESPAWN-(S.t-c.t));
 return {n:c.n,g:c.g,def:defOf(c.g),st:c.st,respawnIn:left,empty:defOf(c.g)===0&&c.st.every(v=>v<=0)}}
const B=[
 {id:'gov',n:'知行所',p:2,r:[55,45,45,30],t:1200,m:20,d:'知府辦公的地方。知行所等級越高,其他建築與資源的開發速度越快,最多縮短 50%。織田家可同時開發資源和興建建築。'},
 {id:'wh',n:'藏屋敷',p:1,r:[125,145,80,35],t:1000,m:20,d:'存放木材、泥土、鐵塊。等級越高,容量越大。',q:{gov:1}},
 {id:'gr',n:'米藏',p:1,r:[75,90,75,20],t:900,m:20,d:'存放糧食。等級越高,容量越大。',q:{gov:1}},
 {id:'cave',n:'埋藏所',p:0,r:[35,50,25,10],t:480,m:10,d:'敵人來襲時,可以藏起部分資源以免被掠走。豐臣家的埋藏所容量為兩倍。'},
 {id:'war',n:'軍奉行',p:3,r:[100,160,70,70],t:800,m:20,d:'調度軍隊的地方。有了軍奉行才能調派軍隊出征。升到 10 級,可以指定大筒、飛石機、焙烙火砲車攻擊敵城的 1 處目標建築;升到 20 級可以同時指定 2 處。(未達 10 級時,攻城器械會隨機轟擊一處建築。)'},
 {id:'infb',n:'足輕營',p:4,r:[200,120,240,120],t:800,m:20,d:'訓練步兵的場所,等級越高訓練越快。',q:{war:1,gov:3}},
 {id:'acad',n:'兵學塾',p:1,r:[180,150,90,50],t:800,m:20,d:'研究新兵種的地方。兵學塾的等級決定可以訓練哪些兵種:1 級解鎖第二種兵、3 級解鎖第三種兵與偵察兵、5 級開墾代官、7 級第四種兵、10 級最精銳的騎兵與破門槌、15 級大筒類攻城器械、20 級行政官。',q:{infb:3,gov:3}},
 {id:'smi',n:'刀鍛冶所',p:4,r:[130,170,400,120],t:800,m:20,d:'研究武器裝備。兵種攻擊每級增加基礎值的 1.5%(原作需逐兵種研究,本版簡化為全軍)。',q:{acad:3}},
 {id:'arm',n:'具足屋',p:3,r:[140,200,360,120],t:800,m:20,d:'研究防禦裝備。兵種防禦每級增加基礎值的 1.5%(原作需逐兵種研究,本版簡化為全軍)。',q:{acad:1}},
 {id:'cavb',n:'馬廻組',p:4,r:[200,140,200,130],t:870,m:20,d:'訓練騎兵的場所,等級越高訓練越快。',q:{smi:3,acad:5}},
 {id:'mill',n:'精米所',p:4,r:[500,450,300,1250],t:1600,m:5,d:'加工糧食,每級增加 5% 的糧食產量,共 5 級。',q:{f3:5}},
 {id:'lum',n:'製材所',p:5,r:[400,350,400,100],t:2200,m:5,d:'加工木料,每級增加 5% 的木材產量,共 5 級。',q:{f0:10,gov:5}},
 {id:'kiln',n:'瓦窯',p:5,r:[400,475,300,75],t:2000,m:5,d:'增加土石產量,每級增加 5%,共 5 級。',q:{f1:10,gov:5}},
 {id:'smel',n:'採礦精鍊所',p:6,r:[200,400,500,150],t:2800,m:5,d:'冶煉金屬,每級增加 5% 的金屬產量,共 5 級。',q:{f2:10,gov:5}},
 {id:'cnl',n:'評定眾',p:2,r:[600,550,500,300],t:870,m:20,d:'掌管家臣任免的評定之所,可以將士兵提拔為英雄,英雄能率軍攻佔野外據點。(英雄系統尚未開放,目前只能先蓋起來。)',q:{gov:3,war:1}},
 {id:'wsh',n:'鍛冶場',p:4,r:[400,450,600,300],t:1330,m:20,d:'製造破門槌與大筒、飛石機、焙烙火砲車等攻城器械的作坊。等級越高,製造越快。器械需要兵學塾達到對應等級才能製造。',q:{acad:10,gov:5}},
 {id:'acc',n:'勘定所',p:4,r:[1150,1300,1150,400],t:2000,m:20,d:'掌管財政與商賈的勘定所,每級讓商人的運載量提高 10%,20 級時達到 3 倍。(商人與交易尚未開放;原作還需要樂市樂座 20 級,本版先省略。)',q:{cavb:10}},
 {id:'pal',n:'本丸御殿',p:1,r:[425,700,750,300],t:2400,m:20,d:'城池的核心。提供防衛力(每級守軍防禦 +1%),可以訓練開墾代官與行政官(管領/軍配者/水軍頭領)。每座城只能蓋一座。10、15、20 級各有 1、2、3 個擴張名額:開分城(派 3 名開墾代官到空地)或佔領城池(行政官讓目標忠誠度歸零)各用 1 個。',q:{gov:5}},
 {id:'trs',n:'藏寶閣',p:3,r:[2400,2000,2800,1200],t:4800,m:20,d:'每 10 級可以收藏 1 件名物(珍貴寶物)。(名物系統尚未開放。)',q:{gov:10}},
 {id:'pub',n:'普請役所',p:3,r:[130,125,120,80],t:3200,m:20,d:'掌管土木工事的普請役所,每級讓建築的耐久度 +10%:敵方的攻城器械要花更多力氣才能拆毀你的建築。',q:{gov:5,pal:3}},
 {id:'wall',n:'城牆',p:0,t:800,m:20,d:'提高守軍防禦。織田家為木柵、德川家為石垣、豐臣家為土壘漆壁。'}];
const CM=[{id:'farm',n:'勸農',d:'所有資源產量 +25%,持續 2 小時'},{id:'fund',n:'御用金',d:'向商人徵調御用金,立即獲得 2 小時的產量'},{id:'build',n:'普請',d:'發動普請,施工佇列的剩餘時間減半(織田家專屬)',wei:1}];
let S=null;
const QS=[
 {id:'q1',n:'把任一資源田升到 1 級',ok:()=>S.fld.some(x=>x>=1),r:[200,200,200,200]},
 {id:'q2',n:'把知行所升到 3 級',ok:()=>S.bld.gov>=3,g:3},
 {id:'q3',n:'建造一座埋藏所',ok:()=>S.bld.cave>=1,r:[300,300,300,300]},
 {id:'q4',n:'建造足輕營',ok:()=>S.bld.infb>=1,g:3},
 {id:'q5',n:'訓練 20 名士兵',ok:()=>S.stat.trained>=20,r:[500,500,500,500]},
 {id:'q6',n:'所有資源田升到 3 級',ok:()=>S.fld.every(x=>x>=3),g:5},
 {id:'q7',n:'成功掠奪一次',ok:()=>S.stat.raids>=1,g:5},
 {id:'q8',n:'行三顧之禮請出竹中半兵衛',ok:()=>S.zg>=3,g:10}];
const pw=Math.pow;
const fa=()=>F[S.fac],us=()=>UN[S.fac];
const br=b=>b.id=='wall'?fa().w.r:b.r,bn=b=>b.id=='wall'?fa().w.n:b.n;
const lane=t=>S.fac=='wei'?t:'b';
const capAt=l=>Math.round(800*pw(125,l/20));
const hideAt=l=>l?Math.round(300*pw(1.3,l-1))*(S.fac=='wu'?2:1):0;
const inst=id=>S.slots.filter(x=>x&&x.b===id&&x.l>=1);
const cap=i=>{const a=inst(i==3?'gr':'wh');return a.length?a.reduce((t,x)=>t+capAt(x.l),0):capAt(0)};
const hide=()=>inst('cave').reduce((t,x)=>t+hideAt(x.l),0);
const BMAP=Object.fromEntries(B.map(b=>[b.id,b]));
const recalc=()=>{for(const b of B){if(b.id==='wall')continue;S.bld[b.id]=S.slots.reduce((m,x)=>x&&x.b===b.id&&x.l>=1?Math.max(m,x.l):m,0)}};
const slotOf=id=>S.slots.findIndex(x=>x&&x.b===id&&x.l>=1);
function canBuildNew(b){const ex=S.slots.filter(x=>x&&x.b===b.id);if(!ex.length)return '';
 if(MULTI.includes(b.id))return ex.every(x=>x.l>=b.m)?'':`需要先把現有的${b.n}升到滿級(${b.m} 級),才能再蓋一座`;
 return `${b.n}每個城池只能蓋一座`}
const prod=L=>Math.round(6*pw(1.36,L));
const mult=i=>1+.05*S.bld[['lum','kiln','smel','mill'][i]]+(S.buff>S.t?.25:0)+(S.zg>=3?.15:0);
const rate=i=>S.fld.reduce((a,L,k)=>a+(FT[k]==i?prod(L):0),0)*mult(i);
const bpop=()=>S.slots.reduce((a,x)=>a+(x&&x.l>=1?x.l*BMAP[x.b].p:0),0);
const awayUnits=()=>{const t=Array(NU).fill(0);for(const m of S.mv)(m.send||[]).forEach((n,k)=>t[k]+=n||0);return t}; // 出征中(含返程)的兵
const upkeep=()=>bpop()+S.u.reduce((a,n,i)=>a+n*us()[i].up,0)+awayUnits().reduce((a,n,i)=>a+n*us()[i].up,0); // 出征中的兵一樣要吃糧
const hallM=()=>Math.max(.5,1-.025*S.bld.gov);
const costF=i=>FC[FT[i]].map(x=>Math.round(x*pw(1.28,S.fld[i])));
const durF=i=>Math.round(200*pw(1.2,S.fld[i])*hallM());
const costB=(b,L)=>br(b).map(x=>Math.round(x*pw(1.28,L)));
const durB=(b,L)=>Math.round(b.t*pw(1.2,L)*hallM());
const fmax=t=>Math.max(...S.fld.filter((_,k)=>FT[k]==t));
const reqOk=b=>Object.entries(b.q||{}).every(([k,v])=>k[0]=='f'&&k.length==2?fmax(+k[1])>=v:S.bld[k]>=v);
const reqT=b=>Object.entries(b.q||{}).map(([k,v])=>(k[0]=='f'&&k.length==2?FN[+k[1]]:B.find(x=>x.id==k).n)+v+'級').join('、');
const canPay=c=>c.every((x,i)=>S.res[i]>=x);
const pay=c=>c.forEach((x,i)=>S.res[i]-=x);
const logm=(m,r)=>{S.log.unshift({t:S.t,m});S.log.length=Math.min(S.log.length,40);if(r){S.rep.unshift({t:S.t,m});S.rep.length=Math.min(S.rep.length,40)}};
const ab=()=>1+.015*S.bld.smi,db=()=>1+.015*S.bld.arm;
const wb=()=>W[S.fac][S.bld.wall];
const home=()=>(S&&S.pos)||{x:0,y:0};
const distTo=(x,y)=>Math.hypot(x-home().x,y-home().y);
const prest=()=>Math.round(S.fld.reduce((a,b)=>a+b,0)*6+B.reduce((a,b)=>a+S.bld[b.id],0)*12+(S.u.reduce((a,b)=>a+b,0)+awayUnits().reduce((a,b)=>a+b,0))*2); // 出征中的兵也算在威望裡
const rnd=k=>{const x=Math.sin(k*12.9898+78.233)*43758.5453;return x-Math.floor(x)}; // 可重現的亂數,伺服器與瀏覽器結果一致
const fix=s=>{if(s.rc==null)s.rc=0;if(s.loy==null)s.loy=100;if(s.kids==null)s.kids=0;if(!s.atkRes)s.atkRes={};for(const m of(s.mv||[]))if(!m.sent)m.sent=(m.send||[]).slice();if(!s.camps)s.camps={};
 if(!s.tr)s.tr={};for(const b of TRB){const v=s.tr[b];s.tr[b]=Array.isArray(v)?v:(v?[v]:[])}
 if(!Array.isArray(s.u))s.u=[];while(s.u.length<NU)s.u.push(0); // 舊存檔:兵種補到 10 種
 for(const m of(s.mv||[])){for(const f of['send','sent']){if(Array.isArray(m[f]))while(m[f].length<NU)m[f].push(0)}}
 if(Array.isArray(s.slots))while(s.slots.length<NSLOTS)s.slots.push(null); // 舊存檔:建地補到 27 塊 // 舊存檔:單一訓練 → 佇列
 if(!s.born)s.born=(s.saved||Date.now())-(s.t||0)/SPEED*1000; // 舊存檔:依遊戲時間推算開城時間
 for(const k of Object.keys(s.camps)){const g=s.camps[k]&&s.camps[k].g;if(!g)continue;const ng={};for(const [u,c] of Object.entries(g)){const nu=OLDN[u]||u;ng[nu]=(ng[nu]||0)+c}s.camps[k].g=ng}if(!s.bld)s.bld={};
 if(!s.slots){s.slots=Array(NSLOTS).fill(null);
  for(const b of B){if(b.id==='wall')continue;const L=s.bld[b.id]||0;if(L>0){const i=s.slots.indexOf(null);if(i>=0)s.slots[i]={b:b.id,l:L}}}
  for(const l of['f','b']){const q=s.q&&s.q[l];if(q&&q.k==='b'&&q.slot==null){if(q.id==='wall')q.slot='wall';else{let i=s.slots.findIndex(x=>x&&x.b===q.id);if(i<0){i=s.slots.indexOf(null);s.slots[i]={b:q.id,l:0}}q.slot=i}}}}
 if(s.bld.wall==null)s.bld.wall=0;
 {const prev=S;S=s;try{recalc()}finally{S=prev}}
if(!s.rep)s.rep=[];if(!s.qd)s.qd=[];if(!s.stat)s.stat={trained:0,raids:0};if(!s.cd)s.cd={};if(!s.mv)s.mv=[];if(!s.log)s.log=[];
 if(s.mv.some(m=>m.npc!=null)){s.mv=s.mv.filter(m=>{if(m.npc==null)return true;(m.send||[]).forEach((x,k)=>s.u[k]=(s.u[k]||0)+x);if(m.ret&&m.loot)m.loot.forEach((x,k)=>s.res[k]+=x);return false})}
 return s};
function init(f,pos){const bld={};B.forEach(b=>bld[b.id]=0);
 S={fac:f,slots:Array(NSLOTS).fill(null),t:0,res:[600,600,600,600],gold:20,fld:Array(18).fill(0),bld,q:{f:null,b:null},tr:{infb:[],cavb:[],wsh:[],pal:[]},u:Array(NU).fill(0),mv:[],log:[],rep:[],qd:[],stat:{trained:0,raids:0},cd:{},buff:0,zg:0,rc:0,kids:0,loy:100,camps:{},pos:pos||{x:0,y:0},born:Date.now(),saved:Date.now()};
 logm(`你選擇了${fa().n},開始經營自己的城池。城內有 ${NSLOTS} 塊空地,先蓋知行所吧!`);return S}
// 分城:由開墾代官建立的新城池,資源很少,金幣與任務由本丸管理
function initCity(f,pos,o){init(f,pos);S.col=1;S.own=o.own;S.cname=o.cname||'';S.gold=0;S.res=[500,500,500,500];S.born=o.now;S.saved=o.now;S.log=[];S.rep=[];
 logm(`${fa().n}的分城建立了!城內有 ${NSLOTS} 塊空地,先蓋知行所吧。`);return S}
const expSlots=()=>S.bld.pal>=20?3:S.bld.pal>=15?2:S.bld.pal>=10?1:0; // 本丸御殿 10/15/20 級各增加 1 個擴張名額(開分城或佔領城池各用 1 個)
const slotsFree=()=>expSlots()-(S.kids||0)-S.mv.filter(m=>m.sl).length;
function startQ(k,c,dur,o){const l=lane(k);if(S.q[l])return S.fac=='wei'?`${k=='f'?'外城':'內城'}已有施工中的項目`:'施工佇列已滿(只有織田家能外城內城同時施工)';
 if(!canPay(c))return '資源不足';pay(c);S.q[l]={k,start:S.t,dur,end:S.t+dur,cost:c,...o};return ''}
function settleEvents(opt){
 for(const k of Object.keys(S.camps||{}))if(S.t-S.camps[k].t>=CAMP_RESPAWN)delete S.camps[k];
 for(const l of['f','b']){const q=S.q[l];if(q&&q.end<=S.t){if(q.k=='f'){S.fld[q.i]++;logm(`${q.name} 升到等級 ${q.to}`)}
  else if(q.dm){const c=S.slots[q.slot];if(c){if(q.to<1)S.slots[q.slot]=null;else c.l=q.to}recalc();logm(`${q.name}完成,${q.to<1?'這塊地已經清空':'剩餘等級 '+q.to}`)}
  else{if(q.slot==='wall')S.bld.wall++;else{const c=S.slots[q.slot];if(c)c.l=q.to;else S.slots[q.slot]={b:q.id,l:q.to};recalc()}logm(`${q.name} 升到等級 ${q.to}`)}S.q[l]=null}}
 for(const b of TRB){const q=S.tr[b];
  while(q.length&&q[0].next!=null&&q[0].next<=S.t){const o=q[0],t=o.next;S.u[o.u]++;S.stat.trained++;o.n--;
   if(o.n>0)o.next=t+o.per;else{logm(`${us()[o.u].n} 訓練完成`);q.shift();if(q.length)q[0].next=t+q[0].per}}}
 for(let i=S.mv.length-1;i>=0;i--){const m=S.mv[i];if(m.arr>S.t||m.pending)continue;const n={n:m.name,def:m.def};
  if(m.ret){m.send.forEach((x,k)=>S.u[k]+=x);m.loot.forEach((x,k)=>S.res[k]=Math.min(cap(k),S.res[k]+x));logm(`部隊自${n.n}返回,帶回 ${m.loot.map(Math.floor).join('/')}`,1);S.mv.splice(i,1)}
  else if(m.kind==='scout'){const c=campGet(m.tx,m.ty);
   if(!c)logm(`${n.n}已經不存在,偵察兵返回`,1);
   else{const gl=Object.entries(c.g).filter(([k,v])=>v>0).map(([k,v])=>`${k}×${v}`).join('、')||'無';
    logm(`【偵察報告】${n.n}(${m.tx}|${m.ty}):守軍 ${gl};防禦合計約 ${Math.floor(defOf(c.g))};庫存(每種資源) ${c.st.map(v=>Math.max(0,Math.floor(v))).join('/')}`,1)}
   m.ret=1;m.arr+=m.dur;m.loot=[0,0,0,0]}
  else{const c=campGet(m.tx,m.ty),A=m.send.reduce((a,x,k)=>a+x*us()[k].a*ab(),0);
   if(!c){S.u=S.u.map((x,k)=>x+(m.send[k]||0));logm(`${n.n}已經不存在,部隊返回`,1);S.mv.splice(i,1);continue}
   const D=defOf(c.g);
   if(A>D){const q=D>0?pw(D/A,1.5):0,sv=m.send.map(x=>Math.round(x*(1-q))),carry=sv.reduce((a,x,k)=>a+x*us()[k].c,0),p=[0,1,2,3].map(i=>Math.floor(Math.min(carry/4,Math.max(0,c.st[i]))));
    for(const u of Object.keys(c.g))c.g[u]=Math.round(c.g[u]*q);
    S.camps[c.key]={g:c.g,st:c.st.map((v,i)=>v-p[i]),t:S.t};
    S.stat.raids++;logm(`掠奪${n.n}成功!我方折損 ${Math.round(q*100)}%,守軍損失 ${Math.round((1-q)*100)}%,每種資源搶得 ${p.join('/')}`,1);m.ret=1;m.send=sv;m.loot=p;m.arr+=m.dur}
   else{const f=.3*pw(A/D,1.5);for(const u of Object.keys(c.g))c.g[u]=Math.round(c.g[u]*(1-f));S.camps[c.key]={g:c.g,st:c.st,t:S.t};
    logm(`進攻${n.name||n.n}失敗,全軍覆沒(攻 ${Math.floor(A)} < 守 ${Math.floor(D)}),守軍損失 ${Math.round(f*100)}%`,1);S.mv.splice(i,1)}}}
}
// 以「事件」為單位前進,長時間離線也只要跑很少次迴圈
function adv(dt,opt){opt=opt||{};if(!(dt>0))return;const end=S.t+dt;settleEvents(opt);
 while(S.t<end-1e-9){
  const net=rate(3)-upkeep(),hasU=S.u.some(x=>x>0)||S.mv.some(m=>(m.send||[]).some(x=>x>0)),starving=S.res[3]<=0&&net<0&&hasU;
  let ev=end;
  for(const l of['f','b']){const q=S.q[l];if(q&&q.end>S.t)ev=Math.min(ev,q.end)}
  for(const b of TRB){const o=S.tr[b][0];if(o&&o.next!=null&&o.next>S.t)ev=Math.min(ev,o.next)}
  for(const m of S.mv)if(m.arr>S.t)ev=Math.min(ev,m.arr);
  if(S.buff>S.t)ev=Math.min(ev,S.buff);
  if(net<0&&S.res[3]>0)ev=Math.min(ev,S.t+S.res[3]/(-net/3600));
  if(starving)ev=Math.min(ev,S.t+30);
  const s=Math.max(.001,Math.min(ev-S.t,end-S.t));
  for(let i=0;i<4;i++){S.res[i]+=(i==3?net:rate(i))*s/3600;S.res[i]=Math.min(cap(i),Math.max(0,S.res[i]))}
  if(!S.col)S.gold+=s/3600;else if(S.loy<100)S.loy=Math.min(100,S.loy+s/3600*(1+.1*S.bld.pal));S.t+=s;
  if(starving){const k=S.u.findIndex(x=>x>0);let dead=false;
   if(k>=0){S.u[k]--;dead=true}else{const m=S.mv.find(m=>(m.send||[]).some(x=>x>0));if(m){m.send[m.send.findIndex(x=>x>0)]--;dead=true}} // 家裡沒兵了,出征中的兵也會逃亡
   if(dead&&!S.hung){S.hung=1;logm('糧食耗盡,士兵開始逃亡!')}}else S.hung=0;
  settleEvents(opt)}}
const bad=m=>({ok:false,msg:m}),ok=()=>({ok:true});
const int=(v,lo,hi)=>{v=Math.floor(+v);return Number.isFinite(v)&&v>=lo&&v<=hi?v:null};
function place(st,id,level){return withS(st,()=>{if(id==='wall'){st.bld.wall=level;return 'wall'}let i=S.slots.findIndex(x=>x&&x.b===id);if(i<0)i=S.slots.indexOf(null);S.slots[i]={b:id,l:level};recalc();return i})}
function balanceTargets(r){ // 把目前所有資源加總,依比例重新分配(受藏屋敷上限限制,不會憑空增減)
 const caps=[0,1,2,3].map(cap),T=S.res.reduce((a,b)=>a+b,0),t=[0,0,0,0];
 let rem=T,act=[0,1,2,3].filter(i=>r[i]>0);
 for(let n=0;n<20&&rem>1e-6&&act.length;n++){const sr=act.reduce((a,i)=>a+r[i],0);let used=0;
  for(const i of act){const add=Math.min(rem*r[i]/sr,caps[i]-t[i]);t[i]+=add;used+=add}
  rem-=used;act=act.filter(i=>caps[i]-t[i]>1e-6)}
 for(let i=0;i<4&&rem>1e-6;i++){const add=Math.min(caps[i]-t[i],rem);t[i]+=add;rem-=add}
 return t.map(x=>Math.floor(x))}
const withS=(st,fn)=>{const prev=S;S=st;try{return fn()}finally{S=prev}};
// ====== 玩家對戰(抵達時才結算) ======
// 出兵:只扣兵、記一筆「出征中(等待抵達結算)」。真正的戰鬥在部隊抵達的那一刻,由伺服器依雙方當時的狀態結算。
const protectedAt=(born,at)=>!!born&&(at||Date.now())-born<PROTECT_DAYS*864e5;
const pvpProtected=(def,at)=>withS(def,()=>protectedAt(S.born,at));
// 出兵前的共同檢查:回傳 {send,kind,tg} 或 {err}
function launchCheck(a,npc){const U=us(),send=U.map((_,k)=>Math.min(S.u[k]||0,Math.max(0,Math.floor(+(a.send||[])[k]||0))));
 if(!send.some(x=>x))return {err:'請選擇出征兵力'};
 const bs=send.findIndex((x,k)=>x&&U[k].soon);if(bs>=0)return {err:`${U[bs].n}目前不能出征`};
 const kind=a.kind==='scout'?'scout':a.kind==='found'?'found':'';
 if(kind==='scout'&&send.some((x,k)=>x&&U[k].k!=='scout'))return {err:'偵察任務只能派偵察兵'};
 if(npc&&(kind==='found'||send.some((x,k)=>x&&(U[k].k==='adm'||U[k].k==='set'))))return {err:'開墾代官與行政官不能攻打營寨'};
 if(kind==='found'){
  if(send.some((x,k)=>x&&U[k].k!=='set')||send.reduce((p,q)=>p+q,0)!==3)return {err:'開分城需要剛好派出 3 名開墾代官(不能帶其他兵種)'};
  if(slotsFree()<1)return {err:`沒有擴張名額:${BMAP.pal.n} 10 級有 1 個名額、15 級 2 個、20 級 3 個(目前 ${BMAP.pal.n} ${S.bld.pal} 級,已使用或預留 ${(S.kids||0)+S.mv.filter(m=>m.sl).length} 個)`};
  return {send,kind,tg:[],sl:1}}
 if(send.some((x,k)=>x&&U[k].k==='set'))return {err:'開墾代官只能用來開分城'};
 let sl=0;
 if(send.some((x,k)=>x&&U[k].k==='adm')){
  if(kind==='scout')return {err:'偵察任務只能派偵察兵'};
  if(slotsFree()<1)return {err:`行政官要佔領城池需要 1 個擴張名額,目前沒有(${BMAP.pal.n} ${S.bld.pal} 級)`};sl=1}
 let tg=[];
 if(!kind&&Array.isArray(a.tg)&&a.tg.length){
  const max=S.bld.war>=20?2:S.bld.war>=10?1:0;
  if(!max)return {err:`${BMAP.war.n}要 10 級才能指定攻城目標`};
  if(a.tg.length>max)return {err:`${BMAP.war.n} ${S.bld.war} 級最多指定 ${max} 處目標建築`};
  tg=[...new Set(a.tg.map(String))];
  if(tg.some(id=>!BMAP[id]||id==='wall'))return {err:'目標建築錯誤(城牆由破門槌負責)'};
  if(!send.some((x,k)=>x&&U[k].k==='cat'))tg=[]; // 沒帶大筒類器械就不需要目標
 }
 return {send,kind,tg,sl}}
function pvpLaunch(att,a,meta){
 const tx=int(a.tx,-1000000,1000000),ty=int(a.ty,-1000000,1000000);if(tx==null||ty==null)return bad('座標錯誤');
 return withS(att,()=>{
  if(S.bld.war<1)return bad('需要先建造軍奉行才能出兵');
  if(!Array.isArray(a.send))return bad('請選擇出征兵力');
  const U=us(),lc=launchCheck(a);if(lc.err)return bad(lc.err);const {send,kind,tg,sl}=lc;
  const dist=distTo(tx,ty);if(dist<=0)return bad(kind==='found'?'那裡就是這座城':'不能攻擊自己的城池');
  const sp=Math.min(...send.map((x,k)=>x?U[k].s:99)),dur=Math.max(1,Math.round(dist/sp*3600));
  send.forEach((x,k)=>S.u[k]-=x);
  const name=kind==='found'?`新城預定地(${tx}|${ty})`:`${meta.defNick}(${tx}|${ty})`;
  S.mv.push({pv:1,pending:1,aid:meta.aid,tx,ty,name,def:0,sent:send.slice(),send:send.slice(),go:S.t+dur,arr:S.t+dur,dur,ret:0,loot:[0,0,0,0],sentAt:meta.now,kind,tg,sl});
  logm(kind==='found'?`派 3 名開墾代官前往${name}建立分城,速度 ${sp} 格/時`:`派${kind?'偵察兵':'兵'}前往${name},出兵 ${send.reduce((p,q)=>p+q,0)} 人,速度 ${sp} 格/時;部隊抵達後才會${kind?'展開偵察':'開戰'}`);
  return {ok:true,tx,ty,dur,sp,dist,send,go:S.t+dur,fac:S.fac,ab:ab(),pos:{...home()},kind,tg}})}
// 攻城:存活的破門槌拆城牆;存活的大筒類器械轟擊建築(軍奉行 10/20 級可指定 1/2 處,否則隨機 1 處)。在防守方的狀態(S)上試算,不改存檔
function siegeCalc(info,surv){const U=UN[info.fac],cnt=k=>surv.reduce((p,x,i)=>p+(U[i].k===k?x:0),0),rams=cnt('ram'),cats=cnt('cat');
 if(!rams&&!cats)return null;
 const out={rams,cats,wall:null,hits:[]};
 if(rams>0&&S.bld.wall>0){const L0=S.bld.wall;let L=L0,rem=rams;while(L>0&&rem>=2+L){rem-=2+L;L--}out.wall={from:L0,to:L}}
 if(cats>0){
  const pub=1+.1*S.bld.pub,built=[...new Set(S.slots.filter(x=>x&&x.l>=1).map(x=>x.b))];
  let ids=(info.tg&&info.tg.length)?info.tg.slice():[];const rnd=!ids.length;
  if(rnd&&built.length)ids=[built[Math.floor(((info.seed>>>0)/4294967296)*built.length)%built.length]];
  const per=ids.length?Math.floor(cats/ids.length):0;
  for(const id of ids){let slot=-1;S.slots.forEach((x,i)=>{if(x&&x.b===id&&x.l>=1&&(slot<0||x.l>S.slots[slot].l))slot=i});
   if(slot<0){out.hits.push({id,name:BMAP[id].n,missing:1,from:0,to:0,rnd});continue}
   const from=S.slots[slot].l;let L=from,rem=per;while(L>0){const need=Math.ceil((3+L)*pub);if(rem<need)break;rem-=need;L--}
   out.hits.push({id,name:BMAP[id].n,slot,from,to:L,cats:per,rnd})}}
 return out}
// 戰鬥結算(純計算,不改任何存檔):info = { fac, send, ab },def = 防守方「抵達那一刻」的狀態
function pvpBattle(info,def){
 const U=UN[info.fac],parts=info.send.map((x,k)=>x*U[k].a*info.ab),A=parts.reduce((p,q)=>p+q,0);
 const cavShare=A>0?info.send.reduce((p,x,k)=>p+(U[k].b=='cavb'?parts[k]:0),0)/A:0;
 return withS(def,()=>{const Ud=us(),per=u=>u.di*(1-cavShare)+u.dc*cavShare,wallPct=wb();
  const D=(S.u.reduce((p,x,k)=>p+x*per(Ud[k])*db(),0)+60)*(1+wallPct/100)*(1+.01*S.bld.pal),defRes=S.res.slice(),hideAmt=hide()*(info.fac=='shu'?2/3:1); // 德川:敵人的埋藏所只有 2/3 作用
  const win=A>D;let lossA,lossD;
  if(win){const q=pw(D/A,1.5);lossA=q;lossD=(1-q)*.5}else{lossA=1;lossD=.3*pw(A/D,1.5)}
  const surv=info.send.map(x=>Math.round(x*(1-lossA))),carry=surv.reduce((p,x,k)=>p+x*U[k].c,0);
  const sg=siegeCalc(info,surv);
  let conq=null;
  if(win){const admN=surv.reduce((p,x,k)=>p+(U[k].k==='adm'?x:0),0);
   if(admN>0){if(!S.col)conq={cap:1,admN};
    else{const per=20+((info.seed>>>0)%11),from=S.loy==null?100:S.loy,to=Math.max(0,from-per*admN);conq={admN,per,from:Math.floor(from),to:Math.floor(to),taken:to<=0}}}}
  const loot=[0,1,2,3].map(i=>win?Math.floor(Math.min(carry/4,Math.max(0,defRes[i]-hideAmt))):0);
  const defBefore=S.u.slice(),defAfter=S.u.map(x=>Math.floor(x*(1-lossD)));
  return {win,A:Math.round(A),D:Math.round(D),wallPct,wallLv:S.bld.wall,caveLv:S.bld.cave,defFac:S.fac,attFac:info.fac,lossA,lossD,sent:info.send.slice(),surv,deadA:info.send.map((x,k)=>x-surv[k]),defBefore,deadD:defBefore.map((x,k)=>x-defAfter[k]),loot,defRes:defRes.map(Math.floor),hide:Math.round(hideAmt),sg,conq}})}
// 偵察(純計算):防守方的偵察兵越多,攻方偵察兵折損越多;全滅就失敗
function scoutBattle(info,def){return withS(def,()=>{const U=UN[info.fac],Ud=us();
 const aS=info.send.reduce((p,x,k)=>p+(U[k].k==='scout'?x:0),0),dS=S.u.reduce((p,x,k)=>p+(Ud[k].k==='scout'?x:0),0);
 const lossFrac=dS<=0||aS<=0?0:Math.min(1,pw(dS/aS,1.5)),surv=info.send.map(x=>Math.round(x*(1-lossFrac))),okk=surv.some(x=>x>0);
 const bl={};for(const x of S.slots)if(x&&x.l>=1)bl[x.b]=Math.max(bl[x.b]||0,x.l);
 return {scout:1,ok:okk,aS,dS,lossFrac,sent:info.send.slice(),surv,deadA:info.send.map((x,k)=>x-surv[k]),loot:[0,0,0,0],attFac:info.fac,defFac:S.fac,
  rep:okk?{res:S.res.map(Math.floor),u:S.u.slice(),wall:S.bld.wall,bld:bl,hide:hide()}:null}})}
function scoutApplyDef(def,res,ctx){return withS(def,()=>{
 S.atkRes=S.atkRes||{};S.atkRes[ctx.id]=res;const ks=Object.keys(S.atkRes);if(ks.length>30)ks.slice(0,ks.length-30).forEach(k=>delete S.atkRes[k]);
 if(res.lossFrac>0)logm(`${ctx.attNick}(${ctx.attPos.x}|${ctx.attPos.y})派出的偵察兵被我方偵察兵發現,擊殺 ${res.deadA.reduce((p,q)=>p+q,0)} 人${res.ok?',但仍有人逃脫':',全數殲滅'}`,1);
 return def})}
// 把戰果套用到防守方(res.loot 是依當時資源算出來的,這裡再保險地不讓資源變成負的)
function pvpApplyDef(def,res,ctx){return withS(def,()=>{
 const taken=[0,1,2,3].map(i=>{const t=Math.min(S.res[i],res.loot[i]);S.res[i]-=t;return Math.floor(t)});
 S.u=S.u.map((x,k)=>Math.max(0,x-res.deadD[k]));
 const dead=res.deadD.reduce((p,q)=>p+q,0);
 S.atkRes=S.atkRes||{};S.atkRes[ctx.id]=res;const ks=Object.keys(S.atkRes);if(ks.length>30)ks.slice(0,ks.length-30).forEach(k=>delete S.atkRes[k]);
 logm(`${ctx.attNick}(${ctx.attPos.x}|${ctx.attPos.y})來襲:${res.win?'守軍不敵':'守軍擊退'}!守軍陣亡 ${dead},被搶 ${taken.join('/')}`,1);
 if(res.sg){const sg=res.sg;
  if(sg.wall&&sg.wall.to<sg.wall.from){S.bld.wall=sg.wall.to;logm(`破門槌撞毀了${fa().w.n}:等級 ${sg.wall.from} → ${sg.wall.to}`,1)}
  for(const h of sg.hits){if(h.missing||h.to>=h.from)continue;const c=S.slots[h.slot];if(!c||c.b!==h.id)continue;
   const q=S.q.b;c.l=h.to;
   if(q&&q.k==='b'&&q.slot===h.slot){
    if(h.to<1&&!q.dm){q.cost.forEach((x,i)=>S.res[i]=Math.min(cap(i),S.res[i]+x));S.q.b=null}
    else if(q.dm)q.to=Math.max(0,h.to-1);else q.to=h.to+1}
   if(h.to<1&&!(S.q.b&&S.q.b.slot===h.slot))S.slots[h.slot]=null;
   logm(`攻城器械轟毀了${h.name}:等級 ${h.from} → ${h.to}`,1)}
  recalc()}
 const cq=res.conq;
 if(cq&&!cq.cap){
  if(cq.taken){S.loy=25;S.own=ctx.attOwner;S.col=1;S.u=S.u.map(()=>0);S.kids=0;S.mv.forEach(m=>m.sl=0);S.pub=null;
   logm(`${ctx.attNick} 的行政官說服了家臣,這座城池被奪走了!城內守軍全數離散`,1)}
  else{S.loy=cq.to;logm(`${ctx.attNick} 的行政官動搖了民心:忠誠度 ${cq.from} → ${cq.to}`,1)}}
 return def})}
// 撤回還沒抵達的出兵:已走多少時間,就再走多少時間回來(玩家對戰)。回傳 {ok,msg} 或 {ok:true,m}
function pvpRecall(att,aid){return withS(att,()=>{
 const i=S.mv.findIndex(m=>m.aid===aid&&m.pending);if(i<0)return bad('找不到這支出征部隊');const m=S.mv[i];
 if(S.t>=m.go)return bad('部隊已經抵達,無法撤回');
 const el=Math.max(1,Math.round(S.t-(m.go-m.dur)));
 m.pending=0;m.ret=1;m.recalled=1;m.sl=0;m.arr=S.t+el;m.dur=el;m.loot=[0,0,0,0];
 logm(`撤回前往${m.name}的部隊,已走 ${Math.round(el/60)} 分鐘,同樣時間後返回`,1);
 return {ok:true,name:m.name}})}
// 把戰果套用到攻擊方:出征中 → 返回中。回傳 false 代表已經套用過(重複呼叫不會重複計算)
function pvpApplyAtt(att,aid,res,ctx){return withS(att,()=>{
 const i=S.mv.findIndex(m=>m.aid===aid&&m.pending);if(i<0)return false;const m=S.mv[i];
 m.pending=0;m.ret=1;m.sl=0;m.arr=m.go+m.dur;
 if(res.found){if(res.ok){S.kids=(S.kids||0)+1;S.mv.splice(i,1);logm(`${m.name}建立了新的分城!(開墾代官已在當地落地生根)`,1)}
  else{m.loot=[0,0,0,0];logm(`${m.name}無法建城:${res.why||'失敗'},開墾代官折返`,1)}return true}
 if(res.void||res.fizzled){m.loot=[0,0,0,0];logm(res.void?`${m.name}的城池已經不在了,部隊折返`:`出兵沒有成功送出,部隊折返`,1);return true}
 m.send=m.send.map((x,k)=>Math.min(x,res.surv[k]));m.loot=(res.loot||[0,0,0,0]).slice();
 if(res.conq&&!res.conq.cap){const U=us();m.send=m.send.map((x,k)=>U[k].k==='adm'?0:x);if(res.conq.taken){S.kids=(S.kids||0)+1;logm(`行政官成功說服了${m.name},城池歸順!`,1)}}
 if(res.scout){const sn=res.sent.reduce((p,q)=>p+q,0),ls=res.deadA.reduce((p,q)=>p+q,0);
  logm(`偵察${m.name}${res.ok?'成功':'失敗'}!派出 ${sn} 人,折損 ${ls} 人${res.ok?'(偵察報告已寄到飛鴿傳書)':',偵察兵全滅'}`,1);
  if(!m.send.some(x=>x))S.mv.splice(i,1);return true}
 const sent=res.sent.reduce((p,q)=>p+q,0),lost=res.deadA.reduce((p,q)=>p+q,0);
 if(res.win)S.stat.raids++;
 logm(`${res.win?'襲擊':'進攻'}${m.name}${res.win?'成功':'失敗'}!出兵 ${sent} 人,陣亡 ${lost},${res.win?'搶得 '+res.loot.join('/')+'(部隊返回後入庫)':'殘部返回'}`,1);
 if(!m.send.some(x=>x))S.mv.splice(i,1);return true})}
function perform(a){if(!S||!a||typeof a.t!=='string')return bad('無效的操作');const t=a.t;
 if(t=='f'){const i=int(a.i,0,17);if(i==null)return bad('參數錯誤');if(S.fld[i]>=20)return bad('已達最高等級');
  const e=startQ('f',costF(i),durF(i),{i,name:FN[FT[i]],to:S.fld[i]+1});return e?bad(e):ok()}
 if(t=='b'){const slot=a.slot==='wall'?'wall':int(a.slot,0,NSLOTS-1);if(slot==null)return bad('參數錯誤');
  let b,L,isNew=false;
  if(slot==='wall'){b=BMAP.wall;L=S.bld.wall}
  else{const cell=S.slots[slot];
   if(cell){b=BMAP[cell.b];L=cell.l;if(L<1)return bad('這塊地正在施工中')}
   else{b=BMAP[a.id];if(!b||b.id==='wall')return bad('請選擇要蓋的建築');isNew=true;L=0;const e=canBuildNew(b);if(e)return bad(e)}}
  if(L>=b.m)return bad('已達最高等級');if(!reqOk(b))return bad('前置建築未達標');
  const e=startQ('b',costB(b,L),durB(b,L),{slot,id:b.id,name:bn(b),to:L+1});if(e)return bad(e);
  if(isNew)S.slots[slot]={b:b.id,l:0};return ok()}
 if(t=='demolish'){const slot=int(a.slot,0,NSLOTS-1);if(slot==null)return bad('參數錯誤');const c=S.slots[slot];if(!c||c.l<1)return bad('這塊地沒有可以拆除的建築');
  if(S.bld.gov<DEMOLISH_GOV)return bad(`${BMAP.gov.n}要 ${DEMOLISH_GOV} 級以上才能拆除建築`);if(c.b==='gov')return bad(`${BMAP.gov.n}不能拆除`);
  if(TRB.includes(c.b)&&S.tr[c.b].length)return bad('訓練佇列還有兵,請先取消或等訓練完成');
  const b=BMAP[c.b],to=c.l-1;
  if(c.b==='wh'||c.b==='gr'){const keep=c.l;c.l=to;const ci=c.b==='gr'?[3]:[0,1,2],over=ci.some(i=>S.res[i]>cap(i));c.l=keep;if(over)return bad('現有資源超過拆除後的容量,請先用掉一些再拆')}
  const dur=Math.max(30,Math.round(durB(b,to)*0.5)),e=startQ('b',[0,0,0,0],dur,{slot,id:c.b,name:b.n+'(拆除)',to,dm:1});if(e)return bad(e);return ok()}
 if(t=='rushall'){if(S.col)return bad('金幣、任務與拜訪由本丸統一管理,請切換回本丸操作');const ls=['f','b'].filter(l=>S.q[l]);if(!ls.length)return bad('沒有施工中的項目');if(S.gold<2*ls.length)return bad('金幣不足(每項 2 金幣)');
  S.gold-=2*ls.length;ls.forEach(l=>S.q[l].end=S.t);adv(0.01);return ok()}
 if(t=='cancel'){const l=a.l;if(l!=='f'&&l!=='b')return bad('參數錯誤');const q=S.q[l];if(!q)return bad('沒有施工中的項目');
  q.cost.forEach((x,i)=>S.res[i]=Math.min(cap(i),S.res[i]+x));if(q.k==='b'&&q.slot!=='wall'&&q.slot!=null){const c=S.slots[q.slot];if(c&&c.l<1)S.slots[q.slot]=null}S.q[l]=null;return {ok:true,msg:'已取消,資源全額退還'}}
 if(t=='tr'){const k=int(a.k,0,NU-1),n=int(a.n,1,100000);if(k==null||n==null)return bad('請輸入數量');const u=us()[k];
  if(S.bld[u.b]<1)return bad(`需要先建造${BMAP[u.b].n}才能訓練${u.n}`);
  if(u.lv>S.bld.acad)return bad(`${u.n}需要${BMAP.acad.n} ${u.lv} 級才能訓練(目前 ${S.bld.acad} 級)`);
  if(u.k==='set'||u.k==='adm'){if(expSlots()<1)return bad(`${BMAP.pal.n}要 10 級才有擴張名額,${u.n}現在還用不到`);
   if(u.k==='set'){const have=S.u[k]+awayUnits()[k]+Object.values(S.tr).reduce((p,q)=>p+q.reduce((a,o)=>a+(o.u===k?o.n:0),0),0),max=3*Math.max(0,expSlots()-(S.kids||0));
    if(have+n>max)return bad(`擴張名額最多再養 ${Math.max(0,max-have)} 名開墾代官(每個名額 3 名;目前已有/訓練中 ${have} 名)`)}}
  if(S.tr[u.b].length>=TRAIN_QMAX)return bad(`訓練佇列已滿(最多 ${TRAIN_QMAX} 批)`);const c=u.r.map(x=>x*n);if(!canPay(c))return bad('資源不足');
  pay(c);const per=Math.round(u.t*pw(.9,S.bld[u.b]-1)),q=S.tr[u.b];q.push({u:k,n,per,next:q.length?null:S.t+per});return ok()}
 if(t=='trcancel'){const b=a.b;if(!TRB.includes(b))return bad('參數錯誤');const q=S.tr[b],i=int(a.i,0,q.length-1);if(i==null)return bad('找不到這批訓練');
  const o=q[i],u=us()[o.u];o.n>0&&u.r.forEach((x,j)=>S.res[j]=Math.min(cap(j),S.res[j]+x*o.n)); // 退還尚未完成的兵
  q.splice(i,1);if(i===0&&q.length)q[0].next=S.t+q[0].per;return {ok:true,msg:'已取消這批訓練,尚未完成的部分全額退還'}}
 if(t=='cmd'){const c=CM.find(x=>x.id===a.id);if(!c)return bad('找不到指令');if(c.wei&&S.fac!='wei')return bad('織田家專屬');if((S.cd[c.id]||0)>S.t)return bad('冷卻中');
  if(c.id=='farm')S.buff=S.t+7200;else if(c.id=='fund')for(let i=0;i<4;i++)S.res[i]=Math.min(cap(i),S.res[i]+rate(i)*2);
  else{for(const l of['f','b'])if(S.q[l])S.q[l].end=S.t+(S.q[l].end-S.t)/2}
  S.cd[c.id]=S.t+CD;logm(`下達內政指令:${c.n}`);return ok()}
 if(t=='visit'){if(S.col)return bad('金幣、任務與拜訪由本丸統一管理,請切換回本丸操作');if(S.zg>=3)return bad('竹中半兵衛已經出仕');const v=300*(S.zg+1),c=[v,v,v,v];if(!canPay(c))return bad('禮物不足');
  pay(c);S.zg++;logm(S.zg<3?`第 ${S.zg} 次拜訪菩提山城,半兵衛不在。`:'三顧之禮!竹中半兵衛出仕,全資源產量 +15%');return ok()}
 if(t=='raid'){if(S.bld.war<1)return bad('需要先建造軍奉行才能出兵');const tx=int(a.tx,-1000000,1000000),ty=int(a.ty,-1000000,1000000);if(tx==null||ty==null)return bad('座標錯誤');
  const n=npcAt(tx,ty);if(!n)return bad('該座標沒有可攻擊的目標');if(n.zg)return bad('菩提山城不能攻擊,請行三顧之禮');
  if(!Array.isArray(a.send))return bad('請選擇出征兵力');const lc=launchCheck({send:a.send,kind:a.kind},1);if(lc.err)return bad(lc.err);const {send,kind}=lc;
  const ci=campInfo(tx,ty);if(!kind&&ci&&ci.empty)return bad(`這座營寨已被清空,約 ${Math.ceil(ci.respawnIn/3600)} 遊戲小時後重新集結`);
  const sp=Math.min(...send.map((x,k)=>x?us()[k].s:99));send.forEach((x,k)=>S.u[k]-=x);const dur=Math.max(1,Math.round(distTo(tx,ty)/sp*3600));
  S.mv.push({tx,ty,name:n.n,def:n.def,sent:send.slice(),send,arr:S.t+dur,dur,ret:0,loot:[0,0,0,0],kind});logm(`派${kind?'偵察兵':'兵'}前往${n.n}(${tx}|${ty}),速度 ${sp} 格/時`);return ok()}
 if(t=='recall'){const i=int(a.i,0,S.mv.length-1);if(i==null)return bad('找不到這支部隊');const m=S.mv[i];
  if(!m||m.pv||m.pending||m.ret||m.arr<=S.t||m.tx!==a.tx||m.ty!==a.ty)return bad('這支部隊現在無法撤回');
  const el=Math.max(1,Math.round(S.t-(m.arr-m.dur)));m.ret=1;m.recalled=1;m.arr=S.t+el;m.dur=el;m.loot=[0,0,0,0];
  logm(`撤回前往${m.name}的部隊,已走 ${Math.round(el/60)} 分鐘,同樣時間後返回`);return ok()}
 if(t=='buy'){if(S.col)return bad('金幣、任務與拜訪由本丸統一管理,請切換回本丸操作');const k=int(a.res,0,3),g=int(a.gold,1,100000);if(k==null||g==null)return bad('請輸入購買的金幣數量');if(S.gold<g)return bad('金幣不足');
  const amt=g*GOLD_RATE;if(S.res[k]+amt>cap(k))return bad(`${RN[k]}藏屋敷放不下(目前最多再買 ${Math.max(0,Math.floor((cap(k)-S.res[k])/GOLD_RATE))} 金幣)`);
  S.gold-=g;S.res[k]+=amt;logm(`用 ${g} 金幣買了 ${amt} ${RN[k]}`);return {ok:true,msg:`花費 ${g} 金幣,獲得 ${amt} ${RN[k]}`}}
 if(t=='balance'){if(S.col)return bad('金幣、任務與拜訪由本丸統一管理,請切換回本丸操作');if(!Array.isArray(a.r))return bad('參數錯誤');const r=[0,1,2,3].map(i=>int(a.r[i],0,1000));if(r.some(x=>x==null)||!r.some(x=>x>0))return bad('請設定比例(每項 0~1000,至少一項大於 0)');
  if(S.gold<EXCHANGE_COST)return bad(`平倉需要 ${EXCHANGE_COST} 金幣`);S.gold-=EXCHANGE_COST;S.res=balanceTargets(r);logm(`平倉完成,比例 ${r.join(':')}`);return {ok:true,msg:'平倉完成'}}
 if(t=='claim'){if(S.col)return bad('金幣、任務與拜訪由本丸統一管理,請切換回本丸操作');const q=QS.find(x=>x.id===a.id);if(!q||S.qd.includes(q.id)||!q.ok())return bad('任務尚未完成');S.qd.push(q.id);if(q.g)S.gold+=q.g;if(q.r)q.r.forEach((x,i)=>S.res[i]=Math.min(cap(i),S.res[i]+x));return {ok:true,msg:'任務獎勵已領取'}}
 return bad('未知的操作')}
return {get S(){return S},set S(v){S=v},SPEED,CD,NSLOTS,NU,TRB,MULTI,GOLD_RATE,EXCHANGE_COST,PROTECT_DAYS,protectedAt,RN,FN,FT,FC,F,W,UN,N,TIERS,ZG,B,CM,QS,pw,fa,us,br,bn,lane,capAt,hideAt,cap,hide,prod,mult,rate,bpop,upkeep,hallM,costF,durF,costB,durB,fmax,reqOk,reqT,canPay,pay,logm,ab,db,wb,npcAt,home,distTo,hash,prest,rnd,fix,init,adv,perform,balanceTargets,pvpProtected,pvpLaunch,pvpBattle,pvpApplyDef,pvpApplyAtt,pvpRecall,scoutBattle,scoutApplyDef,launchCheck,initCity,expSlots,slotsFree,place,slotOf,canBuildNew,recalc,inst,awayUnits,campInfo,TRAIN_QMAX,DEMOLISH_GOV,UDESC,DEMOLISH_GOV,UDESC,CAMP_RESPAWN,STASH_MULT,defOf};
})();
if(typeof module!=='undefined')module.exports=G;
