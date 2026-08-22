import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";

/* ============================================================
   船跡 — ステップ4
   航跡 ＋ 海図レイヤー ＋ 海況（天気 / 風 / 波 / 雨雲レーダー）

   ※ Open-Meteo と RainViewer は「非商用なら無料」の条件です。
      有料化する前に、それぞれ商用の契約に切り替えてください。
   ============================================================ */

const C = {
  deep: "#04141D", panel: "#0A2230", rule: "#16414F",
  text: "#B8D2DC", dim: "#5D8494", head: "#EAF6FA",
  red: "#FF5E5B", ok: "#4ED9C0", warn: "#FFC13D",
};

const COLORS = [
  [255, 122, 61],   // 停船・渋滞
  [255, 193, 61],   // 流し・徐行
  [78, 217, 192],   // 中速
  [53, 168, 232],   // 航行・巡航
];

// 色が変わる速度。内部はすべてノットで持ち、表示だけ換算する
const STOPS = {
  kn:  [0, 4, 10, 20],                    // 船：0 / 4 / 10 / 20 kn
  kmh: [0, 8.1, 21.6, 43.2],              // 車：0 / 15 / 40 / 80 km/h をktに換算
};
const SLOW = { kn: 5, kmh: 8.1 };         // この速度未満は線を太くする

function speedColor(kn, unit = "kn") {
  const s = STOPS[unit];
  if (kn <= s[0]) return COLORS[0];
  for (let i = 1; i < 4; i++) {
    if (kn <= s[i]) {
      const t = (kn - s[i - 1]) / (s[i] - s[i - 1]);
      return [0, 1, 2].map((j) =>
        Math.round(COLORS[i - 1][j] + (COLORS[i][j] - COLORS[i - 1][j]) * t));
    }
  }
  return COLORS[3];
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const KN = 0.514444;

// ノット → 表示する単位
const conv = (kn, unit) => (unit === "kn" ? kn : kn * 1.852);
const unitLabel = (unit) => (unit === "kn" ? "kn" : "km/h");

const DIRS = ["北","北北東","北東","東北東","東","東南東","南東","南南東",
              "南","南南西","南西","西南西","西","西北西","北西","北北西"];
const dirName = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

// WMO の天気コード → 日本語
const WMO = {
  0:"快晴",1:"晴れ",2:"薄曇り",3:"曇り",45:"霧",48:"霧",
  51:"霧雨",53:"霧雨",55:"強い霧雨",61:"小雨",63:"雨",65:"大雨",
  71:"小雪",73:"雪",75:"大雪",77:"霧雪",
  80:"にわか雨",81:"にわか雨",82:"激しいにわか雨",
  85:"にわか雪",86:"にわか雪",95:"雷雨",96:"雷雨",99:"激しい雷雨",
};

function meters(p, ref) {
  return {
    x: (p.lng - ref.lng) * 111320 * Math.cos((ref.lat * Math.PI) / 180),
    y: (p.lat - ref.lat) * 111320,
  };
}

/* ============================================================
   気象庁 潮位表の観測地点（記号・名前・緯度・経度）
   ============================================================ */
const TIDE_STN = [
  ["WN","稚内",45.40,141.68],["KR","釧路",42.98,144.37],["HK","函館",41.78,140.72],
  ["B3","小樽",43.20,141.00],["TM","苫小牧",42.63,141.62],["AO","青森",40.83,140.77],
  ["HG","八戸",40.53,141.55],["MY","宮古",39.65,141.98],["AY","鮎川",38.30,141.50],
  ["SG","塩釜",38.32,141.03],["ON","小名浜",36.93,140.90],["S9","酒田",38.92,139.82],
  ["CS","銚子",35.75,140.87],["CB","千葉港",35.60,140.10],["TK","東京",35.65,139.77],
  ["QS","横浜",35.45,139.65],["Z1","油壺",35.17,139.62],["TT","館山",34.98,139.85],
  ["ZF","勝浦",35.13,140.25],["OK","大島岡田",34.78,139.38],["OD","小田原",35.23,139.15],
  ["Z3","伊東",34.90,139.13],["D6","下田",34.68,138.97],["G9","石廊崎",34.62,138.85],
  ["SM","清水港",35.02,138.52],["OM","御前崎",34.62,138.22],["MI","舞阪",34.68,137.62],
  ["I4","赤羽根",34.60,137.18],["G4","三河",34.73,137.32],["G5","形原",34.78,137.18],
  ["G8","衣浦",34.88,136.95],["ZD","鬼崎",34.90,136.82],["NG","名古屋",35.08,136.88],
  ["G3","四日市港",34.97,136.63],["TB","鳥羽",34.48,136.82],["OW","尾鷲",34.08,136.20],
  ["UR","浦神",33.57,135.90],["KS","串本",33.48,135.77],["SR","白浜",33.68,135.38],
  ["WY","和歌山",34.22,135.15],["OS","大阪",34.65,135.43],["KB","神戸",34.68,135.18],
  ["AK","明石",34.65,134.98],["ST","洲本",34.35,134.90],["TA","高松",34.35,134.05],
  ["Q8","広島",34.35,132.47],["MT","松山",33.87,132.72],["UW","宇和島",33.23,132.55],
  ["KC","高知",33.50,133.57],["MU","室戸岬",33.27,134.17],["TS","土佐清水",32.78,132.97],
  ["QF","博多",33.62,130.40],["NS","長崎",32.73,129.87],["KU","熊本",32.75,130.57],
  ["QC","大分",33.27,131.68],["X5","佐伯",32.95,131.97],["MG","宮崎",31.90,131.45],
  ["KG","鹿児島",31.60,130.57],["MK","枕崎",31.27,130.30],["TJ","種子島",30.47,130.97],
  ["O9","奄美",28.32,129.53],["NH","那覇",26.22,127.67],["IS","石垣",24.33,124.17],
  ["HA","浜田",34.90,132.07],["SK","境",35.55,133.25],["MZ","舞鶴",35.48,135.38],
  ["T1","金沢",36.62,136.60],["TY","富山",36.77,137.22],["T3","直江津",37.18,138.25],
  ["S6","新潟",37.93,139.07],
];

function nearestStation(lat, lng) {
  let best = TIDE_STN[27], bd = Infinity; // 既定は赤羽根
  for (const s of TIDE_STN) {
    const d = Math.hypot((s[2] - lat) * 111, (s[3] - lng) * 91);
    if (d < bd) { bd = d; best = s; }
  }
  return { code: best[0], name: best[1], lat: best[2], lng: best[3], km: bd };
}

/* --- 月齢から潮名（大潮・中潮など）を出す --- */
function tideName(date) {
  // 2000年1月6日 18:14 UTC の新月を基準にした概算
  const base = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((date.getTime() - base) / 86400000) % 29.530589 + 29.530589) % 29.530589;
  const d = Math.floor(age) + 1; // 旧暦の日に相当
  if (d <= 2 || (d >= 14 && d <= 17) || d >= 29) return { name: "大潮", age };
  if (d >= 3 && d <= 6) return { name: "中潮", age };
  if (d >= 7 && d <= 9) return { name: "小潮", age };
  if (d === 10) return { name: "長潮", age };
  if (d === 11) return { name: "若潮", age };
  if (d >= 12 && d <= 13) return { name: "中潮", age };
  if (d >= 18 && d <= 21) return { name: "中潮", age };
  if (d >= 22 && d <= 24) return { name: "小潮", age };
  if (d === 25) return { name: "長潮", age };
  if (d === 26) return { name: "若潮", age };
  return { name: "中潮", age };
}

