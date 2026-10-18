// 討論版:文章與回覆。給 netlify/functions/forum 使用(函式檔只負責驗證身分與取得儲存空間)。
// 儲存(一個 Netlify Blobs store,建議名稱 "forum"):
//   fidx        主題索引:{ th:[{id,cat,ti,au,an,t,lt,ln,n,pin}] }(最多 MAX_THREADS 筆,最舊的會被移出索引)
//   ft_<id>     單一主題:{ id,cat,ti,au,an,b,t,ps:[{id,au,an,b,t}] }
//   fu_<uid>    發文冷卻:{ t }
// 每一步寫入都用 etag(onlyIfMatch / onlyIfNew)避免多人同時發文互相覆蓋。

const CATS = { news: "官方公告", talk: "綜合討論", tips: "攻略心得", help: "問題求助", idea: "建議回報", ally: "聯盟招募" };
const ADMIN_ONLY = new Set(["news"]);
const TITLE_MAX = 40, BODY_MAX = 2000, REPLY_MAX = 1000, MAX_REPLIES = 500, MAX_THREADS = 300, COOLDOWN = 20000;

const IDX = "fidx", tkey = (id) => "ft_" + id, ukey = (uid) => "fu_" + uid;
const bad = (msg, status = 400) => ({ status, body: { ok: false, msg } });
const good = (body) => ({ status: 200, body: { ok: true, ...body } });
const clean = (s, max) => String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, max);
const newId = (now) => now.toString(36) + Math.random().toString(36).slice(2, 7);
const summary = (th) => ({ id: th.id, cat: th.cat, ti: th.ti, au: th.au, an: th.an, t: th.t, lt: th.lt, ln: th.ln, n: th.n, v: th.v || 0, pin: th.pin ? 1 : 0 });

// 讀-改-寫,etag 不符就重試
async function cas(store, key, fn) {
  for (let i = 0; i < 8; i++) {
    const g = await store.getWithMetadata(key, { type: "json" });
    const cur = g ? g.data : null;
    const next = fn(cur);
    if (next === undefined) return cur;
    const w = g ? await store.setJSON(key, next, { onlyIfMatch: g.etag }) : await store.setJSON(key, next, { onlyIfNew: true });
    if (!w || w.modified !== false) return next;
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 120));
  }
  throw new Error("forum: write conflict on " + key);
}

async function cooldown(store, uid, now, isAdmin) {
  if (isAdmin) return "";
  const u = await store.get(ukey(uid), { type: "json" });
  if (u && now - u.t < COOLDOWN) return `發文太快了,請 ${Math.ceil((COOLDOWN - (now - u.t)) / 1000)} 秒後再試`;
  await store.setJSON(ukey(uid), { t: now });
  return "";
}

