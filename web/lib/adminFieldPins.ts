import { ADMIN_SHELL_STYLE, adminShell } from "@/lib/adminLayout";

export type FieldPinItem = {
  venue_key: string;
  venue_name: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  pin_rule: string | null;
  source: string;
  maps_url: string;
};

export type FieldPinBoard = {
  q: string;
  failed_count: number;
  untagged_count: number;
  saved_count: number;
  failed: FieldPinItem[];
  untagged: FieldPinItem[];
  saved: FieldPinItem[];
  showing: number;
};

const EXTRA_STYLE = `
form.filters, form.lookup { display: grid; gap: 12px; margin: 16px 0 28px; }
form.filters { grid-template-columns: minmax(220px, 360px) auto; align-items: end; }
label.field { display: block; font-weight: 700; margin: 0; }
input[type="search"], input[type="text"], input[type="number"] { width: 100%; border-radius: 12px; border: 1px solid #E4E0D4; padding: 10px 12px; margin-top: 6px; font: inherit; color: #14284B; background: #fff; min-height: 44px; }
.row { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; padding: 12px 0; border-bottom: 1px solid #E4E0D4; }
.row h3 { margin: 0; font-size: 16px; }
.meta { color: #51565F; font-size: 13px; margin: 4px 0 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-top: 8px; }
.actions form, .manual { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.manual label { font-size: 13px; font-weight: 700; flex: 1 1 320px; }
.manual input { width: 100%; min-width: 280px; font-variant-numeric: tabular-nums; }
code.cmd { display: block; margin-top: 8px; padding: 10px 12px; background: #fff; border: 1px solid #E4E0D4; border-radius: 12px; overflow-wrap: anywhere; }
button, a.button { font: inherit; font-weight: 700; border-radius: 12px; min-height: 44px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; padding: 0 16px; }
button.primary, a.primary { background: #F2B705; color: #14284B; border: 0; }
button.ghost, a.ghost { background: #fff; color: #14284B; border: 1px solid #E4E0D4; }
#drop-map { height: 280px; border-radius: 16px; border: 1px solid #E4E0D4; margin: 8px 0 20px; background: #fff; }
.note { color: #51565F; }
h2 { margin: 28px 0 8px; font-size: 20px; }
input[type="checkbox"] { width: 22px; height: 22px; margin-top: 2px; accent-color: #14284B; }
@media (max-width: 640px) {
  form.filters { grid-template-columns: 1fr; }
}
`.trim();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isItem(value: unknown): value is FieldPinItem {
  if (!value || typeof value !== "object") return false;
  const row = value as FieldPinItem;
  return typeof row.venue_key === "string" && typeof row.venue_name === "string" && typeof row.city === "string" && typeof row.state === "string" && typeof row.maps_url === "string";
}

export function readFieldPinBoard(payload: unknown): FieldPinBoard | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as FieldPinBoard;
  if (!Array.isArray(body.failed) || !Array.isArray(body.untagged) || !Array.isArray(body.saved)) return null;
  if (typeof body.failed_count !== "number" || typeof body.untagged_count !== "number" || typeof body.saved_count !== "number") return null;
  return {
    q: typeof body.q === "string" ? body.q : "",
    failed_count: body.failed_count,
    untagged_count: body.untagged_count,
    saved_count: body.saved_count,
    failed: body.failed.filter(isItem),
    untagged: body.untagged.filter(isItem),
    saved: body.saved.filter(isItem),
    showing: typeof body.showing === "number" ? body.showing : 40,
  };
}

function place(item: FieldPinItem): string {
  return [item.city, item.state].filter(Boolean).join(", ");
}

function selectable(item: FieldPinItem, query: string): string {
  const where = place(item);
  return `<div class="row">
<input form="lookup" type="checkbox" name="venue_key" value="${escapeHtml(item.venue_key)}">
<span>
<h3>${escapeHtml(item.venue_name)}</h3>
<p class="meta">${escapeHtml(where)}</p>
${manualForm(item, query)}
</span>
</div>`;
}

function pointText(item: FieldPinItem): string {
  if (item.latitude == null || item.longitude == null) return "";
  return `${item.latitude}, ${item.longitude}`;
}

