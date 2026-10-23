// 지형·음영·조명 — Mapterhorn DEM(전 지구 30m · z0–12 · terrarium). 참고: hollobit/grid-siting-lab siting-topography.mjs (Apache-2.0) 를 화성용으로 다시 썼다.
export const TERRAIN_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
export const demSource = () => ({ type: "raster-dem", tiles: [TERRAIN_TILES], tileSize: 512, encoding: "terrarium", minzoom: 0, maxzoom: 12,
  attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>' });

// 지형(setTerrain)과 음영(hillshade)은 같은 URL 이라도 소스 인스턴스를 따로 둔다(MapLibre 제약).
export function addTopography(map) {
  const before = map.getStyle().layers.find(l => l.type === "line" || l.type === "symbol" || l.type === "fill-extrusion")?.id;
  if (!map.getSource("hs-hillshade-dem")) map.addSource("hs-hillshade-dem", demSource());
  if (!map.getLayer("hs-hillshade")) map.addLayer({ id: "hs-hillshade", type: "hillshade", source: "hs-hillshade-dem",
    paint: { "hillshade-exaggeration": .45, "hillshade-illumination-anchor": "map", "hillshade-illumination-direction": 315 } }, before);
  let terrainOn = false, shadeOn = true;
  return {
    get terrainOn() { return terrainOn; },
    toggleTerrain() {
      terrainOn = !terrainOn;
      if (terrainOn && !map.getSource("hs-terrain")) map.addSource("hs-terrain", demSource());
      map.setTerrain(terrainOn ? { source: "hs-terrain", exaggeration: 1 } : null);
      return terrainOn;
    },
    toggleShade() { shadeOn = !shadeOn; map.setLayoutProperty("hs-hillshade", "visibility", shadeOn ? "visible" : "none"); return shadeOn; },
    setTheme(theme) {   // 낮 · 노을 · 밤 — 조명과 음영 색만 바꾼다(스타일은 그대로)
      const night = theme === "night", sunset = theme === "sunset";
      map.setPaintProperty("hs-hillshade", "hillshade-shadow-color", night ? "#030a13" : "#414f50");
      map.setPaintProperty("hs-hillshade", "hillshade-highlight-color", night ? "#426276" : "#fff5d9");
      map.setPaintProperty("hs-hillshade", "hillshade-accent-color", night ? "#183442" : "#877958");
      map.setLight({ anchor: "viewport", color: night ? "#9fb4c8" : sunset ? "#ffd2a6" : "#ffffff", intensity: night ? .35 : .5, position: sunset ? [1.5, 250, 80] : [1.5, 210, 30] });
    }
  };
}