// user: { id, nick, admin } 或 null(訪客只能看)
async function forum({ store, user, method, query, body, now }) {
  now = now || Date.now();
  const me = user ? { id: user.id, n: user.nick, admin: !!user.admin } : null;

  if (method === "GET") {
    const id = query && query.t;
    if (id) {
      if (!/^[a-z0-9]{4,20}$/.test(id)) return bad("找不到這篇文章", 404);
      const th = await store.get(tkey(id), { type: "json" });
      if (!th) return bad("這篇文章不存在或已被刪除", 404);
      // 瀏覽次數:作者自己看不算;同一個瀏覽器本次已看過會帶 nc=1 不重複算。失敗不影響閱讀。
      if (!(query && query.nc) && !(me && me.id === th.au)) {
        try {
          let cur2 = null;
          await cas(store, tkey(id), (c) => { if (!c) return undefined; cur2 = { ...c, v: (c.v || 0) + 1 }; return cur2; });
          if (cur2) {
            th.v = cur2.v;
            await cas(store, IDX, (c) => { const l = (c && c.th) || []; if (!l.some((x) => x.id === id)) return undefined; return { th: l.map((x) => (x.id === id ? { ...x, v: cur2.v } : x)) }; });
          }
        } catch (e) { console.error("forum view count failed", e); }
      }
      return good({ thread: th, me, cats: CATS });
    }
    const idx = (await store.get(IDX, { type: "json" })) || { th: [] };
    const cat = query && CATS[query.cat] ? query.cat : null;
    const th = idx.th.filter((x) => !cat || x.cat === cat).sort((a, b) => (b.pin || 0) - (a.pin || 0) || b.lt - a.lt);
    return good({ threads: th, me, cats: CATS });
  }

  if (method !== "POST") return bad("不支援的操作", 405);
  if (!me) return bad("請先登入遊戲再發文", 401);
  const a = body || {};

  if (a.t === "new") {
    const cat = CATS[a.cat] ? a.cat : null, ti = clean(a.ti, TITLE_MAX), b = clean(a.b, BODY_MAX);
    if (!cat) return bad("請選擇分類");
    if (ADMIN_ONLY.has(cat) && !me.admin) return bad("只有管理員可以在「官方公告」發文", 403);
    if (!ti) return bad("請輸入標題");
    if (!b) return bad("請輸入內容");
    const cd = await cooldown(store, me.id, now, me.admin); if (cd) return bad(cd, 429);
    const id = newId(now);
    const th = { id, cat, ti, au: me.id, an: me.n, b, t: now, lt: now, ln: me.n, n: 0, pin: 0, ps: [] };
    await store.setJSON(tkey(id), th, { onlyIfNew: true });
    await cas(store, IDX, (cur) => {
      const list = [summary(th), ...((cur && cur.th) || []).filter((x) => x.id !== id)];
      // 置頂的不會被擠掉;其餘依最後回覆時間保留最新的
      const pins = list.filter((x) => x.pin), rest = list.filter((x) => !x.pin).sort((p, q) => q.lt - p.lt);
      return { th: [...pins, ...rest].slice(0, MAX_THREADS) };
    });
    return good({ id, msg: "發文成功" });
  }

  if (a.t === "reply") {
    const id = String(a.id || ""), b = clean(a.b, REPLY_MAX);
    if (!/^[a-z0-9]{4,20}$/.test(id)) return bad("找不到這篇文章", 404);
    if (!b) return bad("請輸入回覆內容");
    const cd = await cooldown(store, me.id, now, me.admin); if (cd) return bad(cd, 429);
    let err = "", th = null;
    await cas(store, tkey(id), (cur) => {
      if (!cur) { err = "這篇文章不存在或已被刪除"; return undefined; }
      if (cur.lock && !me.admin) { err = "這篇文章已經鎖定,不能回覆"; return undefined; }
      if (cur.ps.length >= MAX_REPLIES) { err = `回覆已達上限(${MAX_REPLIES} 則),請另開新主題`; return undefined; }
      th = { ...cur, ps: [...cur.ps, { id: newId(now), au: me.id, an: me.n, b, t: now }], lt: now, ln: me.n, n: cur.ps.length + 1 };
      return th;
    });
    if (err) return bad(err, 404);
    await cas(store, IDX, (cur) => {
      const list = (cur && cur.th) || [];
      const rest = list.filter((x) => x.id !== id);
      return { th: [summary(th), ...rest] };
    });
    return good({ thread: th, msg: "回覆成功" });
  }

  if (a.t === "del") {
    const id = String(a.id || ""), pid = a.pid ? String(a.pid) : null;
    let err = "", gone = false, th = null;
    await cas(store, tkey(id), (cur) => {
      if (!cur) { err = "這篇文章不存在或已被刪除"; return undefined; }
      if (!pid) {
        if (cur.au !== me.id && !me.admin) { err = "只能刪除自己的文章"; return undefined; }
        gone = true; return undefined;
      }
      const p = cur.ps.find((x) => x.id === pid);
      if (!p) { err = "找不到這則回覆"; return undefined; }
      if (p.au !== me.id && !me.admin) { err = "只能刪除自己的回覆"; return undefined; }
      const ps = cur.ps.filter((x) => x.id !== pid), last = ps[ps.length - 1];
      th = { ...cur, ps, n: ps.length, lt: last ? last.t : cur.t, ln: last ? last.an : cur.an };
      return th;
    });
    if (err) return bad(err, 403);
    if (gone) await store.delete(tkey(id));
    await cas(store, IDX, (cur) => {
      const list = ((cur && cur.th) || []).filter((x) => x.id !== id);
      return { th: gone ? list : [summary(th), ...list] };
    });
    return good({ msg: gone ? "已刪除文章" : "已刪除回覆", thread: gone ? null : th });
  }

  if (a.t === "pin" || a.t === "lock") {
    if (!me.admin) return bad("只有管理員可以使用", 403);
    const id = String(a.id || ""), k = a.t;
    let th = null;
    await cas(store, tkey(id), (cur) => { if (!cur) return undefined; th = { ...cur, [k]: cur[k] ? 0 : 1 }; return th; });
    if (!th) return bad("這篇文章不存在或已被刪除", 404);
    if (k === "pin") await cas(store, IDX, (cur) => ({ th: [summary(th), ...(((cur && cur.th) || []).filter((x) => x.id !== id))] }));
    return good({ thread: th, msg: th[k] ? (k === "pin" ? "已置頂" : "已鎖定") : (k === "pin" ? "已取消置頂" : "已解除鎖定") });
  }

  return bad("未知的操作");
}

module.exports = { forum, CATS };
