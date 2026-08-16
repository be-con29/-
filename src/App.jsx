import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";

/* ============================================================
   船跡 — ステップ2
   iPhone の Safari で本物の GPS を記録して航跡を描く
   ============================================================ */

const C = {
  deep: "#04141D", panel: "#0A2230", rule: "#16414F",
  text: "#B8D2DC", dim: "#5D8494", head: "#EAF6FA",
  red: "#FF5E5B", ok: "#4ED9C0",
};

const RAMP = [
  { kn: 0, c: [255, 122, 61] },
  { kn: 4, c: [255, 193, 61] },
  { kn: 10, c: [78, 217, 192] },
  { kn: 20, c: [53, 168, 232] },
];
function speedColor(kn) {
  if (kn <= 0) return RAMP[0].c;
  for (let i = 1; i < RAMP.length; i++) {
    if (kn <= RAMP[i].kn) {
      const a = RAMP[i - 1], b = RAMP[i];
      const t = (kn - a.kn) / (b.kn - a.kn);
      return [0, 1, 2].map((j) => Math.round(a.c[j] + (b.c[j] - a.c[j]) * t));
    }
  }
  return RAMP[3].c;
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const KN = 0.514444;

/* --- 緯度経度をメートルに直す（この規模なら十分な精度） --- */
function meters(p, ref) {
  return {
    x: (p.lng - ref.lng) * 111320 * Math.cos((ref.lat * Math.PI) / 180),
    y: (p.lat - ref.lat) * 111320,
  };
}

/* --- 間引き（Douglas-Peucker） --- */
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

export default function App() {
  const [pts, setPts] = useState([]);
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState(null);
  const [acc, setAcc] = useState(null);

  const watchRef = useRef(null);
  const lastRef = useRef(null);   // 10m フィルタ用の直近採用点
  const wakeRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const mono = `ui-monospace, "SF Mono", Menlo, monospace`;

  /* ---------- 記録開始 ---------- */
  const start = useCallback(async () => {
    if (!navigator.geolocation) {
      setErr("この環境では位置情報を取得できません。iPhone の Safari で開いてください。");
      return;
    }
    setErr(null);
    setPts([]); lastRef.current = null;

    // 画面が消えると Safari は記録を止めるので、スリープを抑止する
    try {
      wakeRef.current = await navigator.wakeLock?.request("screen");
    } catch { /* 非対応でも記録自体は続く */ }

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
          // 10m 進むか 5秒経つまでは捨てる
          if (dist < 10 && dt < 5) return;

          // speed / heading は端末が返さないことが多いので自前で計算
          p.kn = (c.speed != null && c.speed >= 0 ? c.speed : dist / Math.max(dt, 0.1)) / KN;
          p.hdg = c.heading != null && c.heading >= 0
            ? c.heading
            : (Math.atan2(m.x, m.y) * 180) / Math.PI;
        } else {
          p.kn = 0;
          p.hdg = 0;
        }
        if (p.hdg < 0) p.hdg += 360;

        lastRef.current = p;
        setPts((a) => [...a, p]);
      },
      (e) => {
        const msg = {
          1: "位置情報が許可されていません。設定 → Safari → 位置情報 で許可してください。",
          2: "現在地を取得できません。屋外で試してください。",
          3: "位置情報の取得がタイムアウトしました。",
        };
        setErr(msg[e.code] || "位置情報を取得できませんでした。");
        setRec(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    setRec(true);
  }, []);

  /* ---------- 記録停止 ---------- */
  const stop = useCallback(() => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    wakeRef.current?.release?.(); wakeRef.current = null;
    setRec(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  // 画面を戻したときスリープ抑止を張り直す
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
    return {
      xy, dist, max,
      mins: (pts[pts.length - 1].t - pts[0].t) / 60000,
      thin: simplify(xy, 5).length,
    };
  }, [pts]);

  /* ---------- 描画 ---------- */
  useEffect(() => {
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

    g.lineCap = g.lineJoin = "round";
    g.shadowBlur = 9;
    for (let i = 1; i < xy.length; i++) {
      const a = xy[i - 1], b = xy[i];
      const col = rgb(speedColor((a.kn + b.kn) / 2));
      g.strokeStyle = col; g.shadowColor = col;
      g.lineWidth = a.kn < 5 ? 3.4 : 2.2;
      g.beginPath(); g.moveTo(X(a), Y(a)); g.lineTo(X(b), Y(b)); g.stroke();
    }
    g.shadowBlur = 0;

    const cur = xy[xy.length - 1];
    g.save();
    g.translate(X(cur), Y(cur)); g.rotate((cur.hdg * Math.PI) / 180);
    g.fillStyle = C.red;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 7); g.lineTo(0, 4); g.lineTo(-5.5, 7);
    g.closePath(); g.fill();
    g.restore();
  }, [view]);

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
      navigator.share({ files: [file] }).catch(() => {});
      return;
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

  return (
    <div style={{
      minHeight: "100vh", background: C.deep, color: C.text,
      fontFamily: mono, display: "flex", flexDirection: "column",
    }}>
      <style>{`*{box-sizing:border-box}body{margin:0}
        @keyframes blip{0%,100%{opacity:1}50%{opacity:.2}}`}</style>

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
          {rec ? "記録中" : pts.length ? "停止中" : "待機中"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim }}>
          {acc != null ? `精度 ±${acc.toFixed(0)}m` : "—"}
        </span>
      </div>

      {err && (
        <div style={{
          padding: "12px 16px", background: "#2A1114",
          borderBottom: `1px solid ${C.red}`, fontSize: 12, color: "#FFC9C7", lineHeight: 1.6,
        }}>{err}</div>
      )}

      {/* プロット */}
      <div ref={wrapRef} style={{ position: "relative", flex: 1, minHeight: 300 }}>
        <canvas ref={canvasRef} style={{ display: "block" }} />
        {!view && !err && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            fontSize: 12, color: C.dim, textAlign: "center", padding: 24, lineHeight: 1.9,
          }}>
            記録を開始して、10m 以上動いてください。<br />
            屋外で車を走らせるのが確実です。
          </div>
        )}
        {last && (
          <div style={{
            position: "absolute", top: 13, left: 13,
            background: "rgba(4,20,29,.76)", border: `1px solid ${C.rule}`, padding: "8px 12px",
          }}>
            <div style={{ fontSize: 24, fontWeight: 600, color: C.head }}>
              {(last.kn || 0).toFixed(1)}
              <span style={{ fontSize: 11, color: C.dim, marginLeft: 4 }}>kn</span>
            </div>
            <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
              {String(Math.round(last.hdg || 0)).padStart(3, "0")}° ·{" "}
              {last.lat.toFixed(4)}N {last.lng.toFixed(4)}E
            </div>
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
          ["最高", view ? view.max.toFixed(1) : "0.0", "kn"],
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
        <button
          onClick={rec ? stop : start}
          style={{ ...btn, borderColor: rec ? C.red : C.ok, color: rec ? C.red : C.ok }}
        >
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
