
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
let currentMode = "route"; // default to Route Detail


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

// GROUPS is for the RD dropdown
const GROUPS = [
  // Interstates — Main
  { id: "I-main-1", label: "Interstates 2–40", klass: "I-main", ranges: [[2, 40]] },
  { id: "I-main-2", label: "Interstates 41–74", klass: "I-main", ranges: [[41, 74]] },
  { id: "I-main-3", label: "Interstates 75–99", klass: "I-main", ranges: [[75, 99]] },

  // Interstates — Spurs (your 8 buckets)
  { id: "I-spur-1", label: "I-105–I-184", klass: "I-spur", ranges: [[105, 184]] },
  { id: "I-spur-2", label: "I-185–I-235", klass: "I-spur", ranges: [[185, 235]] },
  { id: "I-spur-3", label: "I-238–I-285", klass: "I-spur", ranges: [[238, 285]] },
  { id: "I-spur-4", label: "I-287–I-380", klass: "I-spur", ranges: [[287, 380]] },
  { id: "I-spur-5", label: "I-381–I-475", klass: "I-spur", ranges: [[381, 475]] },
  { id: "I-spur-6", label: "I-476–I-587", klass: "I-spur", ranges: [[476, 587]] },
  { id: "I-spur-7", label: "I-590–I-696", klass: "I-spur", ranges: [[590, 696]] },
  { id: "I-spur-8", label: "I-705–I-990", klass: "I-spur", ranges: [[705, 990]] },

  // US — Main
  { id: "US-main-1", label: "US 1–16", klass: "US-main", ranges: [[1, 16]] },
  { id: "US-main-2", label: "US 17–34", klass: "US-main", ranges: [[17, 34]] },
  { id: "US-main-3", label: "US 35–58", klass: "US-main", ranges: [[35, 58]] },
  { id: "US-main-4", label: "US 59-76", klass: "US-main", ranges: [[59, 76]] },
  { id: "US-main-5", label: "US 77–101", klass: "US-main", ranges: [[77, 101]] },

  // US — Spurs
  { id: "US-spur-1", label: "US 113–178", klass: "US-spur", ranges: [[113, 178]] },
  { id: "US-spur-2", label: "US 180–259", klass: "US-spur", ranges: [[180, 259]] },
  { id: "US-spur-3", label: "US 264-350", klass: "US-spur", ranges: [[264, 350]] },
  { id: "US-spur-4", label: "US 360–730", klass: "US-spur", ranges: [[360, 730]] },
];


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

// flipDirection flips the direction for display
function flipDirection(dir) {
  if (dir === "WE") return "EW";
  if (dir === "EW") return "WE";
  if (dir === "SN") return "NS";
  if (dir === "NS") return "SN";
  return dir;
}

// parseRouteId separates the RouteInfo Route into 3 components: System ("I" or "US"), number, suffix ("A", "E" ).
function parseRouteId(id) {
  // Split on "."
  const parts = id.split(".");

  // First part is always the system, like "US" or "I"
  const sys = parts[0];

  // Second part should always start with the number (like "11", "264A")
  const numPart = parts[1] || "";
  const num = parseInt(numPart.match(/^\d+/)[0]);   // take leading digits
  const suf1 = numPart.replace(/^\d+/, "");         // anything after digits (like "A")

  // Initialize optional pieces
  let suf2 = "";
  let state = "";
  let index = "";

  // Walk through the remaining parts
  for (let i = 2; i < parts.length; i++) {
    const p = parts[i];
    if (/^[A-Z]{2}\d*$/.test(p)) {
      // State code, possibly with index like "NC1"
      state = p.match(/^[A-Z]{2}/)[0];
      index = p.replace(/^[A-Z]{2}/, "");
    } else if (/^[A-Z]$/.test(p)) {
      // Single-letter suffix like "E" or "W"
      suf2 = p;
    } else {
      // Fallback: stick anything else into suf2
      suf2 = p;
    }
  }

  return { sys, num, suf1, suf2, state, index };
}

// routeClass determines Interstate or US
function routeClass(r) {
  // US-101 is historically "main" — treat as main even though 3 digits
  if (r.sys === "I") return r.num < 100 ? "I-main" : "I-spur";
  if (r.sys === "US") return (r.num <= 101) ? "US-main" : "US-spur";
  return "other";
}

