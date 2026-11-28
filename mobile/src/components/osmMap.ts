/** Raster tiles only. No Google Maps SDK and no Geoapify key. */
export const OSM_TILE_HOST = "tile.openstreetmap.org";

type OsmPoint = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  number?: number;
  kind: "field" | "star" | "stay" | "eat" | "do";
};

const KIND_COLOR = {
  field: "#14284B",
  star: "#F2B705",
  stay: "#1F9D63",
  eat: "#D64545",
  do: "#C98A0B",
} as const;

export function allowMapRequest(url: string): boolean {
  if (url.startsWith("about:") || url.startsWith("data:")) return true;
  try {
    return new URL(url).host === OSM_TILE_HOST;
  } catch {
    return false;
  }
}

export const OSM_MAP_SCRIPT = `
function lngToX(lng, z) {
  return ((lng + 180) / 360) * Math.pow(2, z);
}
function latToY(lat, z) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = clamped * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z);
}
function yToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function chooseZoom(points, width, height) {
  if (!points.length) return 12;
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min.apply(null, lats);
  const maxLat = Math.max.apply(null, lats);
  const minLng = Math.min.apply(null, lngs);
  const maxLng = Math.max.apply(null, lngs);
  for (let zoom = 15; zoom >= 3; zoom -= 1) {
    const xSpan = (lngToX(maxLng, zoom) - lngToX(minLng, zoom)) * 256;
    const ySpan = (latToY(minLat, zoom) - latToY(maxLat, zoom)) * 256;
    if (xSpan <= width * 0.72 && ySpan <= height * 0.72) return zoom;
  }
  return 3;
}
`;

export function osmMapHtml(points: OsmPoint[], focusId: string | null): string {
  const payload = JSON.stringify({
    points: points.map((point) => ({
      id: point.id,
      latitude: point.latitude,
      longitude: point.longitude,
      label: point.label,
      number: point.number ?? null,
      kind: point.kind,
      color: KIND_COLOR[point.kind],
    })),
    focusId,
  }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; height: 100%; background: #d7e3d0; font-family: sans-serif; }
  #map { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; }
  img.tile { position: absolute; width: 256px; height: 256px; }
  button.pin {
    position: absolute; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 14px;
    border: 0; color: #fff; font-weight: 800; transform: translate(-50%, -50%);
  }
  button.pin.star, button.pin.on { color: #14284B; }
  button.zoom {
    position: absolute; right: 8px; width: 44px; height: 44px; border-radius: 8px;
    border: 1px solid #E4E0D4; background: #fff; color: #14284B; font-size: 22px; font-weight: 800;
  }
  #zin { top: 8px; }
  #zout { top: 58px; }
  #credit {
    position: absolute; left: 6px; bottom: 6px; margin: 0; padding: 2px 6px;
    background: rgba(255,255,255,0.88); color: #51565F; font-size: 11px; border-radius: 4px;
  }
</style>
</head>
<body>
<div id="map"></div>
<button id="zin" class="zoom" type="button" aria-label="Zoom in">+</button>
<button id="zout" class="zoom" type="button" aria-label="Zoom out">−</button>
<p id="credit">© OpenStreetMap</p>
<script>
${OSM_MAP_SCRIPT}
const payload = ${payload};
const map = document.getElementById("map");
const state = {
  zoom: 12,
  lat: payload.points.length ? payload.points.reduce((sum, point) => sum + point.latitude, 0) / payload.points.length : 0,
  lng: payload.points.length ? payload.points.reduce((sum, point) => sum + point.longitude, 0) / payload.points.length : 0,
  focusId: payload.focusId,
};
function render() {
  const width = map.clientWidth || window.innerWidth;
  const height = map.clientHeight || window.innerHeight;
  const zoom = state.zoom;
  const centerX = lngToX(state.lng, zoom) * 256;
  const centerY = latToY(state.lat, zoom) * 256;
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  const x0 = Math.floor(left / 256);
  const y0 = Math.floor(top / 256);
  const x1 = Math.floor((left + width) / 256);
  const y1 = Math.floor((top + height) / 256);
  const n = Math.pow(2, zoom);
  while (map.firstChild) map.removeChild(map.firstChild);
  for (let x = x0; x <= x1; x += 1) {
    if (x < 0 || x >= n) continue;
    for (let y = y0; y <= y1; y += 1) {
      if (y < 0 || y >= n) continue;
      const tile = document.createElement("img");
      tile.className = "tile";
      tile.alt = "";
      tile.src = "https://${OSM_TILE_HOST}/" + zoom + "/" + x + "/" + y + ".png";
      tile.style.left = (x * 256 - left) + "px";
      tile.style.top = (y * 256 - top) + "px";
      map.appendChild(tile);
    }
  }
  payload.points.forEach((point) => {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin" + (point.kind === "star" ? " star" : "") + (point.id === state.focusId ? " on" : "");
    pin.textContent = point.kind === "star" ? "★" : (point.number == null ? "" : String(point.number));
    pin.setAttribute("aria-label", point.label);
    pin.style.left = (lngToX(point.longitude, zoom) * 256 - left) + "px";
    pin.style.top = (latToY(point.latitude, zoom) * 256 - top) + "px";
    pin.style.background = point.id === state.focusId ? "#F2B705" : point.color;
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ id: point.id }));
    });
    map.appendChild(pin);
  });
}
window.setFocus = function (id) {
  state.focusId = id;
  render();
};
let drag = null;
map.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, lat: state.lat, lng: state.lng };
});
map.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) < 4) return;
  const zoom = state.zoom;
  const scale = 360 / (256 * Math.pow(2, zoom));
  state.lng = drag.lng - dx * scale;
  const movedY = latToY(drag.lat, zoom) - dy / 256;
  state.lat = yToLat(movedY, zoom);
  render();
});
function endDrag() { drag = null; }
map.addEventListener("pointerup", endDrag);
map.addEventListener("pointercancel", endDrag);
document.getElementById("zin").addEventListener("click", () => {
  state.zoom = Math.min(16, state.zoom + 1);
  render();
});
document.getElementById("zout").addEventListener("click", () => {
  state.zoom = Math.max(3, state.zoom - 1);
  render();
});
function boot() {
  state.zoom = chooseZoom(payload.points, map.clientWidth || window.innerWidth, map.clientHeight || window.innerHeight);
  render();
}
boot();
</script>
</body>
</html>`;
}

export function mapSelection(message: string): string | null {
  try {
    const body = JSON.parse(message) as { id?: unknown };
    return typeof body.id === "string" && body.id.trim() ? body.id : null;
  } catch {
    return null;
  }
}
