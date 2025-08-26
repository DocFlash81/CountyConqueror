
// script.js


// ------ GLOBALS ------

let routeData = [];
let routeInfo = [];
let CountyCentroids = [];
let leafletMap, markersLayer;
let currentDirection = 0;         // 0 = forward, 1 = reverse
let touchMode = 0;                // 1 = on, 0 = off
let lumpMode = 0;                 // 1 = on, 0 = off
let kmlLayer = null;              // yellow line
let kmlCasingLayer = null;        // black outline
let routePolyLayer = null;
let currentVitalKeys = new Set(); // "County|ST"
let currentPresKeys = new Set();  // "County|ST"
let countyPolygons = null;
let countyRouteLayers;
let lastRoute = null;
let lastCounty = null;
let lastState = null;
let lastState1 = null;
let lastState2 = null;

const routePolyCache = new Map();

const stateToFips = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06",
  CO: "08", CT: "09", DE: "10", FL: "12", GA: "13",
  HI: "15", ID: "16", IL: "17", IN: "18", IA: "19",
  KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29",
  MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34",
  NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45",
  SD: "46", TN: "47", TX: "48", UT: "49", VT: "50",
  VA: "51", WA: "53", WV: "54", WI: "55", WY: "56"
};


// ------ INITIALIZATION ------


// initMap creates the initial, blank map of the US. counties, polygons, kmls, etc get added later when needed
function initMap() {
  leafletMap = L.map("mapPanel", { zoomControl: true }); // initiate map in mapPanel

  // basemap
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(leafletMap);

  leafletMap.createPane("counties"); // polygons
  leafletMap.getPane("counties").style.zIndex = 410;

  leafletMap.createPane("routes");   // KML line + casing
  leafletMap.getPane("routes").style.zIndex = 650;

  leafletMap.createPane("labels");
  leafletMap.getPane("labels").style.zIndex = 800;

  leafletMap.on("zoomend", applyZoomStyles);   // react to zoom

  markersLayer = L.layerGroup().addTo(leafletMap);
  countyRouteLayers = L.layerGroup().addTo(leafletMap);
  leafletMap.setView([39.5, -98.35], 4);

  // Fix possible layout glitch
  setTimeout(() => leafletMap.invalidateSize(), 0);
}



// ------ HELPERS ------


// ------ Universal helpers ------

// toNum converts strings to numeric. Used in multiple functions
function toNum(x) {
  const s = (x ?? "").toString().trim();
  if (s === "") return 0;
  const v = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}

// getKeys finds the first column that matches the regex
function getKey(obj, regex) {
  const keys = Object.keys(obj || {});
  return keys.find(k => regex.test(k.trim()));
}

// esc cleans up non-printable characters for HTML display (&nbsp for example)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// kmlWeights decides how fat the lines should be given the zoom level
function kmlWeights(z) {
  // tune these to taste
  const line = Math.max(2, Math.round((z - 5) * 0.9)); // main yellow
  const casing = Math.max(line + 3, 5);                // black halo
  return { line, casing };
}

// polygonStyleForZoom defines what the county polygons should look like
function polygonStyleForZoom(z) {
  return {
    color: "#4b5563",                  // county border
    weight: z >= 9 ? 1.2 : z >= 7 ? 0.9 : 0.6,
    fillColor: "#3d8bfd",
    fillOpacity: z >= 8 ? 0.25 : 0.18,   // a bit lighter when zoomed out
  };
}

// parseCsv fetches a CSV from a URL and passes it into a JS object
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

// ------ Mapping Helpers -------

// clearKmlLayer removes both kmlLayer and kmlCasingLayer
function clearKmlLayer() {
  if (kmlLayer) {
    leafletMap.removeLayer(kmlLayer);
    kmlLayer = null;
  }
  if (kmlCasingLayer) {
    leafletMap.removeLayer(kmlCasingLayer);
    kmlCasingLayer = null;
  }
}