function manualForm(item: FieldPinItem, query: string): string {
  return `<form class="manual" method="post" action="/admin/field-pins" novalidate>
<input type="hidden" name="action" value="manual">
<input type="hidden" name="q" value="${escapeHtml(query)}">
<input type="hidden" name="venue_key" value="${escapeHtml(item.venue_key)}">
<input type="hidden" name="venue_name" value="${escapeHtml(item.venue_name)}">
<input type="hidden" name="city" value="${escapeHtml(item.city)}">
<input type="hidden" name="state" value="${escapeHtml(item.state)}">
<label>Coordinates<input class="pin-point" type="text" name="point" autocomplete="off" spellcheck="false" placeholder="30.09074022710416, -81.56896571349351" value="${escapeHtml(pointText(item))}"></label>
<button class="primary" type="submit">Save manual pin</button>
</form>`;
}

function savedRow(item: FieldPinItem, query: string): string {
  const where = place(item);
  const coords = item.latitude != null && item.longitude != null ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : "";
  const source = item.source ? ` · ${item.source}` : "";
  return `<div class="row">
<span></span>
<span>
<h3>${escapeHtml(item.venue_name)}</h3>
<p class="meta">${escapeHtml(where)} · ${escapeHtml(coords)}${escapeHtml(source)}</p>
<div class="actions">
<a class="ghost" href="${escapeHtml(item.maps_url)}" target="_blank" rel="noopener noreferrer">Open this point</a>
<form method="post" action="/admin/field-pins">
<input type="hidden" name="action" value="clear">
<input type="hidden" name="q" value="${escapeHtml(query)}">
<input type="hidden" name="venue_key" value="${escapeHtml(item.venue_key)}">
<button class="ghost" type="submit">Clear</button>
</form>
</div>
${manualForm(item, query)}
</span>
</div>`;
}

function listSection(title: string, count: number, shown: number, body: string): string {
  const more = count > shown ? ` Showing ${shown} of ${count}. Search to narrow this list.` : ` ${count}.`;
  return `<section>
<h2>${escapeHtml(title)}</h2>
<p class="note">${escapeHtml(more.trim())}</p>
${body || `<p class="empty">None.</p>`}
</section>`;
}

function notice(kind: string | null, saved: string | null, failed: string | null, skipped: string | null): string {
  if (kind === "lookup" && saved != null && failed != null && skipped != null) {
    return `<p class="note">Looked up the selected fields. Saved ${escapeHtml(saved)}, failed ${escapeHtml(failed)}, left ${escapeHtml(skipped)}. A saved pin is not verified.</p>`;
  }
  if (kind === "manual") return `<p class="note">Manual pin saved. A later lookup will not replace it. This is not a verification.</p>`;
  if (kind === "retry" && saved != null && failed != null && skipped != null) {
    return `<p class="note">Retried fields with no saved coordinates. saved=${escapeHtml(saved)} skipped=${escapeHtml(skipped)} failed=${escapeHtml(failed)}. A manual pin was not changed. A saved pin is not verified.</p>`;
  }
  if (kind === "coords") return `<p class="error">Paste latitude, longitude. For example 30.09074022710416, -81.56896571349351.</p>`;
  if (kind === "clear") return `<p class="note">Pin cleared. The field is in Failed.</p>`;
  if (kind === "too-many") return `<p class="error">Select at most 25 fields. The shell script looks up the rest.</p>`;
  if (kind === "empty") return `<p class="error">Select at least one field.</p>`;
  if (kind === "error") return `<p class="error">That action did not finish.</p>`;
  return "";
}