// cmpRoute helps sort
// Sort: numeric, then suffix so 20 < 20A
function cmpRoute(a, b) {
  const ra = parseRouteId(a);
  const rb = parseRouteId(b);

  // sort by system (I, US, etc.)
  if (ra.sys !== rb.sys) return ra.sys.localeCompare(rb.sys);

  // then by number
  if (ra.num !== rb.num) return ra.num - rb.num;

  // then by suffix 1 (A, B, etc.)
  if (ra.suf1 !== rb.suf1) return ra.suf1.localeCompare(rb.suf1);

  // then by suffix 2 (E, W, etc.)
  if (ra.suf2 !== rb.suf2) return ra.suf2.localeCompare(rb.suf2);

  // then by state code (VA, NC, etc.)
  if (ra.state !== rb.state) return ra.state.localeCompare(rb.state);

  // finally by index (like NC1 vs NC2)
  if (ra.index !== rb.index) return (ra.index || "").localeCompare(rb.index || "");

  return 0;
}

// inRanges determines if a value is in the given range
function inRanges(num, ranges) {
  return ranges.some(([lo, hi]) => num >= lo && num <= hi);
}

// findGroupForRoute is needed due to the two step dropdown
function findGroupForRoute(routeId) {
  for (const g of window.routeBuckets.values()) {
    if (g.routes.includes(routeId)) return g.id;
  }
  return null;
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
    // clearKmlLayer();  // <-- ensures old outline goes away

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
    // clearKmlLayer();
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
  // We moved this to loadRoute   clearKmlLayer();
  return false;
}

// addKmlForRouteNoClear is for County Focus mode: clears old layers, no zoom
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

      // --- merge only the line-type geometries ---
      // --- flatten MultiGeometry (GeometryCollection) ---
      const flattened = [];
      gj.features.forEach(feat => {
        const g = feat.geometry;
        if (!g) return;

        if (g.type === "GeometryCollection" && Array.isArray(g.geometries)) {
          g.geometries.forEach(sub => {
            if (sub.type === "LineString" || sub.type === "MultiLineString") {
              flattened.push({ type: "Feature", properties: feat.properties, geometry: sub });
            }
          });
        } else if (g.type === "LineString" || g.type === "MultiLineString") {
          flattened.push(feat);
        }
      });

      const merged = { type: "FeatureCollection", features: flattened };

      const routeColor = colorForRoute(route);
      const { line, casing } = kmlWeights(leafletMap.getZoom());

      const casingLayer = L.geoJSON(merged, {
        pane: "routes",
        style: () => ({ color: "#000000", weight: casing, opacity: 1 })
      });
      const mainLayer = L.geoJSON(merged, {
        pane: "routes",
        style: () => ({ color: routeColor, weight: line, opacity: 1 }),
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(route, {
            permanent: true,
            direction: "auto",
            className: "route-label",
            pane: "labels"
          });
        }
      });

      countyRouteLayers.addLayer(casingLayer);
      countyRouteLayers.addLayer(mainLayer);
      mainLayer.bringToFront();   // enforce draw order

      return true;
    } catch (err) {
      console.warn("KML load error for", f, err);
    }
  }
  return false;
}