function colorForRoute(routeName) {
  if (!routeName) return "#FFFF00"; // default yellow

  // US highways red and orange
  if (routeName.startsWith("US")) {
    const numMatch = routeName.match(/\d+/);
    const num = numMatch ? parseInt(numMatch[0], 10) : NaN;
    if (!isNaN(num)) {
      if (num >= 102) {
        return "#FFbb00"; // orange for 3-digit
      } else {
        return "#FF0000"; // red for 2-digit
      }
    }
  }

  // Interstates - blue and green
  if (routeName.startsWith("I")) {
    // Remove prefix + keep only the first group of digits
    const numMatch = routeName.match(/\d+/);
    const num = numMatch ? parseInt(numMatch[0], 10) : NaN;

    if (!isNaN(num)) {
      if (num >= 100) {
        return "#00FF00"; // bright lime green for 3-digit
      } else {
        return "#00FFFF"; // cyan for 2-digit
      }
    }
  }
  return "#FFFF00"; // fallback
}

// addKmlFromUrl reads and places a Kml onto the map
async function addKmlFromUrl(url, opts = {}) {
  const { silent = false, noClear = false, noZoom = false, routeName = "" } = opts;
  try {
    if (!leafletMap) return false;
    clearKmlLayer();  // <-- ensures old outline goes away

    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`);
    const text = await resp.text();
    const xml = new DOMParser().parseFromString(text, "text/xml");
    const gj = toGeoJSON.kml(xml);

    // 1) add casing first (underneath)
    kmlCasingLayer = L.geoJSON(gj, {
      pane: "routes",
      style: () => {
        const { casing } = kmlWeights(leafletMap.getZoom());
        return { color: "#000000", weight: casing, opacity: 1 };
      }
    }).addTo(leafletMap);

    // 2) add main line with proper color
    // 2) add main line with proper color
    const routeColor = colorForRoute(routeName);

    const newLayer = L.geoJSON(gj, {
      pane: "routes",
      style: f => {
        const t = f.geometry && f.geometry.type;
        const { line } = kmlWeights(leafletMap.getZoom());
        if (t === "LineString" || t === "MultiLineString")
          return { color: routeColor, weight: line, opacity: 1 };
        if (t === "Polygon" || t === "MultiPolygon")
          return {
            color: routeColor, weight: 3, opacity: 0.95,
            fillColor: "#FFF3A1", fillOpacity: 0.25
          };
        return { color: routeColor, weight: line, opacity: 1 };
      },
      onEachFeature: (feature, layer) => {
        if (routeName) {
          layer.bindTooltip(routeName, {
            permanent: true,
            direction: "auto",
            className: "route-label",
            pane: "labels"
          });
        }
      }
    }).addTo(leafletMap);

    // only assign to the globals if you want “single route mode”
    if (!noClear) {
      kmlLayer = newLayer;
    }

    if (!noZoom) {
      const b = kmlLayer.getBounds();
      if (b.isValid()) {
        //leafletMap.fitBounds(b.pad(0.2));
        //document.getElementById('mapPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    return true;
  } catch (e) {
    console.error("KML load error:", e);
    if (!silent) alert("Could not load KML:\n" + e.message);
    clearKmlLayer();
    return false;
  }
}

// addKmlForRoute is for Route Detail mode: clears old layers and zooms to new
async function addKmlForRoute(route) {
  if (!route) return;
  const base = "https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/kml/";
  const tries = [
    `${route}.kml`,
    `${route.replace(/\s+/g, '_')}.kml`,
    `${route.replace(/\s+/g, '-')}.kml`
  ];

  for (const f of tries) {
    const ok = await addKmlFromUrl(base + f, { silent: true, routeName: route });
    if (ok) return true;
  }
  clearKmlLayer();
  return false;
}

// addKmlForRoute is for County Focus mode: clears old layers
async function addKmlForRouteNoClear(route) {
  if (!route) return;
  const base = "https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/kml/";
  const tries = [
    `${route}.kml`,
    `${route.replace(/\s+/g, '_')}.kml`,
    `${route.replace(/\s+/g, '-')}.kml`
  ];

  for (const f of tries) {
    try {
      const resp = await fetch(base + f, { mode: 'cors' });
      if (!resp.ok) continue;

      const text = await resp.text();
      const xml = new DOMParser().parseFromString(text, "text/xml");
      const gj = toGeoJSON.kml(xml);

      const routeColor = colorForRoute(route);

      // 1) casing (black, thicker, goes underneath)
      const casing = L.geoJSON(gj, {
        pane: "routes",
        style: feature => {
          const t = feature.geometry && feature.geometry.type;
          const { casing } = kmlWeights(leafletMap.getZoom());
          if (t === "LineString" || t === "MultiLineString")
            return { color: "#000000", weight: casing, opacity: 1 };
        }
      });
      countyRouteLayers.addLayer(casing);

      // 2) main colored line
      const mainLine = L.geoJSON(gj, {
        pane: "routes",
        style: feature => {
          const t = feature.geometry && feature.geometry.type;
          const { line } = kmlWeights(leafletMap.getZoom());
          if (t === "LineString" || t === "MultiLineString")
            return { color: routeColor, weight: line, opacity: 1 };
          if (t === "Polygon" || t === "MultiPolygon")
            return {
              color: routeColor,
              weight: 3,
              opacity: 0.95,
              fillColor: "#FFF3A1",
              fillOpacity: 0.25
            };
          return { color: routeColor, weight: line, opacity: 1 };
        },
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(route, {
            permanent: true,
            direction: "auto",
            className: "route-label",
            pane: "labels"
          });
        }
      });
      countyRouteLayers.addLayer(mainLine);

      return true;
    } catch (err) {
      console.warn("KML load error for", f, err);
    }
  }
  return false;
}

// applyZoomStyles applies the styles to the KML and polygons when we zoom
function applyZoomStyles() {
  const z = leafletMap.getZoom();

  // KML line weights
  if (kmlLayer) kmlLayer.setStyle({ weight: kmlWeights(z).line });
  if (kmlCasingLayer) kmlCasingLayer.setStyle({ weight: kmlWeights(z).casing });

  // Polygons: preserve vital red on every zoom, pres green
  if (routePolyLayer) {
    routePolyLayer.setStyle(f => {
      const name = f.properties?.NAME ?? "";
      const st = f.properties?.STUSPS ?? "";
      const isVital = currentVitalKeys.has(`${name}|${st}`);
      const isPres = currentPresKeys.has(`${name}|${st}`);
      return {
        color: isVital ? "#7f1d1d" : (isPres ? "#006600" : "#4b5563"),
        weight: z >= 9 ? 1.2 : 0.8,
        fillColor: isVital ? "#ef4444" : (isPres ? "#00FF00" : "#3d8bfd"),
        fillOpacity: z >= 8 ? 0.28 : 0.20
      };
    });
  }
}

// plotRosterPolygons does the polygons on the map
async function plotRosterPolygons(route, roster) {
  if (!leafletMap) return;

  // remove prior polygons
  if (routePolyLayer) {
    leafletMap.removeLayer(routePolyLayer);
    routePolyLayer = null;
  }

  // fetch per‑route GeoJSON from your repo
  const url = `https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/kml/polygons/${route}.geojson`;

  console.log("Fetching polygons:", url);

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
        const st = f.properties?.STUSPS ?? "";
        const isVital = currentVitalKeys.has(`${name}|${st}`);
        const isPres = currentPresKeys.has(`${name}|${ st }`);
        return {
          color: isVital ? "#7f1d1d" : ( isPres ? "#006600" : "#4b5563" ), // border
          weight: leafletMap.getZoom() >= 9 ? 1.2 : 0.8,
          fillColor: isVital ? "#ef4444" : (isPres ? "#00CC00" : "#3d8bfd"),// fill
          fillOpacity: leafletMap.getZoom() >= 8 ? 0.28 : 0.20
        };
      },
      onEachFeature: (f, layer) => {
        const name = f.properties?.NAME ?? "";
        const st = f.properties?.STUSPS ?? "";
        const r = roster?.find(x => `${ x.County }|${ x.State }` === `${ name }|${ st }`);
        const miles = r ? Number(r.Miles).toFixed(1) : "";
        layer.bindTooltip(
          `${ name }, ${ st }${ miles? ` — ${miles} mi` : ""}`,
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


// ------ MODES ------


function setMode(mode) {
  // Hide everything first
  ["route-detail-ui", "county-focus-ui", "connections-ui",
    "route-detail-controls", "county-focus-controls", "connections-controls"]
    .forEach(id => document.getElementById(id).style.display = "none");

  // Enter selected mode
  if (mode === "route") enterRouteDetailMode();
  if (mode === "county") enterCountyFocusMode();
  if (mode === "connections") enterConnectionsMode();
}


// ------ ROUTE DETAIL MODE ------


// setupRouteDetailControls creates the inputs Route Detail mode uses
function setupRouteDetailControls() {
  document.getElementById("dirBtn").addEventListener("click", () => {
    currentDirection = currentDirection ? 0 : 1;
    updateRouteDetailControlsUI();
    loadRoute(); // re-render with new direction
  });
  document.getElementById("touchChk").addEventListener("change", (e) => {
    touchMode = e.target.checked ? 1 : 0;
    updateRouteDetailControlsUI();
    loadRoute();
  });
  document.getElementById("lumpChk").addEventListener("change", (e) => {
    lumpMode = e.target.checked ? 1 : 0;
    updateRouteDetailControlsUI();
    loadRoute();
  });
}

// updateRouteDetailControlsUI resets to the new settings
function updateRouteDetailControlsUI() {
  const dirBtn = document.getElementById("dirBtn");
  dirBtn.textContent = currentDirection ? "Direction: Reverse" : "Direction: Forward";
  document.getElementById("touchChk").checked = !!touchMode;
  document.getElementById("lumpChk").checked = !!lumpMode;
}

// populateRouteDropdown fills the dropdown menu with optgroups
function populateRouteDropdown() {
  const dropdown = document.getElementById("routeSelect");
  dropdown.innerHTML = "";  // clear existing

  // Group routes by Type from routeInfo
  const groups = {};
  routeInfo.forEach(r => {
    const type = r.Type || "Other";
    if (!groups[type]) groups[type] = [];
    groups[type].push(r.Route);
  });

  // Sort group keys and each group's routes
  Object.keys(groups).sort().forEach(type => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = type;

    groups[type]
      .filter((v, i, arr) => arr.indexOf(v) === i) // unique within group
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .forEach(route => {
        const option = document.createElement("option");
        option.value = route;
        option.text = route;
        optgroup.appendChild(option);
      });

    dropdown.appendChild(optgroup);
  });
}

//computeTriplist mirrors R CountyLogic.R. Sets up removal flags for touch (reentry) mode
function computeTriplist(route, direction = 0) {
  // figure out the actual column names once
  const sample = routeData[0] || {};
  const milesKey = getKey(sample, /^miles?age?$/i) || "Miles";
  const orderKey = getKey(sample, /^order$/i) || "Order";
  const lumpKey = getKey(sample, /^lumpid$/i) || "LumpID";
  const parentKey = getKey(sample, /^parent$/i) || "Parent";
  const vitalKey = getKey(sample, /^vital$/i) || "Vital";
  const presKey = getKey(sample, /^pres$/i) || "Pres";
  const sliverKey = getKey(sample, /^sliverid$/i) || "SliverID";

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
        Vital: toNum(d[vitalKey]),
        Pres: toNum(d[presKey]),
        SliverID: (d[sliverKey] ?? "").toString(), // <-- always a string here
        Remove: remove
      };
    });
  return tl;
}

// applyTouch collapses reentries (use sliver numeric if present, else County/State)
function applyTouch(triplist, touch = 0) {
  if (!touch) return triplist;
  const grouped = new Map();
  for (const d of triplist) {
    const sliver = d.SliverID ? d.SliverID.slice(1, 4) : "";
    const groupKey = sliver ? String(parseInt(sliver)) : `${ d.County } | ${ d.State }`;
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

// applyLump collapses all independent cities into parent; key = LumpID else unique row
function applyLump(df1, lump = 0) {
  if (!lump) return df1;
  // Build group key that cannot collide with LumpID
  const groups = new Map();
  for (const d of df1) {
    const key = d.LumpID !== 0 ? `LUMP_${ d.LumpID }` : `ROW_${ d.Row }`;
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
    const k = `${ g.County } | ${ g.State }`;
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

// renderRoster creates the view for the chosen roster
function renderRoster(roster) {
  let cum = 0;

  const rows = roster.map((r, i) => {
    const miles = toNum(r.Miles);
    cum += miles;
    const vital = toNum(r.Vital) === 1;
    const pres = toNum(r.Pres) === 1;
    return `
    <tr class= "${vital ? 'vital' : ''} ${pres ? 'pres' : ''}" >
        <td class="rownum">${i + 1}</td>
        <td class="county">${esc(r.County)}</td>
        <td class="state">${esc(r.State)}</td>
        <td class="num">${miles.toFixed(1)}</td>
        <td class="num">${cum.toFixed(1)}</td>
        <td class="notes">${esc(r.Notes)}</td>
        <td class="center">${vital ? "✓" : ""}</td>
        <td class="center">${pres ? "✓" : ""}</td>
      </tr > `;
  }).join("");

  document.getElementById("rosterPanel").innerHTML = `
      <div class= "roster-scroll">
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
      </table>
  </div > `;
}

// buildRoster is the set of steps that actually creates the roster
function buildRoster(route, { direction = 0, touch = 0, lump = 0 } = {}) {
  const triplist = computeTriplist(route, direction);  // df1 base
  const afterTouch = applyTouch(triplist, touch);      // apply reentry collapse if touch==1
  const afterLump = applyLump(afterTouch, lump);      // then lump ind. cities if lump==1
  return afterLump;
}

// plotRosterOnMap plots the roster on the map
function plotRosterOnMap(roster) {
  if (!leafletMap || !markersLayer) return;
  markersLayer.clearLayers();
  countyRouteLayers.clearLayers();
  clearKmlLayer();

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
    const isPres = toNum(r.Pres) === 1;

    const strokeColor = isVital ? "#b91c1c" : (isPres ? "#006600" : "#2563eb");
    const fillColor = isVital ? "#ef4444" : (isPres ? "#007700" : "#60A5FA");
    
    const marker = L.circleMarker([lat, lon], {
      radius: 5,
      weight: 1,
      color: strokeColor,
      fillColor: fillColor,
      fillOpacity: 0.85
    });
    
    marker.bindTooltip(`${ r.County }, ${ r.State } — ${ toNum(r.Miles).toFixed(1)
  } mi`, { sticky: true });
    marker.addTo(markersLayer);
    pts.push([lat, lon]);
  });

  if (pts.length) {
    const bounds = L.latLngBounds(pts);
    leafletMap.fitBounds(bounds.pad(0.2));
  }
}

// enterRouteDetailMode sets up the mode
function enterRouteDetailMode(selectedRoute = null) {
  // clear CF overlays
  countyRouteLayers.clearLayers();
  if (window.countyLayer) {
    leafletMap.removeLayer(window.countyLayer);
    window.countyLayer = null;
  }

  // clear RD leftovers
  clearKmlLayer();
  markersLayer.clearLayers();
  if (routePolyLayer) {
    leafletMap.removeLayer(routePolyLayer);
    routePolyLayer = null;
  }

  populateRouteDropdown();
  updateRouteDetailControlsUI();

  // show UI
  document.getElementById("route-detail-ui").style.display = "block";
  document.getElementById("route-detail-controls").style.display = "block";

  // if coming from CF and we know a route, load it
  const routeToLoad = selectedRoute || lastRoute;
  if (routeToLoad) {
    document.getElementById("routeSelect").value = routeToLoad;
    loadRoute();
  }
}

// loadRoute is the action for this mode
function loadRoute() {
  const route = document.getElementById("routeSelect").value;
  if (!route) {
    alert("Please select a route.");
    return;
  }
  lastRoute = route; // save for later

  updateRouteDetailControlsUI();

  // Build roster (touch = collapse reentries, lump = merge ind. cities)
  const roster = buildRoster(route, {
    direction: currentDirection,
    touch: touchMode,
    lump: lumpMode
  });

  currentVitalKeys = new Set(
    roster.filter(r => toNum(r.Vital) === 1).map(r => `${ r.County }|${ r.State }`)
  );

  currentPresKeys = new Set(
    roster.filter(r => toNum(r.Pres) === 1).map(r => `${ r.County }|${ r.State }`)
  );

  // Totals for Vital/Pres
  const vitalSet = new Set(
  roster.filter(r => toNum(r.Vital) === 1)
        .map(r => `${r.County}|${r.State}`)
  );
  const presSet = new Set(
    roster.filter(r => toNum(r.Pres) === 1)
        .map(r => `${r.County}|${r.State}`)
  );

currentVitalKeys = vitalSet;
currentPresKeys  = presSet;

const vitalCount = vitalSet.size;
const presCount  = presSet.size;

  // Summary panel text
  const summary = routeInfo.find(d => d.Route === route);
  const milesStr = Number(summary.Miles).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  let summaryText = summary
    ? `Route ${ route } runs ${ milesStr } miles across ${ summary.States } states and ${ summary.Counties } counties.`
    + `<br><br>Type: ${summary.Type}, Direction: ${summary.Direction}`
      : `Summary not available for ${route}.`;

      summaryText += `<br><br>
        <span style="color:#b91c1c; font-weight:bold;">Vital counties: ${vitalCount}</span>,
        <span style="color:#007700; font-weight:bold;">Presidential counties: ${presCount}</span>`;

        document.getElementById("ifactsPanel").innerHTML = summaryText;


        // Render roster panel
        renderRoster(roster);
        //plotRosterOnMap(roster);
        plotRosterPolygons(route, roster);
        addKmlForRoute(route);
}


        // ------ COUNTY FOCUS MODE ------


        // Populate the State dropdown using CountyCentroids
        function populateStateDropdown() {
  const stateSelect = document.getElementById("stateSelect");
        stateSelect.innerHTML = '<option value="">-- Choose a State --</option>';

  // Unique states from CountyCentroids
  const states = [...new Set(CountyCentroids.map(c => c.STUSPS))].sort();

  states.forEach(st => {
    const opt = document.createElement("option");
        opt.value = st;
        opt.textContent = st;
        stateSelect.appendChild(opt);
  });

  // Hook up listener for state change
  stateSelect.addEventListener("change", () => {
    const st = stateSelect.value;
        populateCountyDropdown(st);
  });
}

        // Populate the County dropdown based on chosen state
        function populateCountyDropdown(state) {
  const countySelect = document.getElementById("countySelect");
        countySelect.innerHTML = '<option value="">-- Choose a County --</option>';

        if (!state) {
          countySelect.disabled = true;
        return;
  }

        const counties = CountyCentroids
    .filter(c => c.STUSPS === state)
    .map(c => c.NAME)
        .sort();

  counties.forEach(name => {
    const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        countySelect.appendChild(opt);
  });

        countySelect.disabled = false;

  // Hook up listener for county change
  countySelect.addEventListener("change", () => {
    const county = countySelect.value;
        if (county) {
          handleCountySelection(state, county);
    }
  });
}

        // getRoutesForCounty finds all unique routes that touch a given county
        function getRoutesForCounty(county, state) {
  if (!county || !state) return [];

        return [...new Set(
        routeData
      .filter(d => d.County === county && d.State === state)
      .map(d => d.Route)
  )].sort((a, b) => a.localeCompare(b, undefined, {numeric: true }));
}

        // loadCountyFocus creates the list of routes for this county
        function loadCountyFocus(county, state) {
          document.getElementById("cfTitle").innerText = `${county}, ${state}`;
        const routes = getRoutesForCounty(county, state);
        console.log("Routes found:", routes, "cfRouteList before:", document.getElementById("cfRouteList").innerHTML);

        const listHtml = `
        <p>Routes through this county:</p>
        <ul>
          ${routes.map(r => `<li><a href="#" onclick="jumpToRoute('${r}')">${r}</a></li>`).join("")}
        </ul>`;

       document.getElementById("cfRouteList").innerHTML = listHtml;
}

        // jumpToRoute is our bridge to display the individual routes, using loadRoute from RouteDetail mode
        function jumpToRoute(route) {
          setMode("route");
        document.getElementById("routeSelect").value = route;
        loadRoute();
}

        // enterCountyFocusMode sets up the County Focus mode
        function enterCountyFocusMode() {
          // clear RD overlays
          clearKmlLayer();
        markersLayer.clearLayers();
        if (routePolyLayer) {
          leafletMap.removeLayer(routePolyLayer);
        routePolyLayer = null;
  }

        document.getElementById("rosterPanel").innerHTML =
        "<p style='color:#666;font-style:italic;'>Roster not available in County Focus Mode.</p>";

        // show UI
        document.getElementById("county-focus-ui").style.display = "block";
        document.getElementById("county-focus-controls").style.display = "block";
        document.getElementById("mapPanel").style.display = "block";

        populateStateDropdown();

        if (lastState && lastCounty) {
          document.getElementById("stateSelect").value = lastState;
        populateCountyDropdown(lastState);
        document.getElementById("countySelect").value = lastCounty;
        handleCountySelection(lastState, lastCounty);
  }
}

        // handleCountySelection does the actions for County Focus mode
        async function handleCountySelection(state, county) {
          console.log("handleCountySelection called with:", state, county);
        lastState = state;
        lastCounty = county;
        countyRouteLayers.clearLayers();
  const cc = CountyCentroids.find(c => c.STUSPS === state && c.NAME === county);
        console.log("Centroid match:", cc);
        if (!cc || !leafletMap) {
          console.warn("No centroid match or map not ready");
        return;
  }

        const lat = Number(cc.INTPTLAT);
        const lon = Number(cc.INTPTLON);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          leafletMap.setView([lat, lon], 9);
  }

        if (!countyPolygons) return;

        const fips = stateToFips[state];
        console.log("Looking for county", state, county, "with FIPS", fips);
        const match = countyPolygons.features.find(
    f => f.properties.STATEFP === fips && f.properties.NAME === county
        );

        console.log("Polygon match:", match);

        if (match) {
    if (window.countyLayer) leafletMap.removeLayer(window.countyLayer);
        window.countyLayer = L.geoJSON(match, {
          style: {color: "blue", weight: 2, fillOpacity: 0.2 }
    }).addTo(leafletMap);
        leafletMap.fitBounds(window.countyLayer.getBounds());
  } else {
          console.warn("No polygon match for", county, state);
  }

        // Update the route list panel
        loadCountyFocus(county, state);

        // === Add KMLs for *all* routes in this county ===
        const routes = getRoutesForCounty(county, state);
        console.log("Adding KMLs for routes:", routes);

        for (const r of routes) {
          addKmlForRouteNoClear(r);
  }
}


        // ------ CONNECTIONS MODE ------


        // enterConnectionsMode sets up Connection mode
        function enterConnectionsMode() {
          // clear both RD + CF layers
          clearKmlLayer();
        countyRouteLayers.clearLayers();
        markersLayer.clearLayers();

        // show UI
        document.getElementById("connections-ui").style.display = "block";
        document.getElementById("connections-controls").style.display = "block";
}


// ------ BOOTSTRAP ------


document.addEventListener("DOMContentLoaded", () => {
  const nocache = `?v=${Date.now()}`;

        // 1) Load route-county rows
        parseCsv(
        "https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/MasterRouteCountyList.csv" + nocache,
    (data) => {
          routeData = data;

        // 2) Load RouteInfo
        parseCsv(
        "https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/RouteInfo.csv" + nocache,
        (data2) => {
          routeInfo = data2;

        // 3) Load county centroids
        parseCsv(
        "https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/CountyCentroids.csv" + nocache,
            (cent) => {
          CountyCentroids = cent;

        // 4) Load county polygons, for County Focus mode

        // Load the simplified county polygons
        fetch("https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/CountyPolygons.json")
                .then(res => res.json())
                .then(data => {
          countyPolygons = data;
        console.log("County polygons loaded:", countyPolygons);
                })
                .catch(err => console.error("Failed to load county polygons:", err));


        initMap(); // <-- set up Leaflet once
        populateStateDropdown();

              window.addEventListener("resize", () => {
                if (leafletMap) leafletMap.invalidateSize();
              });

        setupRouteDetailControls();

        document
        .getElementById("routeSelect")
                .addEventListener("change", () => {
          loadRoute();
        const mapEl = document.getElementById("mapPanel");
        if (mapEl)
        if (mode === "county") {
          mapEl.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
                    }
                });

        populateRouteDropdown();
            }
        );
        }
        );
    }
        );
});
