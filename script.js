// script.js

function toNum(x) {
  const s = (x ?? "").toString().trim();
  if (s === "") return 0;
  const v = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}

let routeData = [];
let routeInfo = [];
let CountyCentroids = [];
let leafletMap, markersLayer;
let currentDirection = 0; // 0 = forward, 1 = reverse
let touchMode = 0;        // 1 = on, 0 = off
let lumpMode = 0;         // 1 = on, 0 = off
let kmlLayer = null;        // yellow line
let kmlCasingLayer = null;  // black outline
let routePolyLayer = null;
let currentVitalKeys = new Set(); // "County|ST"

const routePolyCache = new Map();

function kmlWeights(z) {
  // tune these to taste
  const line = Math.max(2, Math.round((z - 5) * 0.9));   // main yellow
  const casing = Math.max(line + 3, 5);                   // black halo
  return { line, casing };
}

function polygonStyleForZoom(z) {
  return {
    color: "#4b5563",           // county border
    weight: z >= 9 ? 1.2 : z >= 7 ? 0.9 : 0.6,
    fillColor: "#3d8bfd",
    fillOpacity: z >= 8 ? 0.25 : 0.18,   // a bit lighter when zoomed out
  };
}

function initMap() {
  leafletMap = L.map("mapPanel", { zoomControl: true });

  leafletMap.createPane("counties"); // polygons
  
  leafletMap.getPane("counties").style.zIndex = 410;

  leafletMap.createPane("routes");   // KML line + casing
  leafletMap.getPane("routes").style.zIndex = 650;

  leafletMap.on("zoomend", applyZoomStyles);   // react to zoom

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(leafletMap);
  markersLayer = L.layerGroup().addTo(leafletMap);
  leafletMap.setView([39.5, -98.35], 4);
  setTimeout(() => leafletMap.invalidateSize(), 0);
}

function clearKmlLayer() {
  if (kmlLayer)       { leafletMap.removeLayer(kmlLayer);       kmlLayer = null; }
  if (kmlCasingLayer) { leafletMap.removeLayer(kmlCasingLayer); kmlCasingLayer = null; }
}

async function plotRosterPolygons(route, roster) {
  if (!leafletMap) return;

  // remove prior polygons
  if (routePolyLayer) {
    leafletMap.removeLayer(routePolyLayer);
    routePolyLayer = null;
  }

  // fetch per‑route GeoJSON from your repo
  const url = `https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/kml/polygons/${route}.geojson`;

  console.log( "Fetching polygons:", url);

  try {
    const res = await fetch(url, { mode: "cors" });
    console.log("HTTP status:", res.status);  // <— log 2
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gj = await res.json();
    console.log("Feature count:", gj?.features?.length || 0);  // <— log 3


    //const gj = routePolyCache.has(route)
    //  ? routePolyCache.get(route)
    //  : await (await fetch(url, { mode: "cors" })).json();

    routePolyCache.set(route, gj);

    routePolyLayer = L.geoJSON(gj, {
      pane: "counties",
      style: f => {
        const name = f.properties?.NAME ?? "";
        const st   = f.properties?.STUSPS ?? "";
        const isVital = currentVitalKeys.has(`${name}|${st}`);
        return {
          color: isVital ? "#7f1d1d" : "#4b5563",    // border
          weight: leafletMap.getZoom() >= 9 ? 1.2 : 0.8,
          fillColor: isVital ? "#ef4444" : "#3d8bfd",// fill
          fillOpacity: leafletMap.getZoom() >= 8 ? 0.28 : 0.20
        };
      },
  onEachFeature: (f, layer) => {
    const name = f.properties?.NAME ?? "";
    const st   = f.properties?.STUSPS ?? "";
    const r    = roster?.find(x => `${x.County}|${x.State}` === `${name}|${st}`);
    const miles = r ? Number(r.Miles).toFixed(1) : "";
    layer.bindTooltip(
      `${name}, ${st}${miles ? ` — ${miles} mi` : ""}`,
      { sticky: true }
    );
}

}).addTo(leafletMap);


    const b = routePolyLayer.getBounds();
    if (b.isValid()) leafletMap.fitBounds(b.pad(0.2));

    // keep your KML on top if present
    kmlCasingLayer?.bringToFront?.();
    kmlLayer?.bringToFront?.();

  } catch (err) {
    console.warn("Polygon load failed; falling back to centroids:", err);
    plotRosterOnMap(roster); // your existing centroid points
  }
}