export function fieldPinsPage(board: FieldPinBoard, banner: string | null): string {
  const query = board.q;
  const failed = board.failed.map((item) => selectable(item, query)).join("");
  const untagged = board.untagged.map((item) => selectable(item, query)).join("");
  const saved = board.saved.map((item) => savedRow(item, query)).join("");
  const body = adminShell(
    "field-pins",
    `<div class="bar">
<h1>Field pins</h1>
<form method="post" action="/api/auth/logout"><button class="ghost" type="submit">Sign out</button></form>
</div>
<p class="lede">Failed, untagged, and saved fields. Lookup runs for the fields you select, or for failed rows in batches. It does not look up every complex. A saved pin is not verified. A manual pin is kept and is not replaced by a later lookup.</p>
${banner ?? ""}
<form id="retry" method="post" action="/admin/field-pins">
<input type="hidden" name="action" value="retry">
<input type="hidden" name="q" value="${escapeHtml(query)}">
<button class="primary" type="submit">Retry failed</button>
</form>
<p id="retry-status" class="note">Retry failed looks up fields with no saved coordinates, including a previous failed attempt. A manual pin is left as entered. From the api directory on the API shell:</p>
<code class="cmd">python scripts/check_field_pins_against_maps.py --retry-failed</code>
<form class="filters" method="get" action="/admin/field-pins">
<label class="field">Name, city, or state
<input type="search" name="q" value="${escapeHtml(query)}" placeholder="Middleburg">
</label>
<button class="primary" type="submit">Search</button>
</form>
<p class="note">Click the map to fill the coordinate box of the manual form you last used. Or paste latitude, longitude.</p>
<div id="drop-map"></div>
<form id="lookup" class="lookup" method="post" action="/admin/field-pins">
<input type="hidden" name="action" value="lookup">
<input type="hidden" name="q" value="${escapeHtml(query)}">
</form>
${listSection("Failed", board.failed_count, board.failed.length, failed)}
${listSection("Untagged", board.untagged_count, board.untagged.length, untagged)}
<button class="primary" type="submit" form="lookup">Look up selected</button>
${listSection("Saved", board.saved_count, board.saved.length, saved)}
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script id="leaflet-js" src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" async></script>
<script>
(function () {
  var target = null;
  document.querySelectorAll("form.manual").forEach(function (form) {
    form.addEventListener("focusin", function () { target = form; });
  });
  function startMap() {
    var node = document.getElementById("drop-map");
    if (!node || !window.L || node.dataset.ready) return;
    node.dataset.ready = "1";
    var map = L.map(node).setView([39.8, -98.6], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    var marker = null;
    map.on("click", function (event) {
      if (!target) return;
      var point = target.querySelector(".pin-point");
      if (!point) return;
      point.value = event.latlng.lat + ", " + event.latlng.lng;
      if (marker) marker.remove();
      marker = L.marker(event.latlng).addTo(map);
    });
  }
  if (window.L) startMap();
  var leaflet = document.getElementById("leaflet-js");
  if (leaflet) leaflet.addEventListener("load", startMap);
})();
(function () {
  var form = document.getElementById("retry");
  if (!form || !window.fetch) return;
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var status = document.getElementById("retry-status");
    var saved = 0;
    var failed = 0;
    var skipped = 0;
    var done = [];
    var rounds = 0;
    function step() {
      if (rounds > 40) {
        if (status) status.textContent = "saved=" + saved + " skipped=" + skipped + " failed=" + failed;
        return;
      }
      rounds += 1;
      if (status) status.textContent = "Looking up a batch of fields with no saved coordinates...";
      var body = new FormData();
      body.set("action", "retry");
      body.set("format", "json");
      body.set("q", form.querySelector("[name=q]") ? form.querySelector("[name=q]").value : "");
      done.forEach(function (key) { body.append("done", key); });
      fetch("/admin/field-pins", { method: "POST", body: body, credentials: "same-origin" }).then(function (response) {
        if (!response.ok) throw new Error("batch");
        return response.json();
      }).then(function (data) {
        saved += Number(data.saved) || 0;
        failed += Number(data.failed) || 0;
        skipped = Number(data.skipped) || 0;
        var tried = Array.isArray(data.tried) ? data.tried : [];
        if (!tried.length || !data.remaining) {
          window.location = "/admin/field-pins?notice=retry&saved=" + saved + "&failed=" + failed + "&skipped=" + skipped;
          return;
        }
        tried.forEach(function (key) { done.push(key); });
        if (status) status.textContent = "saved=" + saved + " skipped=" + skipped + " failed=" + failed;
        step();
      }).catch(function () {
        if (status) status.textContent = "That batch did not finish. saved=" + saved + " skipped=" + skipped + " failed=" + failed;
      });
    }
    step();
  });
})();
</script>`,
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Field pins</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #FAF8F3; color: #14284B; font: 16px/1.45 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.lede, .note, .empty { color: #51565F; }
.error { color: #8C2F2F; font-weight: 700; }
${ADMIN_SHELL_STYLE}
${EXTRA_STYLE}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

export function fieldPinsNotice(params: URLSearchParams): string | null {
  return notice(params.get("notice"), params.get("saved"), params.get("failed"), params.get("skipped"));
}
