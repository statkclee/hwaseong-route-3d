// 화성시 3D 경로 이동 — A→B 도로 경로를 MapLibre 3D 위에서 재생한다.
// 지도 스타일·지형·행정동 경계는 ../hwaseong-3d 의 방식을 따른다(OpenFreeMap + Mapterhorn). 기하 계산은 route.mjs(테스트됨).
import { addTopography } from "./topography.mjs";
import { CANDS, MODES, KEYS, OTHER_COLOR, metric, share, heightOf, extent, colorOf, displayCoords, pct, mix, nearby, profile } from "./votes.mjs";
import { buildPath, pointAt, bearingAt, smoothAngle, slice, boxRing, dongsAlong, fmtKm, fmtMin } from "./route.mjs";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const BASE_MPS = 40;                         // 1× = 40 m/s(144km/h 체감) — 32.9km 가 14분. 4×·16× 로 올린다
const SPEEDS = [1, 4, 16];
const $ = id => document.getElementById(id), status = t => { $("status").textContent = t; };
const [DATA, EMD, VOTES] = await Promise.all(["data/routes.json", "data/emd.geojson", "data/votes21.json"].map(u => fetch(u).then(r => r.json())));
$("meta-date").textContent = "경로 " + DATA.built.slice(0, 10);

const ROUTES = DATA.routes.map(r => { const path = buildPath(r.coords); return { ...r, path, dongs: dongsAlong(path, EMD.features) }; });
const S = { ri: 0, d: 0, playing: true, speed: 4, cam: "follow", brg: 0, last: 0, shownPct: -1 };
const hashIdx = () => { const m = /r=(\d)/.exec(location.hash); return m ? Math.min(Math.max(+m[1] - 1, 0), ROUTES.length - 1) : 0; };
S.ri = hashIdx();

const map = new maplibregl.Map({ container: "map", style: STYLE, center: [127.0, 37.2], zoom: 11, pitch: 55, maxPitch: 75, maxZoom: 19, maxBounds: [[126.2, 36.8], [127.5, 37.5]], attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
let topo, pinA, pinB, stopPins = [];
const EMPTY = { type: "FeatureCollection", features: [] };

// 베이스 스타일(OpenFreeMap)이 요구하는 POI 아이콘 중 스프라이트에 없는 것은 빈 이미지로 대신한다(콘솔 경고 제거 — 아이콘 없이 그려지던 그대로)
map.on("styleimagemissing", e => { if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
map.on("load", () => {
  topo = addTopography(map); topo.setTheme("day");
  map.addSource("emd", { type: "geojson", data: EMD });
  map.addLayer({ id: "emd-line", type: "line", source: "emd", paint: { "line-color": "#262624", "line-width": 1, "line-opacity": .35 } });
  map.addLayer({ id: "emd-label", type: "symbol", source: "emd", layout: { "text-field": ["get", "dong"], "text-size": 11, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#262624", "text-halo-color": "#fffff8", "text-halo-width": 1.2, "text-opacity": .8 } });
  // 경로: 흰 외곽선 + 진행 그라디언트(지난 곳 진한 빨강 · 남은 곳 주황). 그라디언트는 lineMetrics 가 필요하다
  map.addSource("route", { type: "geojson", lineMetrics: true, data: EMPTY });
  map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 16], "line-opacity": .95 } });
  map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 10], "line-gradient": ["step", ["line-progress"], "#a63d2f", 1, "#f2a35b"] } });
  // A·B 빔(세워 둔 기둥) + 차량 상자
  map.addSource("ends", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "ends", type: "fill-extrusion", source: "ends", paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": 400, "fill-extrusion-opacity": .8 } });
  map.addSource("car", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "car", type: "fill-extrusion", source: "car", paint: { "fill-extrusion-color": "#1D4ED8", "fill-extrusion-height": 22, "fill-extrusion-opacity": 1 } });
  initVotes(); selectRoute(S.ri); requestAnimationFrame(tick);
});