// applyZoomStyles applies the styles to the KML and polygons when we zoom
function applyZoomStyles() {
  if (currentMode !== "route") return; // Bail if not RD mode
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
        const isPres = currentPresKeys.has(`${name}|${st}`);
        return {
          color: isVital ? "#7f1d1d" : (isPres ? "#006600" : "#4b5563"), // border
          weight: leafletMap.getZoom() >= 9 ? 1.2 : 0.8,
          fillColor: isVital ? "#ef4444" : (isPres ? "#00CC00" : "#3d8bfd"),// fill
          fillOpacity: leafletMap.getZoom() >= 8 ? 0.28 : 0.20
        };
      },
      onEachFeature: (f, layer) => {
        const name = f.properties?.NAME ?? "";
        const st = f.properties?.STUSPS ?? "";
        const r = roster?.find(x => `${x.County}|${x.State}` === `${name}|${st}`);
        const miles = r ? Number(r.Miles).toFixed(1) : "";

        // TODO: For counties with reentries, show the *summed* miles
        // across all segments instead of just the single row mileage, when hovering.
        // Requires aggregating roster miles by County|State before binding.

        layer.bindTooltip(
          `${name}, ${st}${miles ? ` — ${miles} mi` : ""}`,
          { sticky: true }
        );

        // TODO: Make county polygons clickable. On click, jump into
        // County Focus mode for that county (like handleCountySelection).
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
  currentMode = mode; // track current mode globally

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
    const route = document.getElementById("routeSelect").value;
    if (!route) return; // ignore if no route selected
    const info = routeInfo.find(d => d.Route === route);
    if (info && info.Direction) {
      info.Direction = flipDirection(info.Direction);
    }
    currentDirection = currentDirection ? 0 : 1;
    updateRouteDetailControlsUI();
    loadRoute();
  });
  document.getElementById("touchChk").addEventListener("change", (e) => {
    touchMode = e.target.checked ? 1 : 0;
    updateRouteDetailControlsUI();
    loadRoute();
  });
  document.getElementById("lumpChk").addEventListener("change", (e) => {
    lumpMode = e.target.checked ? 1 : 0;

    const route = document.getElementById("routeSelect").value;
    const triplist = computeTriplist(route, currentDirection);
    console.log("Triplist BEFORE lumping:", triplist);

    const afterTouch = applyTouch(triplist, touchMode);
    console.log("After Touch:", afterTouch);

    const afterLump = applyLump(afterTouch, lumpMode);
    console.log("After Lump:", afterLump);

    updateRouteDetailControlsUI();
    loadRoute();
  });

}

// updateRouteDetailControlsUI resets to the new settings
function updateRouteDetailControlsUI() {
  const dirBtn = document.getElementById("dirBtn");
  // Always keep the button text static
  dirBtn.textContent = "Switch Direction";

  document.getElementById("touchChk").checked = !!touchMode;
  document.getElementById("lumpChk").checked = !!lumpMode;
}

// buildGroupedRoutes is the first step in the two-stage dropdown
function buildGroupedRoutes(allRouteIds) {
  const buckets = new Map(GROUPS.map(g => [g.id, { ...g, routes: [] }]));
  const unassigned = [];

  for (const rid of allRouteIds) {
    const p = parseRouteId(rid);
    if (!p) { unassigned.push(rid); continue; }
    const klass = routeClass(p);
    const grp = GROUPS.find(g => g.klass === klass && inRanges(p.num, g.ranges));
    if (grp) {
      buckets.get(grp.id).routes.push(rid);
    } else {
      unassigned.push(rid);
    }
  }

  // sort each group's routes
  for (const g of buckets.values()) g.routes.sort(cmpRoute);
  return { buckets, unassigned };
}

// populateGroupDropdown wires up the first dropdown
function populateGroupDropdown(buckets) {
  const sel = document.getElementById("routeGroupSelect");

  // Start with placeholder
  sel.innerHTML = "<option value=''>-- Choose a Group --</option>";

  for (const g of buckets.values()) {
    if (g.routes.length === 0) continue;
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.label;
    sel.appendChild(opt);
  }
}

//populateRouteDropdown populates the second dropdown
function populateRouteDropdown(buckets) {
  const gsel = document.getElementById("routeGroupSelect");
  const rsel = document.getElementById("routeSelect");
  const g = buckets.get(gsel.value);

  // Always start with a placeholder
  rsel.innerHTML = "<option value=''>-- Choose a Route --</option>";

  if (!g) return;

  for (const rid of g.routes) {
    const opt = document.createElement("option");
    opt.value = rid;
    opt.textContent = rid.replaceAll(".", " ");
    rsel.appendChild(opt);
  }
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
      (direction === 0 ? (a[orderKey] - b[orderKey]) : (b[orderKey] - a[orderKey]))
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
    const groupKey = sliver ? String(parseInt(sliver)) : `${d.County} | ${d.State}`;
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

  const groups = new Map();
  let sawLumps = false;

  for (const d of df1) {
    if (d.LumpID && d.LumpID !== 0) {
      sawLumps = true;
      const key = `LUMP_${d.LumpID}`;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { ...d });
      } else {
        g.Miles += toNum(d.Miles);
      }
    } else {
      groups.set(`ROW_${d.Row}`, { ...d });
    }
  }

  if (!sawLumps) {
    // ✅ no independent cities — return rows grouped only by RowID
    return Array.from(groups.values());
  }

  // otherwise collapse independent cities to counties
  const byCounty = new Map();
  for (const g of groups.values()) {
    const k = `${g.County} | ${g.State}`;
    const x = byCounty.get(k);
    if (!x) {
      byCounty.set(k, { ...g });
    } else {
      x.Miles += toNum(g.Miles);
    }
  }
  return Array.from(byCounty.values());
}