function simplify(pts, tol) {
  if (tol <= 0 || pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    const ax = pts[s].x, ay = pts[s].y;
    const dx = pts[e].x - ax, dy = pts[e].y - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1, fd = -1;
    for (let i = s + 1; i < e; i++) {
      const px = pts[i].x - ax, py = pts[i].y - ay;
      let d;
      if (len2 === 0) d = Math.hypot(px, py);
      else {
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        d = Math.hypot(px - u * dx, py - u * dy);
      }
      if (d > fd) { fd = d; far = i; }
    }
    if (fd > tol) { keep[far] = 1; stack.push([s, far], [far, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function useLeaflet() {
  const [L, setL] = useState(null);
  useEffect(() => {
    if (window.L) { setL(window.L); return; }
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = () => setL(window.L);
    document.head.appendChild(js);
  }, []);
  return L;
}

export default function App() {
  const [pts, setPts] = useState([]);
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState(null);
  const [acc, setAcc] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [follow, setFollow] = useState(true);
  const [seamark, setSeamark] = useState(false);
  const [radar, setRadar] = useState(false);
  const [radarTime, setRadarTime] = useState(null);
  const [wx, setWx] = useState(null);
  const [wxBusy, setWxBusy] = useState(false);
  const [showWx, setShowWx] = useState(false);
  // 海況をどこで取るか。src: gps=自船 / center=地図中心 / manual=手で動かした
  const [wxPoint, setWxPoint] = useState(null);
  // 地点を動かすあいだパネルを縮める
  const [wxMin, setWxMin] = useState(false);
  const [wxTab, setWxTab] = useState("wx");   // wx = 気象 / tide = 潮汐
  const [tide, setTide] = useState(null);
  const [tideBusy, setTideBusy] = useState(false);
  // 速度の単位。船=kn / 車=km/h。選んだら端末に覚えさせる
  const [unit, setUnit] = useState(() => {
    try { return localStorage.getItem("funaato:unit") || "kn"; } catch { return "kn"; }
  });
  useEffect(() => {
    try { localStorage.setItem("funaato:unit", unit); } catch {}
  }, [unit]);

  const L = useLeaflet();
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const seaRef = useRef(null);
  const radarRef = useRef(null);
  const wxMarkRef = useRef(null);
  const segRef = useRef([]);
  const boatRef = useRef(null);
  const watchRef = useRef(null);
  const lastRef = useRef(null);
  const wakeRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const mono = `ui-monospace, "SF Mono", Menlo, monospace`;

  /* ---------- 圏内 / 圏外 ---------- */
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  /* ---------- 地図 ---------- */
  useEffect(() => {
    if (!L || !mapElRef.current || mapRef.current || !online) return;
    const map = L.map(mapElRef.current, {
      zoomControl: false, preferCanvas: true,
    }).setView([34.6, 137.1], 12);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    seaRef.current = L.tileLayer(
      "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
      { maxZoom: 18, attribution: "&copy; OpenSeaMap" }
    );

    L.control.zoom({ position: "bottomleft" }).addTo(map);
    map.on("dragstart", () => setFollow(false));
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);
  }, [L, online]);

  /* ---------- 航路標識レイヤー ---------- */
  useEffect(() => {
    const map = mapRef.current, sea = seaRef.current;
    if (!map || !sea) return;
    if (seamark) { if (!map.hasLayer(sea)) sea.addTo(map); }
    else if (map.hasLayer(sea)) map.removeLayer(sea);
  }, [seamark]);

  /* ---------- 雨雲レーダー ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;

    if (!radar) {
      if (radarRef.current) { map.removeLayer(radarRef.current); radarRef.current = null; }
      return;
    }
    let dead = false;
    (async () => {
      try {
        const r = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        const d = await r.json();
        const frames = d?.radar?.past || [];
        const f = frames[frames.length - 1];
        if (!f || dead) return;
        setRadarTime(new Date(f.time * 1000));
        if (radarRef.current) map.removeLayer(radarRef.current);
        radarRef.current = L.tileLayer(
          `${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
          { opacity: 0.62, maxZoom: 12, attribution: "Weather data by RainViewer" }
        ).addTo(map);
      } catch { /* 取れなければ静かに諦める */ }
    })();
    return () => { dead = true; };
  }, [L, radar]);

  /* ---------- 海況の取得 ---------- */
  const loadWx = useCallback(async (pt) => {
    const target = pt || wxPoint;
    if (!target) return;
    const { lat, lng } = target;

    setWxBusy(true);
    try {
      const [a, b] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
          `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code` +
          `&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=2`).then((r) => r.json()),
        fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}` +
          `&current=wave_height,wave_direction,wave_period,sea_surface_temperature` +
          `&hourly=wave_height&timezone=Asia%2FTokyo&forecast_days=2`)
          .then((r) => r.json()).catch(() => null),
      ]);

      // いまの時刻に対応する配列の位置を探す
      const now = new Date();
      const idx = Math.max(0, (a.hourly?.time || []).findIndex(
        (t) => new Date(t) >= new Date(now.getTime() - 3600000)
      ));

      const hours = [];
      for (let i = idx; i < Math.min(idx + 12, a.hourly.time.length); i++) {
        hours.push({
          t: new Date(a.hourly.time[i]),
          wind: a.hourly.wind_speed_10m[i],
          gust: a.hourly.wind_gusts_10m[i],
          dir: a.hourly.wind_direction_10m[i],
          wave: b?.hourly?.wave_height?.[i] ?? null,
        });
      }

      // 波のデータが実際に返ってきた地点と、指定した地点のズレを測る。
      // 大きく離れていたら、指定地点は陸の上とみなす。
      let offshore = b?.current?.wave_height != null;
      let gridGap = null;
      if (offshore && b?.latitude != null) {
        const g = meters({ lat: b.latitude, lng: b.longitude }, { lat, lng });
        gridGap = Math.hypot(g.x, g.y);
        if (gridGap > 25000) offshore = false;
      }

      setWx({
        temp: a.current?.temperature_2m,
        code: a.current?.weather_code,
        wind: a.current?.wind_speed_10m,
        gust: a.current?.wind_gusts_10m,
        dir: a.current?.wind_direction_10m,
        wave: b?.current?.wave_height ?? null,
        wavePeriod: b?.current?.wave_period ?? null,
        waveDir: b?.current?.wave_direction ?? null,
        sst: b?.current?.sea_surface_temperature ?? null,
        offshore, gridGap,
        hours,
        at: new Date(),
      });
    } catch {
      setWx(null);
    }
    setWxBusy(false);
  }, [wxPoint]);

  /* ---------- パネルを開いたら取得地点を決める ---------- */
  useEffect(() => {
    if (!showWx || wxPoint) return;
    const p = pts[pts.length - 1];
    const c = mapRef.current?.getCenter();
    const next = p
      ? { lat: p.lat, lng: p.lng, src: "gps" }
      : { lat: c?.lat ?? 34.6, lng: c?.lng ?? 137.1, src: "center" };
    setWxPoint(next);
    loadWx(next);
  }, [showWx, wxPoint, pts, loadWx]);

  /* ---------- 取得地点のマーカー（ドラッグで動かせる） ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;

    if (!showWx || !wxPoint) {
      if (wxMarkRef.current) { map.removeLayer(wxMarkRef.current); wxMarkRef.current = null; }
      return;
    }

    if (!wxMarkRef.current) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:26px;height:26px;border-radius:50%;
          border:2px solid ${C.warn};background:rgba(255,193,61,.22);
          box-shadow:0 0 10px rgba(255,193,61,.55);cursor:grab"></div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });
      const mk = L.marker([wxPoint.lat, wxPoint.lng], { icon, draggable: true, zIndexOffset: 900 })
        .addTo(map);
      // つまんだ瞬間にパネルを縮めて地図を広く見せる
      mk.on("dragstart", () => setWxMin(true));
      mk.on("dragend", () => {
        const ll = mk.getLatLng();
        const next = { lat: ll.lat, lng: ll.lng, src: "manual" };
        setWxPoint(next);
        loadWx(next);
        setWxMin(false);
      });
      wxMarkRef.current = mk;
    } else {
      wxMarkRef.current.setLatLng([wxPoint.lat, wxPoint.lng]);
    }
  }, [L, showWx, wxPoint, loadWx]);

  /* ---------- 地図をタップした場所へ地点を移す ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showWx) return;
    const onTap = (e) => {
      const next = { lat: e.latlng.lat, lng: e.latlng.lng, src: "manual" };
      setWxPoint(next);
      loadWx(next);
    };
    map.on("click", onTap);
    return () => map.off("click", onTap);
  }, [showWx, loadWx]);

  /* ---------- 潮汐の取得 ---------- */
  const loadTide = useCallback(async (pt) => {
    const target = pt || wxPoint;
    if (!target) return;
    const st = nearestStation(target.lat, target.lng);

    // 同じ地点なら取り直さない
    if (tide?.st?.code === st.code) return;

    setTideBusy(true);
    const key = `tide:${st.code}:${new Date().toISOString().slice(0, 10)}`;

    try {
      // 一度取ったものは端末に残す。電波が切れても昨日の分が残る
      const cached = localStorage.getItem(key);
      if (cached) {
        setTide({ st, ...JSON.parse(cached) });
        setTideBusy(false);
        return;
      }
    } catch {}

    try {
      const r = await fetch(`/api/tide?stn=${st.code}&days=5`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      try { localStorage.setItem(key, JSON.stringify({ days: d.days })); } catch {}
      setTide({ st, days: d.days });
    } catch {
      setTide({ st, days: null });
    }
    setTideBusy(false);
  }, [wxPoint, tide]);

  useEffect(() => {
    if (showWx && wxTab === "tide" && wxPoint) loadTide(wxPoint);
  }, [showWx, wxTab, wxPoint, loadTide]);

  /* ---------- 今日の潮汐を組み立てる ---------- */
  const today = useMemo(() => {
    if (!tide?.days) return null;
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const d = tide.days[key];
    if (!d) return null;

    const vals = d.hourly.filter((v) => v != null);
    const min = Math.min(...vals), max = Math.max(...vals);

    // いまの潮位を前後の毎時値から補間する
    const h = now.getHours(), m = now.getMinutes();
    const a = d.hourly[h], b = h < 23 ? d.hourly[h + 1] : d.hourly[23];
    const level = a != null && b != null ? a + (b - a) * (m / 60) : null;

    // 次の満潮・干潮
    const mins = h * 60 + m;
    const next = [
      ...d.high.map((e) => ({ ...e, kind: "満潮" })),
      ...d.low.map((e) => ({ ...e, kind: "干潮" })),
    ].filter((e) => e.h * 60 + e.m > mins)
     .sort((x, y) => (x.h * 60 + x.m) - (y.h * 60 + y.m))[0] || null;

    return { ...d, min, max, level, next, name: tideName(now) };
  }, [tide]);

  /* ---------- 取得地点を地図の中心へ移す ---------- */
  const wxToCenter = useCallback(() => {
    const c = mapRef.current?.getCenter();
    if (!c) return;
    const next = { lat: c.lat, lng: c.lng, src: "center" };
    setWxPoint(next);
    loadWx(next);
  }, [loadWx]);

  /* ---------- 取得地点を自船へ戻す ---------- */
  const wxToBoat = useCallback(() => {
    const p = pts[pts.length - 1];
    if (!p) return;
    const next = { lat: p.lat, lng: p.lng, src: "gps" };
    setWxPoint(next);
    loadWx(next);
    mapRef.current?.panTo([p.lat, p.lng]);
  }, [pts, loadWx]);

  /* ---------- 航跡の描画 ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map || pts.length < 2) return;
    for (let i = segRef.current.length + 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const gap = b.t - a.t > 15000; // 15秒以上あいたら線をつながない
      segRef.current.push(
        L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
          color: rgb(speedColor((a.kn + b.kn) / 2, unit)),
          weight: a.kn < SLOW[unit] ? 6 : 4,
          opacity: gap ? 0 : 0.9,
          lineCap: "round",
        }).addTo(map)
      );
    }
    const cur = pts[pts.length - 1];
    if (!boatRef.current) {
      boatRef.current = L.circleMarker([cur.lat, cur.lng], {
        radius: 7, color: "#fff", weight: 2, fillColor: C.red, fillOpacity: 1,
      }).addTo(map);
    } else boatRef.current.setLatLng([cur.lat, cur.lng]);
    if (follow) map.panTo([cur.lat, cur.lng], { animate: true, duration: 0.4 });
  }, [L, pts, follow, unit]);

  /* ---------- 記録 ---------- */
  const start = useCallback(async () => {
    if (!navigator.geolocation) { setErr("位置情報を取得できません。"); return; }
    setErr(null);
    segRef.current.forEach((s) => s.remove());
    segRef.current = [];
    setPts([]); lastRef.current = null; setFollow(true);
    try { wakeRef.current = await navigator.wakeLock?.request("screen"); } catch {}

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        setAcc(c.accuracy);
        const p = { lat: c.latitude, lng: c.longitude, t: pos.timestamp };
        const prev = lastRef.current;
        if (prev) {
          const m = meters(p, prev);
          const dist = Math.hypot(m.x, m.y);
          const dt = (p.t - prev.t) / 1000;
          if (dist < 10 && dt < 5) return;
          p.kn = (c.speed != null && c.speed >= 0 ? c.speed : dist / Math.max(dt, 0.1)) / KN;
          p.hdg = c.heading != null && c.heading >= 0
            ? c.heading : (Math.atan2(m.x, m.y) * 180) / Math.PI;
        } else {
          p.kn = 0; p.hdg = 0;
          mapRef.current?.setView([p.lat, p.lng], 16);
        }
        if (p.hdg < 0) p.hdg += 360;
        lastRef.current = p;
        setPts((a) => [...a, p]);
      },
      (e) => {
        setErr({
          1: "位置情報が許可されていません。設定 → プライバシー → 位置情報サービス を確認してください。",
          2: "現在地を取得できません。屋外で試してください。",
          3: "位置情報の取得がタイムアウトしました。",
        }[e.code] || "位置情報を取得できませんでした。");
        setRec(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    setRec(true);
  }, []);

  const stop = useCallback(() => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    wakeRef.current?.release?.(); wakeRef.current = null;
    setRec(false);
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    const h = async () => {
      if (rec && document.visibilityState === "visible" && !wakeRef.current) {
        try { wakeRef.current = await navigator.wakeLock?.request("screen"); } catch {}
      }
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [rec]);

  /* ---------- 集計 ---------- */
  const view = useMemo(() => {
    if (pts.length < 2) return null;
    const ref = pts[0];
    const xy = pts.map((p) => ({ ...p, ...meters(p, ref) }));
    let dist = 0, max = 0;
    for (let i = 1; i < xy.length; i++) {
      dist += Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
      if (xy[i].kn > max) max = xy[i].kn;
    }
    return { xy, dist, max, thin: simplify(xy, 5).length };
  }, [pts]);

  /* ---------- 圏外の描画 ---------- */
  useEffect(() => {
    if (online) return;
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + "px"; cv.style.height = H + "px";
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!view) return;
    const { xy } = view;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of xy) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const pad = 30;
    const s = Math.min((W - pad * 2) / Math.max(x1 - x0, 30), (H - pad * 2) / Math.max(y1 - y0, 30));
    const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
    const X = (p) => ox + (p.x - x0) * s;
    const Y = (p) => H - (oy + (p.y - y0) * s);
    g.lineCap = g.lineJoin = "round"; g.shadowBlur = 9;
    for (let i = 1; i < xy.length; i++) {
      const a = xy[i - 1], b = xy[i];
      const col = rgb(speedColor((a.kn + b.kn) / 2, unit));
      g.strokeStyle = col; g.shadowColor = col;
      g.lineWidth = a.kn < SLOW[unit] ? 3.4 : 2.2;
      g.beginPath(); g.moveTo(X(a), Y(a)); g.lineTo(X(b), Y(b)); g.stroke();
    }
    g.shadowBlur = 0;
    const cur = xy[xy.length - 1];
    g.fillStyle = C.red;
    g.beginPath(); g.arc(X(cur), Y(cur), 5, 0, 6.284); g.fill();
  }, [online, view, unit]);

  /* ---------- 書き出し ---------- */
  const save = (kind) => {
    let body, name, type;
    if (kind === "gpx") {
      const seg = pts.map((p) =>
        `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`
      ).join("\n");
      body = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="funaato" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>航跡 ${new Date(pts[0].t).toLocaleString("ja-JP")}</name><trkseg>
${seg}
</trkseg></trk></gpx>`;
      name = "track.gpx"; type = "application/gpx+xml";
    } else {
      body = JSON.stringify(pts, null, 1);
      name = "track.json"; type = "application/json";
    }
    const blob = new Blob([body], { type });
    const file = new File([blob], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch(() => {}); return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const last = pts[pts.length - 1];
  const label = { font: `500 10px ${mono}`, letterSpacing: ".14em", color: C.dim };
  const btn = {
    flex: 1, padding: "12px", background: "transparent",
    border: `1px solid ${C.rule}`, color: C.head,
    font: `500 12px ${mono}`, letterSpacing: ".12em", cursor: "pointer",
  };
  const chip = (on) => ({
    padding: "6px 10px", fontSize: 10, letterSpacing: ".08em",
    background: on ? "rgba(78,217,192,.15)" : "rgba(4,20,29,.8)",
    border: `1px solid ${on ? C.ok : C.rule}`,
    color: on ? C.ok : C.dim, cursor: "pointer", fontFamily: mono,
  });

  // 風速に応じた色（8m/s 超えたら注意、12 超えたら危険）
  const windColor = (ms) => (ms >= 12 ? C.red : ms >= 8 ? C.warn : C.ok);
  const maxWind = wx ? Math.max(12, ...wx.hours.map((h) => h.gust || h.wind)) : 12;

  return (
    <div style={{
      minHeight: "100vh", background: C.deep, color: C.text,
      fontFamily: mono, display: "flex", flexDirection: "column",
    }}>
      <style>{`*{box-sizing:border-box}body{margin:0}
        @keyframes blip{0%,100%{opacity:1}50%{opacity:.2}}
        .leaflet-container{background:${C.deep}!important;font-family:${mono}}
        .leaflet-control-attribution{
          background:rgba(4,20,29,.8)!important;color:${C.dim}!important;font-size:9px!important}
        .leaflet-control-attribution a{color:${C.dim}!important}
        .leaflet-bar a{background:${C.panel}!important;color:${C.head}!important;
          border-color:${C.rule}!important}`}</style>

      {/* 状態バー */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "11px 16px", borderBottom: `1px solid ${C.rule}`, background: C.panel,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: rec ? C.red : C.dim,
          animation: rec ? "blip 1.8s ease-in-out infinite" : "none",
        }} />
        <span style={{ fontSize: 12, color: C.head }}>
          {online ? (rec ? "記録中" : pts.length ? "停止中" : "待機中")
                  : "オフライン｜航跡は記録中です"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim }}>
          {acc != null ? `±${acc.toFixed(0)}m` : "—"}
        </span>
      </div>

      {err && (
        <div style={{
          padding: "12px 16px", background: "#2A1114",
          borderBottom: `1px solid ${C.red}`, fontSize: 12, color: "#FFC9C7", lineHeight: 1.6,
        }}>{err}</div>
      )}

      {/* 地図 / 圏外画面 */}
      <div ref={wrapRef} style={{ position: "relative", flex: 1, minHeight: 340 }}>
        {online ? <div ref={mapElRef} style={{ position: "absolute", inset: 0 }} />
                : <canvas ref={canvasRef} style={{ display: "block" }} />}

        {online && (
          <div style={{
            position: "absolute", top: 12, right: 12, zIndex: 500,
            display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end",
          }}>
            <button onClick={() => setUnit((u) => (u === "kn" ? "kmh" : "kn"))}
                    style={chip(false)}>
              {unit === "kn" ? "船 kn" : "車 km/h"}
            </button>
            <button onClick={() => setShowWx((v) => !v)} style={chip(showWx)}>海況</button>
            <button onClick={() => setRadar((v) => !v)} style={chip(radar)}>雨雲</button>
            <button onClick={() => setSeamark((v) => !v)} style={chip(seamark)}>航路標識</button>
            <button onClick={() => setFollow((v) => !v)} style={chip(follow)}>自船追従</button>
          </div>
        )}

        {radar && radarTime && (
          <div style={{
            position: "absolute", bottom: 14, right: 12, zIndex: 500,
            background: "rgba(4,20,29,.82)", border: `1px solid ${C.rule}`,
            padding: "4px 9px", fontSize: 10, color: C.dim,
          }}>
            雨雲 {radarTime.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}

        {last && (
          <div style={{
            position: "absolute", top: 12, left: 12, zIndex: 500,
            background: "rgba(4,20,29,.82)", border: `1px solid ${C.rule}`, padding: "8px 12px",
          }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: C.head }}>
              {conv(last.kn || 0, unit).toFixed(1)}
              <span style={{ fontSize: 11, color: C.dim, marginLeft: 4 }}>{unitLabel(unit)}</span>
            </div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
              {String(Math.round(last.hdg || 0)).padStart(3, "0")}° ·{" "}
              {last.lat.toFixed(4)}N {last.lng.toFixed(4)}E
            </div>
          </div>
        )}

        {/* 海況パネル */}
        {showWx && online && wxMin && (
          <div
            onClick={() => setWxMin(false)}
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 600,
              background: "rgba(6,25,36,.94)", borderTop: `1px solid ${C.rule}`,
              padding: "10px 16px", display: "flex", alignItems: "center", gap: 14,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 11, color: C.warn }}>海況</span>
            {wx ? (
              <>
                <span style={{ fontSize: 12, color: windColor(wx.wind) }}>
                  {dirName(wx.dir)} {wx.wind?.toFixed(1)}
                  <span style={{ fontSize: 9, color: C.dim }}> m/s</span>
                </span>
                <span style={{ fontSize: 12, color: C.head }}>
                  波 {wx.offshore && wx.wave != null ? `${wx.wave.toFixed(1)}m` : "—"}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11, color: C.dim }}>読み込み中…</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 10, color: C.dim }}>タップで展開 ▲</span>
          </div>
        )}

        {showWx && online && !wxMin && (
          <div style={{
            position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 600,
            background: "rgba(6,25,36,.96)", borderTop: `1px solid ${C.rule}`,
            padding: "14px 16px 16px", maxHeight: "58%", overflowY: "auto",
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <span style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setWxTab("wx")} style={chip(wxTab === "wx")}>気象</button>
                <button onClick={() => setWxTab("tide")} style={chip(wxTab === "tide")}>潮汐</button>
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button onClick={() => setWxMin(true)} style={chip(false)}>縮小 ▼</button>
                <button onClick={() => setShowWx(false)} style={chip(false)}>閉じる</button>
              </span>
            </div>

            {/* 取得地点の表示と切り替え */}
            {wxPoint && (
              <div style={{
                border: `1px solid ${C.rule}`, background: C.deep,
                padding: "9px 11px", marginBottom: 12,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C.warn }}>
                    {{ gps: "自船の位置", center: "地図の中心", manual: "手で指定した地点" }[wxPoint.src]}
                  </span>
                  <span style={{ fontSize: 11, color: C.dim }}>
                    {wxPoint.lat.toFixed(4)}N {wxPoint.lng.toFixed(4)}E
                  </span>
                </div>
                <div style={{ display: "flex", gap: 7, marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={wxToCenter} style={chip(false)}>地図の中心へ</button>
                  {pts.length > 0 && (
                    <button onClick={wxToBoat} style={chip(false)}>自船へ戻す</button>
                  )}
                </div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 8, lineHeight: 1.7 }}>
                  地図をタップするか、黄色い丸をドラッグしても動かせます
                </div>
              </div>
            )}

            {wxTab === "wx" && (
              <>
            {wxBusy && <div style={{ fontSize: 12, color: C.dim, padding: "18px 0" }}>読み込み中…</div>}

            {!wxBusy && !wx && (
              <div style={{ fontSize: 12, color: C.dim, padding: "18px 0", lineHeight: 1.8 }}>
                海況を取得できませんでした。電波状況を確認して「更新」を押してください。
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => loadWx()} style={chip(false)}>更新</button>
                </div>
              </div>
            )}

            {!wxBusy && wx && !wx.offshore && (
              <div style={{
                border: `1px solid ${C.warn}`, background: "rgba(255,193,61,.09)",
                padding: "11px 13px", marginBottom: 12,
                fontSize: 11, color: C.warn, lineHeight: 1.8,
              }}>
                この地点は陸上のようです。波と水温は表示できません。<br />
                <span style={{ color: C.dim }}>
                  地図を海の上まで動かして「地図の中心へ」を押すか、黄色い丸を海へドラッグしてください。
                  天気と風は陸上でも表示されます。
                </span>
              </div>
            )}

            {!wxBusy && wx && (
              <>
                {/* 現在値 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 1,
                              background: C.rule, border: `1px solid ${C.rule}` }}>
                  <div style={{ background: C.deep, padding: "11px 13px" }}>
                    <div style={label}>天気</div>
                    <div style={{ fontSize: 17, color: C.head, marginTop: 4 }}>
                      {WMO[wx.code] ?? "—"}
                      <span style={{ fontSize: 12, color: C.dim, marginLeft: 7 }}>
                        {wx.temp?.toFixed(1)}℃
                      </span>
                    </div>
                  </div>
                  <div style={{ background: C.deep, padding: "11px 13px" }}>
                    <div style={label}>風</div>
                    <div style={{ fontSize: 17, color: windColor(wx.wind), marginTop: 4 }}>
                      {dirName(wx.dir)} {wx.wind?.toFixed(1)}
                      <span style={{ fontSize: 10, color: C.dim, marginLeft: 3 }}>m/s</span>
                    </div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                      最大瞬間 {wx.gust?.toFixed(1)} m/s
                    </div>
                  </div>
                  <div style={{ background: C.deep, padding: "11px 13px" }}>
                    <div style={label}>波</div>
                    <div style={{ fontSize: 17, color: wx.offshore ? C.head : C.dim, marginTop: 4 }}>
                      {wx.offshore && wx.wave != null ? `${wx.wave.toFixed(1)} m` : "—"}
                    </div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                      {wx.offshore && wx.wavePeriod != null ? `周期 ${wx.wavePeriod.toFixed(0)}秒` : ""}
                      {wx.offshore && wx.waveDir != null ? ` · ${dirName(wx.waveDir)}から` : ""}
                    </div>
                  </div>
                  <div style={{ background: C.deep, padding: "11px 13px" }}>
                    <div style={label}>水温</div>
                    <div style={{ fontSize: 17, color: wx.offshore ? C.head : C.dim, marginTop: 4 }}>
                      {wx.offshore && wx.sst != null ? `${wx.sst.toFixed(1)} ℃` : "—"}
                    </div>
                  </div>
                </div>

                {/* 12時間の推移 */}
                <div style={{ ...label, marginTop: 16, marginBottom: 8 }}>これから12時間</div>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
                  {wx.hours.map((h, i) => {
                    const v = h.gust || h.wind;
                    return (
                      <div key={i} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 8, color: C.dim, marginBottom: 3 }}>
                          {wx.offshore && h.wave != null ? h.wave.toFixed(1) : ""}
                        </div>
                        <div style={{
                          height: Math.max(4, (v / maxWind) * 54),
                          background: windColor(h.wind),
                          opacity: 0.85, borderRadius: 1,
                        }} />
                        <div style={{ fontSize: 8, color: C.dim, marginTop: 4 }}>
                          {h.t.getHours()}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 8, lineHeight: 1.7 }}>
                  棒＝最大瞬間風速（黄8m/s以上・赤12m/s以上）、上の数字＝波高(m)、下＝時刻
                </div>

                <div style={{ fontSize: 9, color: C.dim, marginTop: 14, lineHeight: 1.8,
                              borderTop: `1px solid ${C.rule}`, paddingTop: 10 }}>
                  予報：Open-Meteo ／ 雨雲：Weather data by RainViewer<br />
                  外洋の波浪モデルは約28kmメッシュです。湾内や沿岸の細かい海況は実際と異なる場合があります。
                  出港の判断は気象庁の海上警報を必ず確認してください。
                </div>
              </>
            )}
              </>
            )}

            {/* ===== 潮汐タブ ===== */}
            {wxTab === "tide" && (
              <>
                {tideBusy && (
                  <div style={{ fontSize: 12, color: C.dim, padding: "18px 0" }}>読み込み中…</div>
                )}

                {!tideBusy && tide && (
                  <div style={{ fontSize: 11, color: C.dim, marginBottom: 12 }}>
                    観測地点：<span style={{ color: C.head }}>{tide.st.name}</span>
                    <span style={{ marginLeft: 7 }}>（この地点から約 {Math.round(tide.st.km)}km）</span>
                  </div>
                )}

                {!tideBusy && tide && !today && (
                  <div style={{ fontSize: 12, color: C.dim, padding: "18px 0", lineHeight: 1.8 }}>
                    潮汐データを取得できませんでした。電波状況を確認してから開き直してください。
                  </div>
                )}

                {!tideBusy && today && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1,
                                  background: C.rule, border: `1px solid ${C.rule}` }}>
                      <div style={{ background: C.deep, padding: "11px 12px" }}>
                        <div style={label}>潮回り</div>
                        <div style={{
                          fontSize: 17, marginTop: 4,
                          color: today.name.name === "大潮" ? C.warn : C.head,
                        }}>{today.name.name}</div>
                        <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>
                          月齢 {today.name.age.toFixed(1)}
                        </div>
                      </div>
                      <div style={{ background: C.deep, padding: "11px 12px" }}>
                        <div style={label}>現在の潮位</div>
                        <div style={{ fontSize: 17, color: C.head, marginTop: 4 }}>
                          {today.level != null ? Math.round(today.level) : "—"}
                          <span style={{ fontSize: 10, color: C.dim, marginLeft: 2 }}>cm</span>
                        </div>
                      </div>
                      <div style={{ background: C.deep, padding: "11px 12px" }}>
                        <div style={label}>干満差</div>
                        <div style={{ fontSize: 17, color: C.head, marginTop: 4 }}>
                          {today.max - today.min}
                          <span style={{ fontSize: 10, color: C.dim, marginLeft: 2 }}>cm</span>
                        </div>
                      </div>
                    </div>

                    {today.next && (
                      <div style={{
                        marginTop: 12, padding: "10px 12px",
                        border: `1px solid ${C.ok}`, background: "rgba(78,217,192,.08)",
                        fontSize: 13, color: C.ok,
                      }}>
                        次は {String(today.next.h).padStart(2, "0")}:{String(today.next.m).padStart(2, "0")} に
                        <span style={{ fontWeight: 600 }}> {today.next.kind}</span>（{today.next.cm}cm）
                      </div>
                    )}

                    {/* 潮位カーブ */}
                    <div style={{ ...label, marginTop: 16, marginBottom: 6 }}>今日の潮位</div>
                    <svg viewBox="0 0 340 96" style={{ width: "100%", height: 96, display: "block" }}>
                      <polyline
                        points={today.hourly.map((v, i) =>
                          v == null ? "" :
                          `${(i / 23) * 336 + 2},${90 - ((v - today.min) / Math.max(1, today.max - today.min)) * 76}`
                        ).filter(Boolean).join(" ")}
                        fill="none" stroke={C.ok} strokeWidth="2"
                        strokeLinejoin="round" strokeLinecap="round"
                      />
                      {/* いまの時刻 */}
                      <line
                        x1={((new Date().getHours() + new Date().getMinutes() / 60) / 23) * 336 + 2} y1="4"
                        x2={((new Date().getHours() + new Date().getMinutes() / 60) / 23) * 336 + 2} y2="90"
                        stroke={C.red} strokeWidth="1.5" strokeDasharray="3 3"
                      />
                      {[0, 6, 12, 18, 23].map((h) => (
                        <text key={h} x={(h / 23) * 336 + 2} y="96"
                              fill={C.dim} fontSize="8" textAnchor="middle">{h}</text>
                      ))}
                    </svg>

                    {/* 満潮・干潮の一覧 */}
                    <div style={{ display: "flex", gap: 1, marginTop: 12,
                                  background: C.rule, border: `1px solid ${C.rule}` }}>
                      {[["満潮", today.high, C.head], ["干潮", today.low, C.dim]].map(([k, arr, col]) => (
                        <div key={k} style={{ flex: 1, background: C.deep, padding: "10px 12px" }}>
                          <div style={label}>{k}</div>
                          {arr.length === 0 && (
                            <div style={{ fontSize: 12, color: C.dim, marginTop: 5 }}>—</div>
                          )}
                          {arr.map((e, i) => (
                            <div key={i} style={{ fontSize: 13, color: col, marginTop: 5 }}>
                              {String(e.h).padStart(2, "0")}:{String(e.m).padStart(2, "0")}
                              <span style={{ fontSize: 10, color: C.dim, marginLeft: 6 }}>{e.cm}cm</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    {/* 潮流について */}
                    <div style={{
                      marginTop: 14, padding: "11px 12px",
                      border: `1px solid ${C.rule}`, background: C.deep,
                      fontSize: 10, color: C.dim, lineHeight: 1.8,
                    }}>
                      <span style={{ color: C.text }}>潮流について</span><br />
                      伊良湖水道の潮流推算は、アプリに取り込める形では公開されていません。
                      伊勢湾海上交通センターの
                      <a href="https://www6.kaiho.mlit.go.jp/isewan/currenttide.html"
                         target="_blank" rel="noreferrer"
                         style={{ color: C.ok, marginLeft: 3 }}>潮汐・潮流情報</a>
                      をご確認ください。
                    </div>

                    <div style={{ fontSize: 9, color: C.dim, marginTop: 14, lineHeight: 1.8,
                                  borderTop: `1px solid ${C.rule}`, paddingTop: 10 }}>
                      潮位データ 出典：気象庁（潮位表基準面上の値・予測値）<br />
                      観測地点が離れているほど実際とのズレが大きくなります。
                      航海には海上保安庁刊行の潮汐表をご使用ください。
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* 集計 */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4,1fr)",
        borderTop: `1px solid ${C.rule}`, background: C.panel,
      }}>
        {[
          ["距離", view ? (view.dist / 1000).toFixed(2) : "0.00", "km"],
          ["最高", view ? conv(view.max, unit).toFixed(1) : "0.0", unitLabel(unit)],
          ["点数", pts.length, ""],
          ["5m間引", view ? view.thin : 0, ""],
        ].map(([k, v, u]) => (
          <div key={k} style={{ padding: "11px 12px", borderRight: `1px solid ${C.rule}` }}>
            <div style={label}>{k}</div>
            <div style={{ fontSize: 16, color: C.head, marginTop: 3 }}>
              {v}<span style={{ fontSize: 9, color: C.dim, marginLeft: 2 }}>{u}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 操作 */}
      <div style={{ padding: 14, background: C.panel, display: "flex", gap: 9 }}>
        <button onClick={rec ? stop : start}
          style={{ ...btn, borderColor: rec ? C.red : C.ok, color: rec ? C.red : C.ok }}>
          {rec ? "記録を停止" : "記録を開始"}
        </button>
        {pts.length > 1 && !rec && (
          <>
            <button onClick={() => save("gpx")} style={btn}>GPX</button>
            <button onClick={() => save("json")} style={btn}>JSON</button>
          </>
        )}
      </div>

      <div style={{
        padding: "0 16px 18px", background: C.panel,
        fontSize: 10, color: C.dim, lineHeight: 1.8,
      }}>
        画面を消すと Safari は記録を止めます。走行中は画面を点けたままにしてください。
      </div>
    </div>
  );
}