// ── 경로 선택 ─────────────────────────────────────────────────────────────
ROUTES.forEach((r, i) => { const b = document.createElement("button"); b.dataset.i = i; b.innerHTML = `${i + 1}. ${r.name}<small>${fmtKm(r.distance_m)} · ${r.kind}</small>`; b.onclick = () => selectRoute(i); $("route-btns").appendChild(b); });
const sq = ([x, y], m = 40) => { const a = m / 111320, o = m / (111320 * Math.cos(y * Math.PI / 180)); return [[x - o, y - a], [x + o, y - a], [x + o, y + a], [x - o, y + a], [x - o, y - a]]; };
function selectRoute(i) {
  S.ri = i; S.d = 0; S.brg = bearingAt(ROUTES[i].path, 0); const r = ROUTES[i]; history.replaceState(null, "", "#r=" + (i + 1));
  document.querySelectorAll("#route-btns button").forEach(b => b.classList.toggle("on", +b.dataset.i === i));
  map.getSource("route").setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.coords } });
  const A = [r.a.lon, r.a.lat], B = [r.b.lon, r.b.lat];
  map.getSource("ends").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { color: "#2F7A4F" }, geometry: { type: "Polygon", coordinates: [sq(r.coords[0])] } }, { type: "Feature", properties: { color: "#a63d2f" }, geometry: { type: "Polygon", coordinates: [sq(r.coords.at(-1))] } }] });
  pinA?.remove(); pinB?.remove(); stopPins.forEach(m => m.remove()); stopPins = [];
  // 격전 동선: 접전 투표소(경유지)에 작은 핀 — 선거일 격차(%p, + 이재명 우세)
  (r.stops ?? []).forEach((s, k) => { const e = document.createElement("div"); e.className = "pin stop"; e.innerHTML = `<span>${k + 1}. ${s.id.replace(/제(\d+)투/, " $1투")} ${s.gap > 0 ? "+" : ""}${s.gap.toFixed(1)}%p</span><i></i>`;
    stopPins.push(new maplibregl.Marker({ element: e, anchor: "bottom" }).setLngLat([s.lon, s.lat]).addTo(map)); });
  const pin = (cls, label) => { const e = document.createElement("div"); e.className = "pin " + cls; e.innerHTML = `<span>${label}</span><i></i>`; return e; };
  pinA = new maplibregl.Marker({ element: pin("a", "A " + r.a.name), anchor: "bottom" }).setLngLat(r.coords[0]).addTo(map);
  pinB = new maplibregl.Marker({ element: pin("b", "B " + r.b.name), anchor: "bottom" }).setLngLat(r.coords.at(-1)).addTo(map);
  $("route-note").textContent = `${r.a.name} → ${r.b.name} · ${fmtKm(r.distance_m)} · 주행 ${fmtMin(r.duration_s)} (OSRM 추정, 교통 미반영)`;
  const out = r.dongs.filter(s => s.dong === "관외").reduce((a, s) => a + (s.to - s.from), 0);
  $("dong-note").textContent = out > 0 ? `관외 ${fmtKm(out)} — 시 경계를 벗어난 도로 구간(다른 시 경유)` : "";
  renderDongs(); S.shownPct = -1; $("seek").value = 0; if (V.on) computeProfile();
  if (S.cam === "overview") overview(); else applyCam(true);
  status(`경로 ${i + 1} 준비됨 — ${S.playing ? "재생 중" : "정지"}`);
}
function renderDongs() {
  const ol = $("dong-list"); ol.innerHTML = "";
  ROUTES[S.ri].dongs.forEach((s, k) => { const li = document.createElement("li"); li.dataset.k = k; li.className = s.dong === "관외" ? "out" : ""; li.textContent = `${s.dong === "관외" ? "관외(시 밖)" : s.dong} · ${fmtKm(s.to - s.from)}`; ol.appendChild(li); });
}

// ── 카메라 ────────────────────────────────────────────────────────────────
function overview() { const c = ROUTES[S.ri].coords, b = c.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [180, 90, -180, -90]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 60, bottom: 80, left: 380, right: 290 }, pitch: 50, bearing: -15, duration: 1200 }); }
function applyCam(jump) { if (S.cam === "overview") return overview();
  if (S.cam === "follow") { const p = pointAt(ROUTES[S.ri].path, S.d); const o = { center: p, bearing: S.brg, pitch: 66, zoom: 16 }; jump ? map.jumpTo(o) : map.flyTo({ ...o, duration: 1200 }); } }
