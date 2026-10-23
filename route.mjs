// 경로 기하 — 지도·DOM 에 의존하지 않는 순수 함수(node:test 로 검증). app.js 가 가져다 쓴다.
const R = 6371008.8, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

export function haversine([x1, y1], [x2, y2]) {
  const dy = rad(y2 - y1), dx = rad(x2 - x1), a = Math.sin(dy / 2) ** 2 + Math.cos(rad(y1)) * Math.cos(rad(y2)) * Math.sin(dx / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function bearing([x1, y1], [x2, y2]) {      // 0=북, 시계방향, 0~360
  const dx = rad(x2 - x1), p1 = rad(y1), p2 = rad(y2);
  return (deg(Math.atan2(Math.sin(dx) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dx))) + 360) % 360;
}
// 누적거리 표. cum[i] = 0번 점에서 i번 점까지 m
export function buildPath(coords) {
  const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return { coords, cum, total: cum[cum.length - 1] };
}
function seg(path, d) {                            // d 가 놓인 구간 인덱스(이진 탐색)
  let lo = 0, hi = path.cum.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (path.cum[m] <= d) lo = m; else hi = m - 1; }
  return lo;
}
export function pointAt(path, d) {
  d = Math.min(Math.max(d, 0), path.total); const i = seg(path, d), len = path.cum[i + 1] - path.cum[i], t = len > 0 ? (d - path.cum[i]) / len : 0;
  const [x1, y1] = path.coords[i], [x2, y2] = path.coords[i + 1]; return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
}
// 진행 방향 — 현재 위치에서 look m 앞을 본다(꺾임마다 카메라가 튀지 않게). 끝에서는 look 만큼 뒤를 본다
export function bearingAt(path, d, look = 120) {
  const a = Math.min(d, Math.max(path.total - look, 0)); return bearing(pointAt(path, a), pointAt(path, Math.min(a + look, path.total)));
}
// 각도 보간 — 최단 호로 돈다(350°→10° 가 340° 를 돌지 않게)
export function smoothAngle(prev, next, k) { const diff = ((next - prev + 540) % 360) - 180; return (prev + diff * k + 360) % 360; }
// 0~d 까지의 좌표열(진행한 부분을 그릴 때)
export function slice(path, d) { d = Math.min(Math.max(d, 0), path.total); const i = seg(path, d); return [...path.coords.slice(0, i + 1), pointAt(path, d)]; }

// 차량 상자(길이 len · 폭 wid m)를 진행 방향 brg 로 놓은 닫힌 링
export function boxRing([x, y], brg, len = 46, wid = 20) {
  const mLat = 111320, mLon = 111320 * Math.cos(rad(y)), b = rad(brg), fx = Math.sin(b), fy = Math.cos(b), rx = fy, ry = -fx;
  const c = [[1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]].map(([f, s]) => { const e = f * len / 2 * fx + s * wid / 2 * rx, n = f * len / 2 * fy + s * wid / 2 * ry; return [x + e / mLon, y + n / mLat]; });
  return c;
}

// 점 → 행정동. features 는 emd GeoJSON(Polygon/MultiPolygon, 속성 dong·gu)
const inRing = ([x, y], ring) => { let ins = false; for (let i = 0; i < ring.length - 1; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]; if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) ins = !ins; } return ins; };
export function locate(pt, features) {
  for (const f of features) { const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
    if (polys.some(p => inRing(pt, p[0]) && !p.slice(1).some(h => inRing(pt, h)))) return f.properties; }
  return null;
}
// 경로가 지나는 동 순서(연속 중복 제거) + 구간 길이(m). 경계선 근처의 판정 흔들림(진안동↔병점2동 등)으로 생기는
// minLen(200m) 미만 조각은 앞 구간에 합친다. 구간은 이어 붙어 있어 길이 합 = 총거리. 시 밖은 "관외"
export function dongsAlong(path, features, step = 100, minLen = 200) {
  let seq = []; for (let d = 0; d <= path.total; d += step) {
    const p = locate(pointAt(path, d), features), name = p ? p.dong : "관외", last = seq[seq.length - 1];
    if (last && last.dong === name) last.to = d; else seq.push({ dong: name, gu: p?.gu ?? null, from: d, to: d });
  }
  const seal = () => { seq.forEach((s, k) => { s.to = k < seq.length - 1 ? seq[k + 1].from : path.total; }); };
  seal();
  for (let changed = true; changed && seq.length > 1;) {            // 짧은 조각을 앞(맨 앞이면 뒤) 구간에 흡수 → 같은 동이 이어지면 합친다
    changed = false;
    for (let k = 0; k < seq.length; k++) if (seq[k].to - seq[k].from < minLen && seq.length > 1) {
      if (k > 0) { seq.splice(k, 1); } else { seq[1].from = 0; seq.splice(0, 1); }
      for (let m = seq.length - 1; m > 0; m--) if (seq[m].dong === seq[m - 1].dong) seq.splice(m, 1);
      seal(); changed = true; break;
    }
  }
  seq[0].from = 0; return seq;
}
export const inCityShare = (path, features, step = 100) => { let n = 0, k = 0; for (let d = 0; d <= path.total; d += step) { k++; if (locate(pointAt(path, d), features)) n++; } return n / k; };

export const fmtKm = m => m >= 1000 ? (m / 1000).toFixed(1) + "km" : Math.round(m) + "m";
export const fmtMin = s => s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.round(s % 3600 / 60)}분` : `${Math.max(1, Math.round(s / 60))}분`;