function applyZoomStyles() {
  const z = leafletMap.getZoom();

  // KML line weights
  if (kmlLayer)       kmlLayer.setStyle({ weight: kmlWeights(z).line });
  if (kmlCasingLayer) kmlCasingLayer.setStyle({ weight: kmlWeights(z).casing });

  // Polygons: preserve vital red on every zoom
  if (routePolyLayer) {
    routePolyLayer.setStyle(f => {
      const name = f.properties?.NAME ?? "";
      const st   = f.properties?.STUSPS ?? "";
      const isVital = currentVitalKeys.has(`${name}|${st}`);
      return {
        color:      isVital ? "#7f1d1d" : "#4b5563",
        weight:     z >= 9 ? 1.2 : 0.8,
        fillColor:  isVital ? "#ef4444" : "#3d8bfd",
        fillOpacity:z >= 8 ? 0.28 : 0.20
      };
    });
  }
}


function parseCsv(url, onComplete) {
  Papa.parse(url, {
    download: true,
    header: true,
    worker: false,                // keep off locally
    skipEmptyLines: true,
    transformHeader: h => h.replace(/\uFEFF/g, "").trim(),
    dynamicTyping: true,          // type ALL fields automatically
    complete: res => onComplete(res.data),
    error: err => console.error("Papa error:", err)
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function getKey(obj, regex) {
  const keys = Object.keys(obj || {});
  return keys.find(k => regex.test(k.trim()));
}

async function addKmlFromUrl(url, opts = {}) {
  const { silent = false } = opts;
  try {
    if (!leafletMap) return false;
    clearKmlLayer();  // <-- ensures old outline goes away

    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`);
    const text = await resp.text();
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const gj  = toGeoJSON.kml(xml);

    // 1) add casing first (underneath)
    kmlCasingLayer = L.geoJSON(gj, {
      pane: "routes",
      style: () => {
        const { casing } = kmlWeights(leafletMap.getZoom());
        return { color: "#000000", weight: casing, opacity: 1 };
      }
    }).addTo(leafletMap);

    // 2) add main yellow line
    kmlLayer = L.geoJSON(gj, {
      pane: "routes",
      style: f => {
        const t = f.geometry && f.geometry.type;
        const { line } = kmlWeights(leafletMap.getZoom());
        if (t === "LineString" || t === "MultiLineString") return { color: "#FFD500", weight: line, opacity: 1 };
        if (t === "Polygon" || t === "MultiPolygon")       return { color: "#FFD500", weight: 3, opacity: 0.95, fillColor: "#FFF3A1", fillOpacity: 0.25 };
        return { color: "#FFD500", weight: line, opacity: 1 };
      }
    }).addTo(leafletMap);

    const b = kmlLayer.getBounds();
    if (b.isValid()) {
      leafletMap.fitBounds(b.pad(0.2));
      document.getElementById('mapPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return true;
  } catch (e) {
    console.error("KML load error:", e);
    if (!silent) alert("Could not load KML:\n" + e.message);
    clearKmlLayer();
    return false;
  }
}

async function addKmlForRoute(route) {
  if (!route) return;
  const base = "https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/kml/";
  const tries = [
    `${route}.kml`,
    `${route.replace(/\s+/g, '_')}.kml`,
    `${route.replace(/\s+/g, '-')}.kml`
  ];
  for (const f of tries) {
    const ok = await addKmlFromUrl(base + f, { silent: true });
    if (ok) return;
  }
  clearKmlLayer();
}

document.addEventListener("DOMContentLoaded", () => {
  const nocache = `?v=${Date.now()}`;

  // 1) Load route-county rows
  parseCsv("https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/MasterRouteCountyList.csv" + nocache, (data) => {
    routeData = data;

    // 2) Load summary
    parseCsv("https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/RouteInfo.csv" + nocache, (data2) => {
      routeInfo = data2;

      // 3) Load county centroids
      parseCsv("https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/CountyCentroids.csv" + nocache, (cent) => {
        CountyCentroids = cent;

        populateRouteDropdown();
        initMap();  // <-- set up Leaflet once

        window.addEventListener("resize", () => {
            if (leafletMap) leafletMap.invalidateSize();
        });

        setupControls();

        document.getElementById("routeSelect").addEventListener("change", () => {
          loadRoute();
          const mapEl = document.getElementById("mapPanel");
          if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        updateControlsUI();

      });
    });
  });
});

function setupControls() {
  document.getElementById("dirBtn").addEventListener("click", () => {
    currentDirection = currentDirection ? 0 : 1;
    updateControlsUI();
    loadRoute(); // re-render with new direction
  });
  document.getElementById("touchChk").addEventListener("change", (e) => {
    touchMode = e.target.checked ? 1 : 0;
    updateControlsUI();
    loadRoute();
  });
  document.getElementById("lumpChk").addEventListener("change", (e) => {
    lumpMode = e.target.checked ? 1 : 0;
    updateControlsUI();
    loadRoute();
  });
}

function updateControlsUI() {
  const dirBtn = document.getElementById("dirBtn");
  dirBtn.textContent = currentDirection ? "Direction: Reverse" : "Direction: Forward";
  document.getElementById("touchChk").checked = !!touchMode;
  document.getElementById("lumpChk").checked  = !!lumpMode;
}

// Fills the dropdown menu
function populateRouteDropdown() {
  const dropdown = document.getElementById("routeSelect");
  const uniqueRoutes = [...new Set(routeData.map(d => d.Route))].sort();

  uniqueRoutes.forEach(route => {
    const option = document.createElement("option");
    option.value = route;
    option.text = route;
    dropdown.appendChild(option);
  });
}

function computeTriplist(route, direction = 0) {
  // figure out the actual column names once
  const sample = routeData[0] || {};
  const milesKey = getKey(sample, /^miles?age?$/i) || "Miles";
  const orderKey = getKey(sample, /^order$/i) || "Order";
  const lumpKey  = getKey(sample, /^lumpid$/i) || "LumpID";
  const parentKey= getKey(sample, /^parent$/i) || "Parent";
  const vitalKey = getKey(sample, /^vital$/i) || "Vital";
  const presKey  = getKey(sample, /^pres$/i)  || "Pres";
  const sliverKey= getKey(sample, /^sliverid$/i) || "SliverID";

  const tl = routeData
    .filter(d => d.Route === route)
    .sort((a, b) =>
      (direction === 1 ? (b[orderKey] - a[orderKey]) : (a[orderKey] - b[orderKey]))
    )
    .map((d, i) => {
      const RFlag = (d[sliverKey] || "").toString().charAt(0);
      const remove = direction === 1
        ? (RFlag === "1" || RFlag === "2" ? 1 : 0)
        : (RFlag === "1" || RFlag === "3" ? 1 : 0);
      return {
        Row: i + 1,
        County: d.County,
        State: d.State,
        Miles: toNum(d[milesKey]),
        Notes: d.Notes || "",
        LumpID: toNum(d[lumpKey]),
        Parent: toNum(d[parentKey]),
        Vital:  toNum(d[vitalKey]),
        Pres:   toNum(d[presKey]),
        SliverID: (d[sliverKey] ?? "").toString(), // <-- always a string here
        Remove: remove
      };
    });
  return tl;
}

// touch: collapse reentries (use sliver numeric if present, else County/State)
function applyTouch(triplist, touch = 0) {
  if (!touch) return triplist;
  const grouped = new Map();
  for (const d of triplist) {
    const sliver = d.SliverID ? d.SliverID.slice(1, 4) : "";
    const groupKey = sliver ? String(parseInt(sliver)) : `${d.County}|${d.State}`;
    const g = grouped.get(groupKey);
    if (!g) {
      grouped.set(groupKey, { ...d });
    } else {
      g.Miles += toNum(d.Miles);
      // keep first County/State; carry other firsts like your R code
    }
  }
  // Rebuild "df1" equivalent for downstream steps
  return Array.from(grouped.values()).map((d, idx) => ({ ...d, Row: idx + 1, Remove: 0 }));
}

// lump: independent cities into parent; key = LumpID else unique row
function applyLump(df1, lump = 0) {
  if (!lump) return df1;
  // Build group key that cannot collide with LumpID
  const groups = new Map();
  for (const d of df1) {
    const key = d.LumpID !== 0 ? `LUMP_${d.LumpID}` : `ROW_${d.Row}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...d });
    } else {
      g.Miles += toNum(d.Miles);
    }
  }
  // Now collapse to county level if multiple groups map to same county/state
  const byCounty = new Map();
  for (const g of groups.values()) {
    const k = `${g.County}|${g.State}`;
    const x = byCounty.get(k);
    if (!x) {
      // choose Parent==1 rep like in R
      byCounty.set(k, { ...g });
    } else {
      x.Miles += toNum(g.Miles);
      // keep first Vital/Pres/Notes like your R summarise
    }
  }
  return Array.from(byCounty.values());
}