// computeRosterFacts adds cool summary information, using the roster facts in triplist (where roster comes from)
function computeRosterFacts(roster) {
  if (!roster || roster.length === 0) return null;

  const segments = roster.length;
  const totalMiles = roster.reduce((sum, r) => sum + toNum(r.Miles), 0);
  const avgMilesPerSegment = segments > 0 ? totalMiles / segments : 0;

  // Mileage & county counts by state
  const byState = {};
  roster.forEach(r => {
    const st = r.State;
    const miles = toNum(r.Miles);
    if (!byState[st]) {
      byState[st] = { miles: 0, counties: new Set() };
    }
    byState[st].miles += miles;
    byState[st].counties.add(r.County);
  });

  const milesByState = {};
  for (const [st, obj] of Object.entries(byState)) {
    milesByState[st] = {
      miles: obj.miles,
      countyCount: obj.counties.size
    };
  }

  return { segments, avgMilesPerSegment, milesByState };
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

  console.log("Triplist:", triplist);
  console.log("After Touch:", afterTouch);
  console.log("After Lump:", afterLump);

  return afterLump;
}

// plotRosterOnMap plots the roster on the map
function plotRosterOnMap(roster) {
  if (!leafletMap || !markersLayer) return;
  markersLayer.clearLayers();
  countyRouteLayers.clearLayers();
  // clearKmlLayer();

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

    marker.bindTooltip(`${r.County}, ${r.State} — ${toNum(r.Miles).toFixed(1)
      } mi`, { sticky: true });
    marker.addTo(markersLayer);
    pts.push([lat, lon]);
  });

  if (pts.length) {
    const bounds = L.latLngBounds(pts);

    // --- Dynamic padding based on geographic span ---
    const latDiff = Math.abs(bounds.getNorth() - bounds.getSouth());
    const lonDiff = Math.abs(bounds.getEast() - bounds.getWest());
    const span = Math.max(latDiff, lonDiff);

    let pad = Math.min(0.04, 0.01 + 0.0015 * span);

    leafletMap.fitBounds(bounds.pad(pad));
  }

}

