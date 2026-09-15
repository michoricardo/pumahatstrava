(async () => {
  // Run this in browser console while logged into Strava on strava.com
  // Focus: UI-driven extraction (no public API tokens)

  const maxActivities = Number(prompt("How many activities to inspect? (e.g. 60)", "60")) || 60;
  const perPage = 20;
  const maxPages = Math.ceil(maxActivities / perPage) + 2;
  const minDelayMs = Number(prompt("Min delay between requests (ms)", "900")) || 900;
  const maxDelayMs = Number(prompt("Max delay between requests (ms)", "1800")) || 1800;
  const maxRetries = Number(prompt("Max retries on 429/5xx", "2")) || 2;
  const athleteIdInput = (prompt("Athlete ID (number) or 'me'", "me") || "me").trim();
  const intervalYear = Number(prompt("Interval year (YYYY), optional", "")) || null;
  const intervalStartWeek = Number(prompt("Start week (1-53), optional", "")) || null;
  const intervalWeeksToScan = Number(prompt("How many weeks to scan from start week?", "4")) || 0;
  const useGpxFallback = confirm("Use GPX fallback when page has no start/end coords?");
  const diagnostics = confirm("Enable diagnostics logs for collection troubleshooting?");

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const randomBetween = (min, max) => {
    const a = Math.max(0, Math.min(min, max));
    const b = Math.max(0, Math.max(min, max));
    return Math.floor(a + Math.random() * (b - a + 1));
  };

  async function waitRandomDelay() {
    await sleep(randomBetween(minDelayMs, maxDelayMs));
  }

  function isRetriableStatus(status) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  async function fetchWithRetry(url, extraHeaders) {
    let attempt = 0;

    while (true) {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          ...(extraHeaders || {}),
          "x-requested-with": "XMLHttpRequest"
        }
      });

      if (response.ok) return response;

      if (attempt >= maxRetries || !isRetriableStatus(response.status)) {
        throw new Error(`HTTP ${response.status} on ${url}`);
      }

      const backoff = randomBetween(1200, 2600) * (attempt + 1);
      debug(`retry ${attempt + 1}/${maxRetries} for ${url} after HTTP ${response.status}, wait ${backoff}ms`);
      await sleep(backoff);
      attempt += 1;
    }
  }
  const debug = (...args) => {
    if (diagnostics) console.log("[diag]", ...args);
  };

  async function fetchText(url) {
    const response = await fetchWithRetry(url);
    return response.text();
  }

  async function fetchJson(url) {
    const response = await fetchWithRetry(url, {
      "accept": "application/json, text/plain, */*"
    });
    return response.json();
  }

  function isValidCoord(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function toMapUrl(lat, lon) {
    return `https://www.google.com/maps?q=${lat},${lon}`;
  }

  function encodeMapPoint(lat, lon) {
    return `${lat},${lon}`;
  }

  function buildGoogleMapsDirectionsUrl(points) {
    if (!points.length) return "";
    if (points.length === 1) return toMapUrl(points[0].lat, points[0].lon);

    const origin = encodeURIComponent(encodeMapPoint(points[0].lat, points[0].lon));
    const destination = encodeURIComponent(encodeMapPoint(points[points.length - 1].lat, points[points.length - 1].lon));
    const waypoints = points
      .slice(1, -1)
      .map(point => encodeMapPoint(point.lat, point.lon))
      .join("|");

    const params = [
      "api=1",
      `origin=${origin}`,
      `destination=${destination}`
    ];

    if (waypoints) {
      params.push(`waypoints=${encodeURIComponent(waypoints)}`);
    }

    return `https://www.google.com/maps/dir/?${params.join("&")}`;
  }

  function buildGoogleMapsBatches(points, maxPointsPerMap = 10) {
    if (!points.length) return [];

    const batches = [];
    for (let i = 0; i < points.length; i += maxPointsPerMap) {
      const batchPoints = points.slice(i, i + maxPointsPerMap);
      batches.push({
        index: batches.length + 1,
        pointCount: batchPoints.length,
        url: buildGoogleMapsDirectionsUrl(batchPoints),
        points: batchPoints
      });
    }

    return batches;
  }

  function buildGoogleMapsHtml(title, batches) {
    const safeTitle = String(title || "Strava points");
    const sections = batches.map(batch => {
      const items = batch.points.map(point => {
        const label = `${point.type.toUpperCase()} · ${point.activityId || "n/a"} · ${point.lat}, ${point.lon}`;
        return `<li><a href="${toMapUrl(point.lat, point.lon)}" target="_blank" rel="noreferrer">${label}</a></li>`;
      }).join("\n");

      return `
        <section class="batch">
          <h2>Mapa ${batch.index}</h2>
          <p>${batch.pointCount} puntos</p>
          <p><a class="primary" href="${batch.url}" target="_blank" rel="noreferrer">Abrir en Google Maps</a></p>
          <ol>${items}</ol>
        </section>`;
    }).join("\n");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --ink: #1d1a16;
        --card: #fffaf3;
        --line: #d2c4af;
        --accent: #0a6b5d;
      }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: radial-gradient(circle at top, #fff8ee, var(--bg) 58%);
        color: var(--ink);
      }
      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      h1, h2 {
        margin: 0 0 12px;
      }
      .batch {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 20px;
        margin-top: 18px;
        box-shadow: 0 12px 30px rgba(76, 58, 34, 0.08);
      }
      .primary {
        display: inline-block;
        padding: 10px 14px;
        border-radius: 999px;
        background: var(--accent);
        color: #fff;
        text-decoration: none;
      }
      ol {
        padding-left: 20px;
      }
      li {
        margin: 8px 0;
      }
      a {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>Estos enlaces agrupan puntos de inicio y fin extraidos desde Strava. Si Google Maps no logra renderizar todos los puntos en un solo enlace, usa los mapas por lote.</p>
      ${sections}
    </main>
  </body>
</html>`;
  }

  function summarizeCoordinates(rows) {
    const points = [];
    let startCount = 0;
    let endCount = 0;

    for (const row of rows) {
      if (isValidCoord(row.startLat, row.startLon)) {
        startCount += 1;
        points.push({ lat: row.startLat, lon: row.startLon, activityId: row.activityId, type: "start" });
      }
      if (isValidCoord(row.endLat, row.endLon)) {
        endCount += 1;
        points.push({ lat: row.endLat, lon: row.endLon, activityId: row.activityId, type: "end" });
      }
    }

    if (!points.length) {
      return {
        totalRows: rows.length,
        startsWithCoords: startCount,
        endsWithCoords: endCount,
        totalPoints: 0,
        bbox: null,
        sample: [],
        googleMaps: []
      };
    }

    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.lon);

    const googleMaps = buildGoogleMapsBatches(points);

    return {
      totalRows: rows.length,
      startsWithCoords: startCount,
      endsWithCoords: endCount,
      totalPoints: points.length,
      bbox: {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons)
      },
      sample: points.slice(0, 8).map(p => ({
        activityId: p.activityId,
        type: p.type,
        lat: p.lat,
        lon: p.lon,
        map: toMapUrl(p.lat, p.lon)
      })),
      googleMaps: googleMaps.map(batch => ({
        mapIndex: batch.index,
        pointCount: batch.pointCount,
        url: batch.url
      }))
    };
  }

  function normalizeAthleteId(input) {
    const cleaned = String(input || "").trim().toLowerCase();
    if (cleaned === "me") return "me";
    if (/^\d+$/.test(cleaned)) return cleaned;
    return "me";
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function buildYearWeek(year, week) {
    return `${year}${pad2(week)}`;
  }

  function buildWeekSequence(year, startWeek, count) {
    if (!year || !startWeek || count <= 0) return [];

    const weeks = [];
    let y = year;
    let w = startWeek;
    for (let i = 0; i < count; i++) {
      if (w > 53) {
        y += 1;
        w = 1;
      }
      weeks.push(buildYearWeek(y, w));
      w += 1;
    }

    return weeks;
  }

  function addUniqueIds(target, ids) {
    for (const id of ids) {
      if (!target.includes(id)) target.push(id);
    }
  }

  function parseActivityIdsFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(doc.querySelectorAll('a[href^="/activities/"]'));

    const ids = new Set();
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      const match = href.match(/\/activities\/(\d+)/);
      if (match) {
        ids.add(match[1]);
      }
    }

    return [...ids];
  }

  function parseActivityIdsFromText(text) {
    const ids = new Set();

    const hrefMatches = text.match(/\/activities\/(\d{6,})/g) || [];
    for (const m of hrefMatches) {
      const idMatch = m.match(/(\d{6,})/);
      if (idMatch) ids.add(idMatch[1]);
    }

    const jsonIdMatches = text.match(/\"id\"\s*:\s*(\d{6,})/g) || [];
    for (const m of jsonIdMatches) {
      const idMatch = m.match(/(\d{6,})/);
      if (idMatch) ids.add(idMatch[1]);
    }

    return [...ids];
  }

  function parseActivityIdsFromJson(payload) {
    const ids = new Set();

    function walk(node) {
      if (!node || typeof node !== "object") return;

      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }

      const idCandidate = node.id || node.activity_id || node.activityId;
      if (typeof idCandidate === "number" || typeof idCandidate === "string") {
        const idText = String(idCandidate);
        if (/^\d{6,}$/.test(idText)) ids.add(idText);
      }

      for (const value of Object.values(node)) walk(value);
    }

    walk(payload);
    return [...ids];
  }

  function extractJsonFieldPair(html, fieldName) {
    // Matches e.g. "start_latlng":[19.43,-99.13] or null
    const regex = new RegExp(`\\"${fieldName}\\":(\\[[^\\]]+\\]|null)`);
    const match = html.match(regex);
    if (!match || match[1] === "null") return null;

    try {
      const arr = JSON.parse(match[1]);
      if (Array.isArray(arr) && arr.length >= 2) {
        return { lat: Number(arr[0]), lon: Number(arr[1]) };
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function extractBasicMeta(html) {
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "unknown";

    const dateMatch = html.match(/\\"start_date_local\\":\\"([^\\"]+)\\"/);
    const startDateLocal = dateMatch ? dateMatch[1] : "";

    return { title, startDateLocal };
  }

  function extractExportGpxPath(html) {
    const match = html.match(/href=\"(\/activities\/\d+\/export_gpx)\"/i);
    return match ? match[1] : null;
  }

  function parseGpxFirstLastPoints(gpxText) {
    const xml = new DOMParser().parseFromString(gpxText, "application/xml");
    const points = Array.from(xml.querySelectorAll("trkpt"));
    if (!points.length) return { start: null, end: null };

    const first = points[0];
    const last = points[points.length - 1];

    const start = {
      lat: Number(first.getAttribute("lat")),
      lon: Number(first.getAttribute("lon"))
    };

    const end = {
      lat: Number(last.getAttribute("lat")),
      lon: Number(last.getAttribute("lon"))
    };

    if (!Number.isFinite(start.lat) || !Number.isFinite(start.lon)) return { start: null, end: null };
    if (!Number.isFinite(end.lat) || !Number.isFinite(end.lon)) return { start: null, end: null };

    return { start, end };
  }

  async function gpxFallback(activityId, activityHtml) {
    try {
      const exportPath = activityHtml ? extractExportGpxPath(activityHtml) : null;
      const gpxUrl = exportPath
        ? `https://www.strava.com${exportPath}`
        : `https://www.strava.com/activities/${activityId}/export_gpx`;
      const gpxText = await fetchText(gpxUrl);
      const parsed = parseGpxFirstLastPoints(gpxText);
      return parsed;
    } catch (error) {
      return { start: null, end: null };
    }
  }

  async function collectActivityIdsFromPageHtml(url) {
    const html = await fetchText(url);
    const ids = [
      ...parseActivityIdsFromHtml(html),
      ...parseActivityIdsFromText(html)
    ];

    return [...new Set(ids)];
  }

  async function collectActivityIdsFromApi(url) {
    const payload = await fetchJson(url);
    return parseActivityIdsFromJson(payload);
  }

  async function collectActivityIds() {
    const ids = [];
    const sourceStats = {};
    const athleteId = normalizeAthleteId(athleteIdInput);
    const yearWeeks = buildWeekSequence(intervalYear, intervalStartWeek, intervalWeeksToScan);

    function markSource(source, count) {
      sourceStats[source] = (sourceStats[source] || 0) + count;
    }

    // Seed from current page to make the script work even if endpoints change.
    const seedIds = [
      ...parseActivityIdsFromHtml(document.documentElement.outerHTML),
      ...parseActivityIdsFromText(document.documentElement.outerHTML)
    ];
    addUniqueIds(ids, [...new Set(seedIds)]);
    markSource("current_page_seed", seedIds.length);
    debug("current page seed IDs:", seedIds.length);

    if (athleteId !== "me") {
      debug("Using athlete ID:", athleteId);
    }

    if (yearWeeks.length) {
      debug("Interval weeks to scan:", yearWeeks);
      for (const yearWeek of yearWeeks) {
        const intervalUrls = [
          `https://www.strava.com/athletes/${athleteId}?interval=${yearWeek}&interval_type=week&chart_type=miles&year_offset=0`,
          `https://www.strava.com/athletes/${athleteId}?interval=${yearWeek}&interval_type=week`,
          `https://www.strava.com/athletes/${athleteId}`
        ];

        for (const url of intervalUrls) {
          try {
            const weekIds = await collectActivityIdsFromPageHtml(url);
            const before = ids.length;
            addUniqueIds(ids, weekIds);
            const added = ids.length - before;
            markSource("athlete_interval_profile_html", added);
            debug(`interval ${yearWeek} from ${url} -> parsed=${weekIds.length}, added=${added}`);
            if (ids.length >= maxActivities) break;
          } catch (error) {
            debug(`interval ${yearWeek} request failed: ${error.message}`);
          }

          await sleep(350);
        }

        if (ids.length >= maxActivities) break;
      }
    }

    // Strategy list tries UI pages first, then JSON endpoint style routes.
    const routeFactories = [
      {
        source: "training_activities_html",
        build: page => `https://www.strava.com/athlete/training_activities?page=${page}&per_page=${perPage}`,
        mode: "html"
      },
      {
        source: "athlete_profile_html",
        build: page => `https://www.strava.com/athletes/${athleteId}?page=${page}`,
        mode: "html"
      },
      {
        source: "dashboard_html",
        build: page => `https://www.strava.com/dashboard?feed_type=my_activity&page=${page}`,
        mode: "html"
      },
      {
        source: "athlete_training_html",
        build: page => `https://www.strava.com/athlete/training?page=${page}`,
        mode: "html"
      },
      {
        source: "activities_api_json",
        build: page => `https://www.strava.com/activities?athlete_id=me&page=${page}&per_page=${perPage}`,
        mode: "json"
      }
    ];

    for (let page = 1; page <= maxPages; page++) {
      let pageFoundAny = false;

      for (const route of routeFactories) {
        const url = route.build(page);
        console.log(`[collect] page ${page} via ${route.source}: ${url}`);

        try {
          const pageIds = route.mode === "json"
            ? await collectActivityIdsFromApi(url)
            : await collectActivityIdsFromPageHtml(url);

          const before = ids.length;
          addUniqueIds(ids, pageIds);
          const added = ids.length - before;

          if (pageIds.length > 0) pageFoundAny = true;
          markSource(route.source, added);
          debug(`${route.source} page ${page}: parsed=${pageIds.length}, added=${added}`);

          if (ids.length >= maxActivities) break;
        } catch (error) {
          debug(`${route.source} page ${page} failed: ${error.message}`);
        }
      }

      console.log(`[collect] page ${page} summary: total IDs ${ids.length}`);

      if (ids.length >= maxActivities) break;
      if (!pageFoundAny && page > 1) {
        console.log(`[collect] no IDs found on page ${page} across all sources, stopping`);
        break;
      }

      await waitRandomDelay();
    }

    console.log("[collect] source stats:", sourceStats);

    if (ids.length === 0) {
      console.warn("[collect] 0 activity IDs found. Open your own Training page first, then run again.");
      console.warn("[collect] Suggested page: https://www.strava.com/athlete/training");
    }

    return ids.slice(0, maxActivities);
  }

  async function extractPointsForActivity(activityId) {
    const activityUrl = `https://www.strava.com/activities/${activityId}`;

    try {
      const html = await fetchText(activityUrl);

      let start = extractJsonFieldPair(html, "start_latlng");
      let end = extractJsonFieldPair(html, "end_latlng");
      let source = "activity_page";

      const meta = extractBasicMeta(html);

      if ((!start || !end) && useGpxFallback) {
        const fromGpx = await gpxFallback(activityId, html);
        if (!start && fromGpx.start) start = fromGpx.start;
        if (!end && fromGpx.end) end = fromGpx.end;
        if (fromGpx.start || fromGpx.end) source = "activity_page+gpx";
      }

      if (start && !isValidCoord(start.lat, start.lon)) start = null;
      if (end && !isValidCoord(end.lat, end.lon)) end = null;

      const startMapUrl = start ? toMapUrl(start.lat, start.lon) : "";
      const endMapUrl = end ? toMapUrl(end.lat, end.lon) : "";

      return {
        activityId,
        title: meta.title,
        startDateLocal: meta.startDateLocal,
        startLat: start ? start.lat : null,
        startLon: start ? start.lon : null,
        endLat: end ? end.lat : null,
        endLon: end ? end.lon : null,
        startMapUrl,
        endMapUrl,
        source,
        ok: !!(start || end)
      };
    } catch (error) {
      return {
        activityId,
        title: "",
        startDateLocal: "",
        startLat: null,
        startLon: null,
        endLat: null,
        endLon: null,
        startMapUrl: "",
        endMapUrl: "",
        source: "error",
        ok: false,
        error: error.message
      };
    }
  }

  function toCsv(rows) {
    const headers = [
      "activityId",
      "title",
      "startDateLocal",
      "startLat",
      "startLon",
      "endLat",
      "endLon",
      "startMapUrl",
      "endMapUrl",
      "source",
      "ok"
    ];

    const esc = value => {
      const str = value == null ? "" : String(value);
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map(h => esc(row[h])).join(","));
    }

    return lines.join("\n");
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildPointGeoJson(rows) {
    const features = [];

    for (const row of rows) {
      if (Number.isFinite(row.startLat) && Number.isFinite(row.startLon)) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [row.startLon, row.startLat] },
          properties: {
            activityId: row.activityId,
            pointType: "start",
            startDateLocal: row.startDateLocal,
            title: row.title
          }
        });
      }

      if (Number.isFinite(row.endLat) && Number.isFinite(row.endLon)) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [row.endLon, row.endLat] },
          properties: {
            activityId: row.activityId,
            pointType: "end",
            startDateLocal: row.startDateLocal,
            title: row.title
          }
        });
      }
    }

    return {
      type: "FeatureCollection",
      features
    };
  }

  function buildMapPoints(rows) {
    const points = [];

    for (const row of rows) {
      if (Number.isFinite(row.startLat) && Number.isFinite(row.startLon)) {
        points.push({
          lat: row.startLat,
          lon: row.startLon,
          activityId: row.activityId,
          type: "start"
        });
      }

      if (Number.isFinite(row.endLat) && Number.isFinite(row.endLon)) {
        points.push({
          lat: row.endLat,
          lon: row.endLon,
          activityId: row.activityId,
          type: "end"
        });
      }
    }

    return points;
  }

  console.log("[loop] collect -> extract -> validate -> export");
  const activityIds = await collectActivityIds();
  console.log(`[collect] total activity IDs: ${activityIds.length}`);

  if (activityIds.length === 0) {
    console.warn("[stop] No activity IDs collected. Nothing to export.");
    return;
  }

  const results = [];
  for (let i = 0; i < activityIds.length; i++) {
    const id = activityIds[i];
    console.log(`[extract] ${i + 1}/${activityIds.length} activity ${id}`);
    const row = await extractPointsForActivity(id);
    results.push(row);
    await waitRandomDelay();
  }

  const okRows = results.filter(r => r.ok);
  const badRows = results.filter(r => !r.ok);

  console.table(okRows);
  if (badRows.length) {
    console.warn("Rows without coordinates:", badRows.length);
    console.table(badRows);
  }

  const coordSummary = summarizeCoordinates(results);
  console.log("[quality] Coordinate summary:", coordSummary);
  if (coordSummary.sample.length) {
    console.table(coordSummary.sample);
  }
  if (coordSummary.googleMaps.length) {
    console.log("[maps] Google Maps batch URLs:", coordSummary.googleMaps);
    console.table(coordSummary.googleMaps);
  }

  const csv = toCsv(results);
  const geojson = JSON.stringify(buildPointGeoJson(okRows), null, 2);
  const mapPoints = buildMapPoints(okRows);
  const googleMapsBatches = buildGoogleMapsBatches(mapPoints);
  const googleMapsHtml = buildGoogleMapsHtml("Strava start/end points", googleMapsBatches);

  downloadText("strava_activity_points.csv", csv, "text/csv");
  downloadText("strava_activity_points.geojson", geojson, "application/geo+json");
  if (googleMapsBatches.length) {
    downloadText("strava_activity_points_google_maps.html", googleMapsHtml, "text/html");
  }

  console.log("[done] Exported strava_activity_points.csv and strava_activity_points.geojson");
  if (googleMapsBatches.length) {
    console.log("[done] Exported strava_activity_points_google_maps.html");
    console.log("[done] Open the downloaded HTML and use the Google Maps links to inspect starts and ends in grouped maps.");
  }
})();