function renderRoster(roster) {
  let cum = 0;

  const rows = roster.map((r, i) => {
    const miles = toNum(r.Miles);
    cum += miles;
    const vital = toNum(r.Vital) === 1;
    const pres  = toNum(r.Pres)  === 1;
    return `
      <tr class="${vital ? 'vital' : ''}">
        <td class="rownum">${i + 1}</td>
        <td class="county">${esc(r.County)}</td>
        <td class="state">${esc(r.State)}</td>
        <td class="num">${miles.toFixed(1)}</td>
        <td class="num">${cum.toFixed(1)}</td>
        <td class="notes">${esc(r.Notes)}</td>
        <td class="center">${vital ? "✓" : ""}</td>
        <td class="center">${pres ? "✓" : ""}</td>
      </tr>`;
  }).join("");

  document.getElementById("rosterPanel").innerHTML = `
    <table class="roster-table">
      <thead>
        <tr>
          <th class="rownum">#</th>
          <th class="county">County</th>
          <th class="state">State</th>
          <th class="num">Miles</th>
          <th class="num">Cum.</th>
          <th class="notes">Notes</th>
          <th class="center">Vital</th>
          <th class="center">Pres</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildRoster(route, { direction = 0, touch = 0, lump = 0 } = {}) {
  const triplist = computeTriplist(route, direction);  // df1 base
  const afterTouch = applyTouch(triplist, touch);      // apply reentry collapse if touch==1
  const afterLump  = applyLump(afterTouch, lump);      // then lump ind. cities if lump==1
  return afterLump;
}

function plotRosterOnMap(roster) {
  if (!leafletMap || !markersLayer) return;   // <-- updated
  markersLayer.clearLayers();                  // <-- updated

  const pts = [];
  roster.forEach(r => {
    const cc = CountyCentroids.find(c =>
      (c.NAME === r.County) && (c.STUSPS === r.State)
    );
    if (!cc) return;

    const lat = Number(cc.INTPTLAT);
    const lon = Number(cc.INTPTLON);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const isVital = toNum(r.Vital) === 1;
    const marker = L.circleMarker([lat, lon], {
      radius: 5,
      weight: 1,
      color: isVital ? "#b91c1c" : "#2563eb",
      fillColor: isVital ? "#ef4444" : "#60a5fa",
      fillOpacity: 0.85
    });
    marker.bindTooltip(`${r.County}, ${r.State} — ${toNum(r.Miles).toFixed(1)} mi`, { sticky: true });
    marker.addTo(markersLayer);               // <-- updated
    pts.push([lat, lon]);
  });

  if (pts.length) {
    const bounds = L.latLngBounds(pts);
    leafletMap.fitBounds(bounds.pad(0.2));    // <-- updated
  }
}

function loadRoute() {
  const route = document.getElementById("routeSelect").value;
  if (!route) {
    alert("Please select a route.");
    return;
  }

  // Build roster (touch = collapse reentries, lump = merge ind. cities)
  const roster = buildRoster(route, { 
    direction: currentDirection, 
    touch: touchMode, 
    lump: lumpMode
  });

  currentVitalKeys = new Set(
  roster.filter(r => toNum(r.Vital) === 1).map(r => `${r.County}|${r.State}`)
);

  // Totals for Vital/Pres
  const vitalCount = roster.filter(r => toNum(r.Vital) === 1).length;
  const presCount  = roster.filter(r => toNum(r.Pres)  === 1).length;

  // Summary panel text
  const summary = routeInfo.find(d => d.Route === route);
  let summaryText = summary
    ? `Route ${route} runs ${Number(summary.Miles).toFixed(1)} miles across ${summary.States} states and ${summary.Counties} counties.\n\nType: ${summary.Type}, Direction: ${summary.Direction}`
    : `Summary not available for ${route}.`;

  summaryText += `\n\nVital counties: ${vitalCount}, Presidential counties: ${presCount}`;
  document.getElementById("ifactsPanel").innerText = summaryText;

  // Render roster panel
  renderRoster(roster);
  //plotRosterOnMap(roster);
  plotRosterPolygons(route, roster);
  addKmlForRoute(route);
}
