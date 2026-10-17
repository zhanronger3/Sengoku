// 存檔輕量備份:包住「存檔」的儲存空間,寫入前把「上一版」另存到獨立的備份空間。
//   - 備份放在另一個 store(例如 "backup"),鍵 = 存檔鍵;每個存檔只留一份
//   - 節流:上一版的時間和這次寫入落在不同的 10 分鐘區間才備份(每個活躍區間最多多寫一次),
//     所以備份大約是「10 分鐘以前」的狀態,足夠救「剛剛才壞掉」的存檔
//   - 備份失敗不影響正常寫入
const BUCKET_MS = 10 * 60 * 1000;
const tsOf = (d) => (d && (d.updatedAt || (d.state && d.state.saved))) || 0;

function withBackup(saves, backup, opt = {}) {
  const bucket = opt.bucketMs || BUCKET_MS, seen = new Map();
  const remember = (key, g, data) => { try { if (data && data.state) seen.set(key, JSON.stringify(data)); } catch {} return g; };
  return {
    raw: saves,
    async get(key, o) { const d = await saves.get(key, o); remember(key, d, d); return d; },
    async getWithMetadata(key, o) { const g = await saves.getWithMetadata(key, o); remember(key, g, g && g.data); return g; },
    async setJSON(key, data, o) {
      const prev = seen.get(key);
      if (prev && !(o && o.onlyIfNew)) {
        try {
          const p = JSON.parse(prev), nowTs = (data && data.updatedAt) || Date.now();
          if (Math.floor(tsOf(p) / bucket) !== Math.floor(nowTs / bucket)) await backup.setJSON(key, { ...p, bakAt: nowTs });
        } catch (e) { /* 備份失敗就算了 */ }
      }
      const w = await saves.setJSON(key, data, o);
      if (!w || w.modified !== false) seen.delete(key);
      return w;
    },
    delete: (k) => saves.delete(k),
    list: (o) => saves.list(o),
  };
}

// 管理者還原:把備份蓋回存檔(目前的存檔會換成新的備份,所以可以再還原回來)
async function restore({ saves, backup, key, now }) {
  const b = await backup.get(key, { type: "json" });
  if (!b || !b.state) return { ok: false, msg: "沒有這座城的備份" };
  const g = await saves.getWithMetadata(key, { type: "json" });
  const cur = g && g.data;
  const { bakAt, ...data } = b;
  const next = { ...data, rev: ((cur && cur.rev) || 0) + 1, updatedAt: now };
  const w = await saves.setJSON(key, next, g && g.etag ? { onlyIfMatch: g.etag } : { onlyIfNew: true });
  if (w && w.modified === false) return { ok: false, msg: "存檔正忙,請稍後再試" };
  if (cur && cur.state) await backup.setJSON(key, { ...cur, bakAt: now });
  return { ok: true, msg: "已還原備份", bakAt, rev: next.rev };
}
async function info({ backup, key }) {
  const b = await backup.get(key, { type: "json" });
  return b && b.state ? { key, bakAt: b.bakAt || 0, rev: b.rev || 0, saved: (b.state && b.state.saved) || 0 } : { key, none: 1 };
}
module.exports = { withBackup, restore, info, BUCKET_MS };