document.querySelectorAll("[data-cam]").forEach(b => b.onclick = () => { S.cam = b.dataset.cam; document.querySelectorAll("[data-cam]").forEach(x => x.classList.toggle("on", x === b)); applyCam(false); setTowerScale(); });
$("btn-terrain").onclick = () => { const on = topo.toggleTerrain(); $("btn-terrain").classList.toggle("on", on); $("btn-terrain").textContent = on ? "지형 끄기" : "지형 켜기"; };
document.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => { topo.setTheme(b.dataset.theme); document.querySelectorAll("[data-theme]").forEach(x => x.classList.toggle("on", x === b)); });
// 사용자가 지도를 직접 끌면 추적을 풀고 「자유」로 — 카메라와 싸우지 않는다
for (const ev of ["dragstart", "rotatestart", "pitchstart"]) map.on(ev, e => { if (e.originalEvent && S.cam === "follow") document.querySelector('[data-cam="free"]').click(); });

// ── 재생 ──────────────────────────────────────────────────────────────────
SPEEDS.forEach(v => { const b = document.createElement("button"); b.textContent = v + "×"; b.dataset.v = v; b.onclick = () => { S.speed = v; mark(); }; $("speed-btns").appendChild(b); });
const mark = () => document.querySelectorAll("#speed-btns button").forEach(b => b.classList.toggle("on", +b.dataset.v === S.speed)); mark();
const setPlay = on => { S.playing = on; $("btn-play").textContent = on ? "⏸ 일시정지" : "▶ 재생"; $("btn-play").classList.toggle("on", on); };
$("btn-play").onclick = () => { if (!S.playing && S.d >= ROUTES[S.ri].path.total) S.d = 0; setPlay(!S.playing); };
$("btn-restart").onclick = () => { S.d = 0; S.brg = bearingAt(ROUTES[S.ri].path, 0); setPlay(true); };
$("seek").oninput = e => { S.d = +e.target.value / 1000 * ROUTES[S.ri].path.total; S.brg = bearingAt(ROUTES[S.ri].path, S.d); setPlay(false); };
addEventListener("keydown", e => { if (e.code === "Space") { e.preventDefault(); $("btn-play").click(); } if (e.key >= "1" && e.key <= String(ROUTES.length)) selectRoute(+e.key - 1); });
addEventListener("hashchange", () => { const i = hashIdx(); if (i !== S.ri) selectRoute(i); });
setPlay(true);

