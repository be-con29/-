/* ============================================================
   /api/tide  — 気象庁の潮位表を読んで JSON で返す
   ------------------------------------------------------------
   ブラウザから気象庁へ直接アクセスすると CORS で弾かれるため、
   Vercel 側で一度受けてから渡す「中継役」です。

   使い方: /api/tide?stn=I4&days=5
   出典表記が必要です:「潮位データ 出典：気象庁」
   ============================================================ */

export default async function handler(req, res) {
  const stn = String(req.query.stn || "I4").toUpperCase();
  const days = Math.min(14, Math.max(1, parseInt(req.query.days, 10) || 5));

  // 地点記号は英数字2桁のみ。おかしな値は弾く
  if (!/^[A-Z0-9]{2}$/.test(stn)) {
    return res.status(400).json({ error: "地点記号が不正です" });
  }

  const now = new Date();
  // 日本時間の今日
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const year = jst.getUTCFullYear();

  const url = `https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/${year}/${stn}.txt`;

  let text;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    text = await r.text();
  } catch (e) {
    return res.status(502).json({ error: "気象庁のデータを取得できませんでした" });
  }

  // 今日から days 日分だけ抜き出す
  const wanted = new Set();
  for (let i = 0; i < days; i++) {
    const d = new Date(jst.getTime() + i * 86400000);
    wanted.add(
      `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
    );
  }

  // 満潮・干潮の欄を読む（時刻4桁＋潮位3桁 が4回）
  const events = (line, start) => {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const t = line.substr(start + i * 7, 4);
      const v = line.substr(start + i * 7 + 4, 3);
      if (!t || t === "9999" || t.trim() === "") continue;
      const hh = parseInt(t.slice(0, 2), 10);
      const mm = parseInt(t.slice(2, 4), 10);
      const cm = parseInt(v, 10);
      if (isNaN(hh) || isNaN(mm) || isNaN(cm)) continue;
      out.push({ h: hh, m: mm, cm });
    }
    return out;
  };

  const out = {};
  for (const line of text.split("\n")) {
    if (line.length < 80) continue;
    const ymd = line.substr(72, 6);
    if (!wanted.has(ymd)) continue;

    const hourly = [];
    for (let i = 0; i < 24; i++) {
      const v = parseInt(line.substr(i * 3, 3), 10);
      hourly.push(isNaN(v) ? null : v);
    }

    const key = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
    out[key] = { hourly, high: events(line, 80), low: events(line, 108) };
  }

  // 1日1回しか変わらないデータなので長めにキャッシュさせる
  res.setHeader("Cache-Control", "public, s-maxage=43200, stale-while-revalidate=604800");
  return res.status(200).json({ stn, year, days: out, source: "気象庁" });
}