// enterRouteDetailMode sets up the mode
function enterRouteDetailMode(selectedRoute = null) {
  countyRouteLayers.clearLayers();
  if (window.countyLayer) { leafletMap.removeLayer(window.countyLayer); window.countyLayer = null; }
  markersLayer.clearLayers();
  if (routePolyLayer) { leafletMap.removeLayer(routePolyLayer); routePolyLayer = null; }

  populateGroupDropdown(window.routeBuckets);
  const routeSel = document.getElementById("routeSelect");
  const groupSel = document.getElementById("routeGroupSelect");

  // default group if first entry
  if (!selectedRoute && !lastRoute) {
    groupSel.value = "I-main-1";
    populateRouteDropdown(window.routeBuckets);
  }

  // new: ensure routes are loaded for the last route's group
  const routeToLoad = selectedRoute || lastRoute;
  if (routeToLoad) {
    const groupId = findGroupForRoute(routeToLoad);
    if (groupId) {
      groupSel.value = groupId;
      populateRouteDropdown(window.routeBuckets);
      routeSel.value = routeToLoad;
      loadRoute();   // <- triggers KML load immediately
    }
  }

  document.getElementById("route-detail-ui").style.display = "block";
  document.getElementById("route-detail-controls").style.display = "block";
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

  // Here is the place to clear RD layers
  clearKmlLayer();
  markersLayer.clearLayers();
  countyRouteLayers.clearLayers(); // safety, but they should already be cleared
  if (routePolyLayer) {
    leafletMap.removeLayer(routePolyLayer);
    routePolyLayer = null;
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

  currentPresKeys = new Set(
    roster.filter(r => toNum(r.Pres) === 1).map(r => `${r.County}|${r.State}`)
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
  currentPresKeys = presSet;

  const vitalCount = vitalSet.size;
  const presCount = presSet.size;

  // Summary panel text
  const summary = routeInfo.find(d => d.Route === route);
  const milesStr = Number(summary.Miles).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  let summaryText = summary
    ? `Route ${route} runs ${milesStr} miles across ${summary.States} states and ${summary.Counties} counties.`
    + `<br><br>Type: ${summary.Type}, Direction: ${summary.Direction}`
    : `Summary not available for ${route}.`;

  // --- Extra computed facts ---
  const facts = computeRosterFacts(roster);
  if (facts) {
    if (facts.segments) {
      summaryText += `<br><br>Segments: ${facts.segments}`;
      if (facts.avgMilesPerSegment) {
        summaryText += ` (avg ${facts.avgMilesPerSegment.toFixed(1)} mi/segment)`;
      }
    }

    summaryText += `<br><br><u>Mileage and counties by state</u>:<br>`;
    for (const [st, obj] of Object.entries(facts.milesByState)) {
      summaryText += `${st}: ${obj.miles.toFixed(1)} mi across ${obj.countyCount} counties<br>`;
    }
  }

  // TODO: This table of mileages by state needs to be a table (<td>)

  summaryText += `<br><br>
        <span style="color:#b91c1c; font-weight:bold;">Vital counties: ${vitalCount}</span>,
        <span style="color:#007700; font-weight:bold;">'Presidential' counties: ${presCount}</span>`;

  document.getElementById("ifactsPanel").innerHTML = summaryText;

  // Render roster panel
  renderRoster(roster);
  //plotRosterOnMap(roster);
  plotRosterPolygons(route, roster);
  addKmlForRoute(route);
}


// ------ COUNTY FOCUS MODE ------


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

// Populate the State dropdown using CountyCentroids
const EXCLUDE_STATES = ["AS", "GU", "MP", "PR", "VI"];
function populateStateDropdown() {
  const stateSelect = document.getElementById("stateSelect");
  stateSelect.innerHTML = '<option value="">-- Choose a State --</option>';

  const states = [...new Set(
    CountyCentroids.map(c => c.STUSPS)
  )]
    .filter(st => !EXCLUDE_STATES.includes(st))  // <-- filter here
    .sort();

  states.forEach(st => {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = st;
    stateSelect.appendChild(opt);
  });

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
  )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// loadCountyFocus creates the list of routes for this county
function loadCountyFocus(county, state) {
  document.getElementById("cfTitle").innerText = `${county}, ${state}`;
  const routes = getRoutesForCounty(county, state);
  console.log("Routes found:", routes, "cfRouteList before:", document.getElementById("cfRouteList").innerHTML);

  let listHtml = "";

  if (routes.length > 0) {
    listHtml = `
      <p>Routes through this county:</p>
      <ul>
        ${routes.map(r => `<li><a href="#" onclick="jumpToRoute('${r}')">${r}</a></li>`).join("")}
      </ul>`;
  }

  document.getElementById("cfRouteList").innerHTML = listHtml;
}

// jumpToRoute is our bridge to display the individual routes, using loadRoute from RouteDetail mode
function jumpToRoute(routeId) {
  // Remember the route for persistence
  lastRoute = routeId;

  // Find which group this route belongs to
  const groupId = findGroupForRoute(routeId);

  // Switch to RD mode (this hides CF UI and resets the dropdowns)
  setMode("route");

  // Now repopulate routes for that group
  if (groupId) {
    document.getElementById("routeGroupSelect").value = groupId;
    populateRouteDropdown(window.routeBuckets);
  }

  // Set the specific route value
  const routeSel = document.getElementById("routeSelect");
  routeSel.value = routeId;

  // Finally, load it
  if (routeSel.value === routeId) {
    loadRoute();
  } else {
    console.warn("Route not found in dropdown:", routeId);
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

  console.log("Polygon match raw:", match);
  console.log("Polygon match type:", typeof match, "truthy?", !!match);

  if (match) {

    console.log("in the match if loop");
    const routesHere = routeData.filter(r => r.County === county && r.State === state);
    const routeCount = routesHere.length;

    let style = { color: "blue", weight: 2, fillOpacity: 0.2 };
    let note = "";

    console.log("County:", county, "State:", state, "Routes here:", routeCount);
    if (routeCount === 1) {
      style = { color: "red", weight: 2, fillOpacity: 0.4 };
      note = "This county is vital (only 1 route passes through).";
    } else if (routeCount === 0) {
      style = { color: "black", weight: 2, fillOpacity: 0.2 };
      note = "This county is off the US/Interstate grid.";
    }

    console.log("Note decided:", note);

    if (window.countyLayer) leafletMap.removeLayer(window.countyLayer);
    window.countyLayer = L.geoJSON(match, { style }).addTo(leafletMap);
    leafletMap.fitBounds(window.countyLayer.getBounds());

    // Clear any old note
    const oldNote = document.getElementById("county-note");
    if (oldNote) oldNote.remove();

    // Add note if needed
    if (note) {
      const p = document.createElement("p");
      p.id = "county-note";
      p.style.color = "#900";
      p.style.fontWeight = "bold";
      p.textContent = note;
      document.getElementById("cfRouteList").insertAdjacentElement("beforebegin", p);
    }
  }


  // Update the route list panel
  loadCountyFocus(county, state);


  // TODO: Optionally add a "County Facts" panel here.
  // Could include population, pronunciation guide, history, etc.
  // Might pull from an external dataset or static JSON.

  // === Add KMLs for *all* routes in this county ===
  const routes = getRoutesForCounty(county, state);
  console.log("Adding KMLs for routes:", routes);

  for (const r of routes) {
    addKmlForRouteNoClear(r);
  }
}


// ------ CONNECTIONS MODE ------


function enterConnectionsMode() {
  // clear both RD + CF layers
  clearKmlLayer();
  countyRouteLayers.clearLayers();
  markersLayer.clearLayers();
  // also remove any leftover county highlight
  if (window.countyLayer) {
    leafletMap.removeLayer(window.countyLayer);
    window.countyLayer = null;
  }
  // also clear leftover polygons right away
  if (routePolyLayer) {
    leafletMap.removeLayer(routePolyLayer);
    routePolyLayer = null;
  }
  leafletMap.eachLayer(l => {
    if (l instanceof L.GeoJSON && !l.getAttribution) leafletMap.removeLayer(l);
  });

  // show only Connections UI
  document.getElementById("connections-ui").style.display = "block";
  document.getElementById("connections-controls").style.display = "block";
  document.getElementById("mapPanel").style.display = "block";

  // clear roster panel
  document.getElementById("rosterPanel").innerHTML =
    "<p style='color:#666;font-style:italic;'>Roster not available in Connections Mode.</p>";

  populateState1Dropdown();

  // 🔑 Restore persistence if we have states saved
  if (lastState1 && lastState2) {
    document.getElementById("state1Select").value = lastState1;
    populateNextDropdown(lastState1);
    document.getElementById("state2Select").value = lastState2;

    // Re-apply selection to rebuild map + list
    handleSelections(lastState1, lastState2);
  }
}

// Populate the first State dropdown
function populateState1Dropdown() {
  const state1Select = document.getElementById("state1Select");
  state1Select.innerHTML = '<option value="">-- Choose a State --</option>';

  const states = [...new Set(CountyCentroids.map(c => c.STUSPS))]

    .filter(st => !EXCLUDE_STATES.includes(st))  // <-- filter here
    .sort();

  states.forEach(st => {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = st;
    state1Select.appendChild(opt);
  });

  state1Select.addEventListener("change", () => {
    const st = state1Select.value;
    populateNextDropdown(st);
  });
}

// Populate the second State dropdown (exclude the first choice)
function populateNextDropdown(state) {
  const state2Select = document.getElementById("state2Select");
  state2Select.innerHTML = '<option value="">-- Choose a State --</option>';

  if (!state) {
    state2Select.disabled = true;
    return;
  }

  const states = [...new Set(CountyCentroids.map(c => c.STUSPS))]
    .filter(s => s !== state)
    .filter(st => !EXCLUDE_STATES.includes(st))
    .sort();

  states.forEach(st => {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = st;
    state2Select.appendChild(opt);
  });

  state2Select.disabled = false;

  state2Select.addEventListener("change", () => {
    const state2 = state2Select.value;
    if (state2) {
      handleSelections(state, state2);
    }
  });
}

function getRoutesForStates(state1, state2) {
  if (!state1 || !state2) return [];

  const routesInState1 = new Set(
    routeData.filter(d => d.State === state1).map(d => d.Route)
  );
  const routesInState2 = new Set(
    routeData.filter(d => d.State === state2).map(d => d.Route)
  );

  // Intersection of the two sets
  const connectingRoutes = [...routesInState1].filter(r => routesInState2.has(r));

  return connectingRoutes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// zoomToStates zooms the map to fit the two states
function zoomToStates(state1, state2) {
  if (!countyPolygons || !leafletMap) return;

  const fips1 = stateToFips[state1];
  const fips2 = stateToFips[state2];

  const matches = countyPolygons.features.filter(
    f => f.properties.STATEFP === fips1 || f.properties.STATEFP === fips2
  );

  if (matches.length) {
    const layer = L.geoJSON(matches);
    const bounds = layer.getBounds();

    // Get lat/lon span
    const latDiff = Math.abs(bounds.getNorth() - bounds.getSouth());
    const lonDiff = Math.abs(bounds.getEast() - bounds.getWest());
    const span = Math.max(latDiff, lonDiff);

    // Dynamic padding: big spans = more padding, small spans = less
    // Example thresholds — adjust to taste
    let pad = 0.05; // default tight
    if (span > 20) pad = 0.15;   // continental size selection
    else if (span > 10) pad = 0.1; // medium multi-state selection

    leafletMap.fitBounds(bounds.pad(pad));
  }
}

// loadConnections creates the list of routes connecting these states
function loadConnections(state1, state2) {
  document.getElementById("connectionsTitle").innerText =
    `Routes from ${state1} to ${state2}:`;

  const routes = getRoutesForStates(state1, state2);

  const listHtml = `
    <p>Routes between these states:</p>
    <ul>
      ${routes.map(r => `<li><a href="#" onclick="jumpToRoute('${r}')">${r}</a></li>`).join("")}
    </ul>`;

  document.getElementById("connectionsList").innerHTML = listHtml;
}

// handleSelections does the actions for Connections mode
async function handleSelections(state1, state2) {
  console.log("handleSelections called with:", state1, state2);
  lastState1 = state1;
  lastState2 = state2;
  countyRouteLayers.clearLayers();

  // update route list panel
  loadConnections(state1, state2);

  // zoom to both states
  zoomToStates(state1, state2);

  // Highlight the two selected states
  if (routePolyLayer) {
    leafletMap.removeLayer(routePolyLayer);
    routePolyLayer = null;
  }

  const selectedStates = [state1, state2];

  console.log("Drawing state polygons for:", state1, state2, countyPolygons);

  const selectedFips = [stateToFips[state1], stateToFips[state2]];

  const stateFeatures = statePolygons.features.filter(
    f => selectedFips.includes(f.properties.STATE)
  );

  routePolyLayer = L.geoJSON(stateFeatures, {
    style: {
      color: "#cc6600",
      weight: 2,
      fillColor: "#ffcc66",
      fillOpacity: 0.25
    },
    onEachFeature: (feature, layer) => {
      const abbrev = feature.properties.NAME;
      layer.bindTooltip(abbrev, {
        permanent: true,
        direction: "center",
        className: "state-label"
      });
    }
  }).addTo(leafletMap);


  // add KMLs for all connecting routes
  const routes = getRoutesForStates(state1, state2);
  for (const r of routes) {
    addKmlForRouteNoClear(r);
  }
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
              fetch("https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/CountyPolygons.json")
                .then(res => res.json())
                .then(data => {
                  countyPolygons = data;
                  console.log("County polygons loaded:", countyPolygons);
                })
                .catch(err => console.error("Failed to load county polygons:", err));

              // Load state polygons, for Connections mode
              fetch("https://raw.githubusercontent.com/DocFlash81/cc-data/refs/heads/main/StatePolygons.json")
                .then(res => res.json())
                .then(data => {
                  window.statePolygons = data;
                  console.log("State polygons loaded:", statePolygons);
                })
                .catch(err => console.error("Failed to load state polygons:", err));


              // Initialize map
              initMap();

              // Build route buckets once
              const allRouteIds = routeInfo.map(r => r.Route);
              const { buckets } = buildGroupedRoutes(allRouteIds);
              window.routeBuckets = buckets;

              // One-time listeners
              document.getElementById("routeGroupSelect")
                .addEventListener("change", () => populateRouteDropdown(routeBuckets));

              document.getElementById("routeSelect")
                .addEventListener("change", () => {
                  loadRoute();
                  const mapEl = document.getElementById("mapPanel");
                  if (mapEl && currentMode === "county") {
                    mapEl.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                });

              window.addEventListener("resize", () => {
                if (leafletMap) leafletMap.invalidateSize();
              });

              setupRouteDetailControls(); // wire RD buttons/checkboxes

              // Default into Route Detail mode
              setMode("route");
            }
          );
        }
      );
    }
  );
});