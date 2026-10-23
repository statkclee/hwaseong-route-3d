// 투표소별 득표 지표 — 지도·DOM 에 의존하지 않는 순수 함수(node:test). 숫자의 뜻은 SPEC(투표소별-대선득표-지도) §1-2.
export const CANDS = [
  { k: "이재명", party: "더불어민주당", color: "#1D4ED8" }, { k: "김문수", party: "국민의힘", color: "#C0392B" },
  { k: "이준석", party: "개혁신당", color: "#E8710A" }, { k: "권영국", party: "민주노동당", color: "#8A6D1D" } ];
export const MODES = ["구성", ...CANDS.map(c => c.k), "격차"];      // 구성 = 후보별 색으로 쌓은 기둥(기본)
export const KEYS = [...CANDS.map(c => c.k), "기타"], OTHER_COLOR = "#9B9A92";
export const HEIGHT_PER_VOTER = 0.04;            // m — 5천 명 → 200m

// 득표율(%) = 득표 ÷ 유효투표. unit 은 {valid, 이재명, …}. 유효투표 0 이면 null(0% 와 구분)
export const share = (unit, k) => unit.valid > 0 ? unit[k] / unit.valid * 100 : null;
// 모드별 값: 후보 득표율, 또는 「격차」= 이재명% − 김문수%(+ 이재명 우세)
export const metric = (unit, mode) => mode === "격차" ? (unit.valid > 0 ? share(unit, "이재명") - share(unit, "김문수") : null) : share(unit, mode);
export const heightOf = p => p.elect * HEIGHT_PER_VOTER;
export const extent = (pts, mode, pick = p => p.eday) => { const v = pts.map(p => metric(pick(p), mode)).filter(x => x != null); return [Math.min(...v), Math.max(...v)]; };

import { haversine, pointAt } from "./route.mjs";
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), toHex = a => "#" + a.map(x => Math.round(x).toString(16).padStart(2, "0")).join("");
export const mix = (a, b, t) => toHex(hex(a).map((x, i) => x + (hex(b)[i] - x) * t));
// 색: 후보는 min→max 를 흰빛→후보색, 격차는 0 을 중심으로 김문수색(−)↔이재명색(+). 값 없음은 회색
export function colorOf(value, mode, [mn, mx]) {
  if (value == null) return "#9B9A92";
  if (mode === "격차") { const lim = Math.max(Math.abs(mn), Math.abs(mx)) || 1, t = Math.min(Math.abs(value) / lim, 1); return mix("#F4F3EE", value >= 0 ? CANDS[0].color : CANDS[1].color, t); }
  const c = CANDS.find(x => x.k === mode).color, t = mx > mn ? (value - mn) / (mx - mn) : 1; return mix("#F4F3EE", c, Math.min(Math.max(t, 0), 1));
}
// 같은 좌표를 쓰는 투표소는 동서로 ±off m 어긋 놓는다(원본 좌표는 건드리지 않고 표시 좌표만 돌려준다). 기둥 폭 40m 보다 중심 간격(2×off)이 커야 안 겹친다
export function displayCoords(pts, off = 25) {
  const key = p => p.lon.toFixed(6) + "," + p.lat.toFixed(6), groups = new Map(); pts.forEach((p, i) => { const k = key(p); (groups.get(k) ?? groups.set(k, []).get(k)).push(i); });
  const out = pts.map(p => [p.lon, p.lat]);
  for (const idx of groups.values()) if (idx.length > 1) idx.forEach((i, n) => { const dLon = off / (111320 * Math.cos(pts[i].lat * Math.PI / 180)); out[i] = [pts[i].lon + (n - (idx.length - 1) / 2) * 2 * dLon, pts[i].lat]; });
  return out;
}
export const pct = v => v == null ? "–" : v.toFixed(1) + "%";

// ── 인근 유권자 성향(모의 주행용) ───────────────────────────────────────────────
// pos 반경 radiusM 안 투표소의 「선거일 투표분」을 합산한다. 반경 안에 없으면 가장 가까운 1곳으로 대신하고 fallback 으로 알린다.
// 읍면동 소계는 합치지 않는다(투표구 득표와 중복). 득표 합 ÷ 유효 합 이므로 투표구 비율의 단순평균이 아니다.
export const FAR_M = 3000;   // 반경 안에 없고 가장 가까운 투표소도 이보다 멀면 「인근 투표소 없음」(관외·산지 — 성향을 말하지 않는다)
export function nearby(pts, pos, radiusM) {
  const hit = []; let near = { i: -1, d: Infinity };
  pts.forEach((p, i) => { const d = haversine(pos, [p.lon, p.lat]); if (d <= radiusM) hit.push(i); if (d < near.d) near = { i, d }; });
  const fallback = hit.length === 0, used = fallback ? [near.i] : hit, agg = { valid: 0, elect: 0 }; KEYS.forEach(k => agg[k] = 0);
  for (const i of used) { const p = pts[i]; agg.valid += p.eday.valid; agg.elect += p.elect; KEYS.forEach(k => agg[k] += p.eday[k]); }
  return { agg, n: used.length, fallback, nearestM: near.d, far: fallback && near.d > FAR_M };
}
// 경로를 따라 step m 마다 nearby 를 계산 — 여행 전체의 성향 변화(그래프·경로 색)
export function profile(path, pts, radiusM, step = 150) {
  const out = []; for (let d = 0; ; d += step) { const dd = Math.min(d, path.total), r = nearby(pts, pointAt(path, dd), radiusM);
    out.push({ d: dd, f: path.total ? dd / path.total : 0, shares: KEYS.map(k => share(r.agg, k)), lean: metric(r.agg, "격차"), n: r.n, fallback: r.fallback, far: r.far }); if (dd >= path.total) break; }
  return out;
}