function tick(t) {
  const dt = Math.min((t - (S.last || t)) / 1000, .1); S.last = t; const r = ROUTES[S.ri], P = r.path;
  if (S.playing) { S.d = Math.min(S.d + dt * BASE_MPS * S.speed, P.total); if (S.d >= P.total) { setPlay(false); status(`도착 — ${r.b.name} (${fmtKm(P.total)})`); } }
  S.brg = smoothAngle(S.brg, bearingAt(P, S.d, 150), 1 - Math.exp(-dt / .6));
  const pos = pointAt(P, S.d);
  map.getSource("car").setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [boxRing(pos, S.brg)] } });
  if (S.cam === "follow") map.jumpTo({ center: pos, bearing: S.brg });
  const pct = Math.round(S.d / P.total * 1000);      // 진행률 0.1% 단위로만 UI 갱신(그라디언트 재계산 비용)
  if (pct !== S.shownPct) { S.shownPct = pct; const p = Math.min(Math.max(pct / 1000, 1e-6), .999999);
    map.setPaintProperty("route-line", "line-gradient", routeGradient(p)); updateUI(r, P); updateHud(pos); }
  if (V.on) map.getSource("radius").setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ringOf(pos, V.rad)] } });
  requestAnimationFrame(tick);
}
function updateUI(r, P) {
  const rem = P.total - S.d, remSec = r.duration_s * rem / P.total;
  $("readout").innerHTML = `${fmtKm(S.d)} / ${fmtKm(P.total)} (${(S.d / P.total * 100).toFixed(0)}%)<br>남은 ${fmtKm(rem)} · 도착까지 약 ${fmtMin(remSec)}`;
  if (document.activeElement !== $("seek")) $("seek").value = S.d / P.total * 1000;
  r.dongs.forEach((s, k) => { const li = $("dong-list").children[k]; if (li) li.classList.toggle("here", S.d >= s.from && (S.d <= s.to || k === r.dongs.length - 1) && !(k < r.dongs.length - 1 && S.d >= r.dongs[k + 1].from)); li?.classList.toggle("past", S.d > s.to); });
}
// ── 투표소 득표 레이어(제21대 대선) — 숫자의 뜻은 votes.mjs·SPEC §1-2 ───────────────────────
const PTS = VOTES.points, XY = displayCoords(PTS), V = { on: false, mode: "구성", extent: [0, 1], pin: null, rad: 2000, prof: null, tower: 1 };
const fmtN = n => n.toLocaleString();
function voteFeatures() {
  V.extent = V.mode === "구성" ? [0, 1] : extent(PTS, V.mode); const fs = [];
  PTS.forEach((p, i) => { const H = heightOf(p), ring = [sq(XY[i], 20)], mk = (base, h, color) => fs.push({ type: "Feature", properties: { i, base, h, color }, geometry: { type: "Polygon", coordinates: ring } });
    if (V.mode === "구성") { let base = 0; KEYS.forEach((k, j) => { const hh = H * p.eday[k] / p.eday.valid; if (hh > 0) { mk(base, base + hh, j < 4 ? CANDS[j].color : OTHER_COLOR); base += hh; } }); }   // 후보별 색으로 쌓는다 — 높이 = 등록 선거인, 구간 = 득표 비율
    else mk(0, H, colorOf(metric(p.eday, V.mode), V.mode, V.extent)); });
  return { type: "FeatureCollection", features: fs };
}
// 차량 반경 고리(지면 원) — 반경 안 투표소를 합산한다는 뜻을 눈에 보이게
const ringOf = ([x, y], m) => Array.from({ length: 65 }, (_, k) => { const a = k / 64 * 2 * Math.PI; return [x + m * Math.cos(a) / (111320 * Math.cos(y * Math.PI / 180)), y + m * Math.sin(a) / 111320]; });
// 경로선 색 = 인근 성향(파랑 이재명 우세 ↔ 빨강 김문수 우세, 회색 = 인근 투표소 없음). 지난 곳은 진하게, 남은 곳은 연하게
const leanColor = s => s.far ? "#B8B7AF" : mix("#9a9a92", s.lean >= 0 ? CANDS[0].color : CANDS[1].color, .25 + .75 * Math.min(Math.abs(s.lean) / 25, 1));
function routeGradient(p) {
  if (!V.on || !V.prof) return ["step", ["line-progress"], "#a63d2f", p, "#f2a35b"];
  const st = []; let last = -1; for (const s of V.prof) { const f = Math.min(Math.max(s.f, 0), 1); if (f <= last) continue; last = f; const c = leanColor(s); st.push(f, f <= p ? c : mix(c, "#ffffff", .55)); }
  return ["interpolate", ["linear"], ["line-progress"], ...st];
}
const computeProfile = () => { V.prof = profile(ROUTES[S.ri].path, PTS, V.rad); };
function updateHud(pos) {
  if (!V.on) return; const r = nearby(PTS, pos, V.rad), a = r.agg, bar = $("hud-bar");
  if (r.far) { bar.innerHTML = ""; $("hud-text").innerHTML = `<b>인근 투표소 없음</b> — 가장 가까운 투표소 ${(r.nearestM / 1000).toFixed(1)}km (관외·산지 구간, 성향을 말하지 않는다)`; }
  else {
    bar.innerHTML = KEYS.map((k, j) => { const s = share(a, k); return s > 0 ? `<span style="width:${s}%;background:${j < 4 ? CANDS[j].color : OTHER_COLOR}">${s >= 7 ? s.toFixed(0) + "%" : ""}</span>` : ""; }).join("");
    const g = metric(a, "격차"), lead = g >= 0 ? "이재명" : "김문수", close = Math.abs(g) < 3;
    $("hud-text").innerHTML = `<b style="color:${CANDS[g >= 0 ? 0 : 1].color}">${close ? "접전 · " : ""}${lead} +${Math.abs(g).toFixed(1)}%p</b> — 이재명 ${pct(share(a, "이재명"))} · 김문수 ${pct(share(a, "김문수"))} · 이준석 ${pct(share(a, "이준석"))} · 권영국 ${pct(share(a, "권영국"))}<br><span class="k">${r.fallback ? `반경 안 투표소 없음 → 가장 가까운 1곳(${(r.nearestM / 1000).toFixed(1)}km)` : `투표소 ${r.n}곳`} · 선거일 유효표 ${fmtN(a.valid)} · 등록 선거인 ${fmtN(a.elect)}</span>`;
  }
  drawProfile();
}
function drawProfile() {
  const cv = $("hud-prof"), g = cv.getContext("2d"), w = cv.width, h = cv.height, pr = V.prof; g.clearRect(0, 0, w, h); if (!pr) return;
  pr.forEach((s, i) => { const x0 = i === 0 ? 0 : (pr[i - 1].f + s.f) / 2 * w, x1 = i === pr.length - 1 ? w : (s.f + pr[i + 1].f) / 2 * w; let y = h;
    if (s.far) { g.fillStyle = "#ddd"; g.fillRect(x0, 0, x1 - x0 + 1, h); return; }
    s.shares.forEach((v, j) => { const hh = v / 100 * h; g.fillStyle = j < 4 ? CANDS[j].color : OTHER_COLOR; g.fillRect(x0, y - hh, x1 - x0 + 1, hh); y -= hh; }); });
  const x = S.d / ROUTES[S.ri].path.total * w; g.fillStyle = "#262624"; g.fillRect(x - 1.5, 0, 3, h); g.strokeStyle = "#fff"; g.lineWidth = 1; g.strokeRect(x - 2.5, .5, 5, h - 1);
}
// 추적 카메라에서는 기둥이 차량 시야를 가리므로 낮춘다
function setTowerScale() { if (!map.getLayer("votes")) return; const k = S.cam === "follow" ? .4 : 1; map.setPaintProperty("votes", "fill-extrusion-height", ["*", k, ["get", "h"]]); map.setPaintProperty("votes", "fill-extrusion-base", ["*", k, ["get", "base"]]); }
function initVotes() {
  map.addSource("votes", { type: "geojson", data: voteFeatures() });
  map.addLayer({ id: "votes", type: "fill-extrusion", source: "votes", layout: { visibility: "none" }, paint: { "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-color": ["get", "color"], "fill-extrusion-opacity": .92 } });
  map.addSource("radius", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "radius-fill", type: "fill", source: "radius", layout: { visibility: "none" }, paint: { "fill-color": "#262624", "fill-opacity": .07 } });
  map.addLayer({ id: "radius-line", type: "line", source: "radius", layout: { visibility: "none" }, paint: { "line-color": "#262624", "line-width": 1.5, "line-dasharray": [3, 2] } });
  [1000, 2000, 3000].forEach(m => { const b = document.createElement("button"); b.dataset.r = m; b.textContent = m / 1000 + "km"; b.onclick = () => { V.rad = m; computeProfile(); S.shownPct = -1; mark2(); }; $("rad-btns").appendChild(b); });
  setTowerScale();
  MODES.forEach(m => { const b = document.createElement("button"); b.dataset.m = m; b.textContent = m === "격차" ? "격차(이재명−김문수)" : m === "구성" ? "후보별 구성" : m; b.onclick = () => { V.mode = m; refreshVotes(); }; $("vote-modes").appendChild(b); });
  $("btn-votes").onclick = () => { V.on = !V.on; map.setLayoutProperty("votes", "visibility", V.on ? "visible" : "none"); $("btn-votes").classList.toggle("on", V.on); $("btn-votes").textContent = V.on ? "끄기" : "켜기";
    ["vote-modes", "vote-legend", "vote-note", "vote-hud"].forEach(id => $(id).hidden = !V.on); ["radius-fill", "radius-line"].forEach(id => map.setLayoutProperty(id, "visibility", V.on ? "visible" : "none"));
    S.shownPct = -1; if (!V.on) { $("tip").style.display = "none"; V.pin = null; } else { computeProfile(); refreshVotes(); mark2(); } };
  map.on("mousemove", "votes", e => { if (V.pin == null) showTip(e.features[0].properties.i, e.point); map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "votes", () => { if (V.pin == null) $("tip").style.display = "none"; map.getCanvas().style.cursor = ""; });
  map.on("click", e => { const f = V.on && map.queryRenderedFeatures(e.point, { layers: ["votes"] })[0]; if (f) { V.pin = V.pin === f.properties.i ? null : f.properties.i; if (V.pin != null) showTip(V.pin, e.point); } else { V.pin = null; $("tip").style.display = "none"; } });
}
const mark2 = () => document.querySelectorAll("#rad-btns button").forEach(b => b.classList.toggle("on", +b.dataset.r === V.rad));
function refreshVotes() {
  map.getSource("votes").setData(voteFeatures());
  document.querySelectorAll("#vote-modes button").forEach(b => b.classList.toggle("on", b.dataset.m === V.mode));
  const comp = V.mode === "구성"; $("vote-legend").hidden = comp || !V.on; $("vote-chips").hidden = !comp || !V.on;
  $("vote-chips").innerHTML = [...CANDS.map(c => `<i style="background:${c.color}"></i>${c.k}`), `<i style="background:${OTHER_COLOR}"></i>기타`].join("") + '<span class="k"> · 기둥 높이 = 등록 선거인 · 구간 = 득표율</span>';
  if (comp) return;
  const [mn, mx] = V.extent, a = colorOf(mn, V.mode, V.extent), z = colorOf(mx, V.mode, V.extent), mid = colorOf(0, V.mode, V.extent);
  $("vote-bar").style.background = V.mode === "격차" ? `linear-gradient(90deg,${a},${mid},${z})` : `linear-gradient(90deg,${a},${z})`;
  const g = V.mode === "격차"; $("vl-min").textContent = g ? `김문수 우세 ${(-mn).toFixed(1)}%p` : pct(mn); $("vl-max").textContent = g ? `이재명 우세 +${mx.toFixed(1)}%p` : pct(mx);
}
function showTip(i, pt) {
  const p = PTS[i], rows = (u, k) => CANDS.map(c => `<tr><td>${c.k} <span class="m">${c.party}</span></td><td>${fmtN(u[c.k])}</td><td>${pct(share(u, c.k))}</td></tr>`).join("");
  const tip = $("tip"); tip.innerHTML = `<b>${p.id}</b> <span class="m">투표소(투표구 대표점)</span><br><span class="m">${p.building} · ${p.addr}</span>
    <div style="margin-top:4px"><b>선거일 투표분</b> <span class="m">(유효 ${fmtN(p.eday.valid)} 기준)</span></div>
    <table>${rows(p.eday)}<tr><td class="m">기타(송진호)</td><td class="m">${fmtN(p.eday.기타)}</td><td class="m">${pct(share(p.eday, "기타"))}</td></tr></table>
    등록 국내 선거인 <b>${fmtN(p.elect)}</b>명 <span class="m">(사전투표자 포함)</span>
    <div style="margin-top:4px"><b>${p.dong} 소계</b> <span class="m">(선거일+관내사전 · 유효 ${fmtN(p.dong_sub.valid)})</span></div>
    <table>${rows(p.dong_sub)}</table>${V.pin === i ? '<span class="m">클릭하면 고정 해제</span>' : '<span class="m">클릭하면 고정</span>'}`;
  tip.style.display = "block"; tip.style.left = Math.min(pt.x + 14, innerWidth - 360) + "px"; tip.style.top = Math.min(pt.y + 14, innerHeight - tip.offsetHeight - 10) + "px";
}

// 테스트·디버그용 읽기 창구
window.__rv = { S, ROUTES, selectRoute, map, V, PTS, XY, refreshVotes };
