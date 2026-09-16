(async () => {
  const athleteId = (prompt("Athlete ID (number)", "10419453") || "").trim();
  const intervalYear = Number(prompt("Interval year (YYYY)", "2026")) || new Date().getFullYear();
  const intervalStartWeek = Number(prompt("Start week (1-53)", "15")) || 1;
  const intervalWeeksToScan = Number(prompt("How many weeks to scan from start week?", "1")) || 1;
  const maxActivities = Number(prompt("How many matching activities to inspect?", "10")) || 10;
  const minDelayMs = Number(prompt("Min delay between requests (ms)", "1500")) || 1500;
  const maxDelayMs = Number(prompt("Max delay between requests (ms)", "2600")) || 2600;
  const maxRetries = Number(prompt("Max retries on 429/5xx", "1")) || 1;
  const useGpxFallback = confirm("Use GPX fallback when page has no start/end coords?");
  const gpxDelayMs = Number(prompt("Delay before each GPX request (ms)", "4000")) || 4000;
  const diagnostics = confirm("Enable diagnostics logs?");

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let gpxRateLimited = false;

  function debug(...args) {
    if (diagnostics) console.log("[diag]", ...args);
  }

  function fail(message) {
    console.error(message);
    alert(message);
  }

  console.log("[start] Strava weekly activity extractor started");
  console.log("[start] current location:", window.location.href);
  console.log("[start] inputs:", {
    athleteId,
    intervalYear,
    intervalStartWeek,
    intervalWeeksToScan,
    maxActivities,
    minDelayMs,
    maxDelayMs,
    maxRetries,
    useGpxFallback,
    gpxDelayMs,
    diagnostics
  });

  if (!/^\d+$/.test(athleteId)) {
    fail("Athlete ID must be numeric.");
    return;
  }

  if (!Number.isInteger(intervalStartWeek) || intervalStartWeek < 1 || intervalStartWeek > 53) {
    fail("Invalid start week. Use a number between 1 and 53.");
    return;
  }

  if (!Number.isInteger(intervalWeeksToScan) || intervalWeeksToScan < 1) {
    fail("Invalid weeks to scan. Use a positive number.");
    return;
  }

  function randomBetween(min, max) {
    const low = Math.max(0, Math.min(min, max));
    const high = Math.max(0, Math.max(min, max));
    return Math.floor(low + Math.random() * (high - low + 1));
  }

  async function waitRandomDelay() {
    await sleep(randomBetween(minDelayMs, maxDelayMs));
  }

  function isRetriableStatus(status) {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  async function fetchWithRetry(url) {
    let attempt = 0;

    while (true) {
      const response = await fetch(url, {
        credentials: "include"
      });

      if (response.ok) return response;

      if (attempt >= maxRetries || !isRetriableStatus(response.status)) {
        throw new Error(`HTTP ${response.status} on ${url}`);
      }

      const backoff = randomBetween(1800, 3200) * (attempt + 1);
      debug(`retry ${attempt + 1}/${maxRetries} for ${url} after HTTP ${response.status}, waiting ${backoff}ms`);
      await sleep(backoff);
      attempt += 1;
    }
  }

  async function fetchText(url) {
    const response = await fetchWithRetry(url);
    return response.text();
  }

  function normalizePath(path) {
    const text = String(path || "").trim();
    return text.replace(/\/+$/, "") || "/";
  }

  function ensureCorrectPageContext(targetAthleteId) {
    const currentPath = normalizePath(window.location.pathname);
    const expectedPath = `/athletes/${targetAthleteId}`;

    if (currentPath !== expectedPath) {
      fail(`Open ${window.location.origin}${expectedPath} and run the script again.`);
      return false;
    }

    return true;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function buildYearWeek(year, week) {
    return `${year}${pad2(week)}`;
  }

  function buildWeekSequence(year, startWeek, count) {
    const weeks = [];
    let currentYear = year;
    let currentWeek = startWeek;

    for (let index = 0; index < count; index++) {
      if (currentWeek > 53) {
        currentYear += 1;
        currentWeek = 1;
      }
      weeks.push(buildYearWeek(currentYear, currentWeek));
      currentWeek += 1;
    }

    return weeks;
  }

  function buildIntervalHash(yearWeek) {
    return `#interval?interval=${yearWeek}&interval_type=week&chart_type=miles&year_offset=0`;
  }

  function parseActivityDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    date.setHours(12, 0, 0, 0);
    return date;
  }

  function getIsoYearWeek(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;

    const normalized = new Date(date.getTime());
    normalized.setHours(12, 0, 0, 0);
    const day = (normalized.getDay() + 6) % 7;
    normalized.setDate(normalized.getDate() - day + 3);

    const isoYear = normalized.getFullYear();
    const firstThursday = new Date(isoYear, 0, 4);
    firstThursday.setHours(12, 0, 0, 0);
    const firstDay = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstDay + 3);

    const week = 1 + Math.round((normalized - firstThursday) / 604800000);
    return buildYearWeek(isoYear, week);
  }

  function isElementVisible(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function getContainerForActivityAnchor(anchor) {
    let node = anchor;

    for (let depth = 0; depth < 8 && node; depth++) {
      if (node.matches && node.matches("article, li, section, div, tr")) {
        const text = (node.textContent || "").trim();
        if (text.length > 0 && text.length < 5000) {
          return node;
        }
      }
      node = node.parentElement;
    }

    return anchor.parentElement || anchor;
  }

  function extractAthleteIdFromHref(href) {
    const match = String(href || "").match(/\/athletes\/(\d+)/);
    return match ? match[1] : "";
  }

  function getOwnerHintFromContainer(container) {
    if (!container || !container.querySelectorAll) return "";

    const athleteLinks = Array.from(container.querySelectorAll('a[href^="/athletes/"]'));
    for (const athleteLink of athleteLinks) {
      const ownerAthleteId = extractAthleteIdFromHref(athleteLink.getAttribute("href") || "");
      if (ownerAthleteId) return ownerAthleteId;
    }

    return "";
  }

  function getDateHintFromContainer(container) {
    if (!container || !container.querySelector) return "";

    const timeNode = container.querySelector("time[datetime]");
    return timeNode ? (timeNode.getAttribute("datetime") || "") : "";
  }

  function readWeeklyActivityCards(targetAthleteId) {
    const mapImages = Array.from(document.querySelectorAll('img[data-testid="map"]'));
    const cards = new Map();

    for (const image of mapImages) {
      const anchor = image.closest('a[href^="/activities/"]');
      if (!anchor || !isElementVisible(anchor)) continue;

      const href = anchor.getAttribute("href") || "";
      const match = href.match(/\/activities\/(\d+)/);
      if (!match) continue;

      const activityId = match[1];
      if (cards.has(activityId)) continue;

      const container = getContainerForActivityAnchor(anchor);
      if (!isElementVisible(container)) continue;

      const ownerHintAthleteId = getOwnerHintFromContainer(container);
      if (ownerHintAthleteId && ownerHintAthleteId !== targetAthleteId) continue;

      const dateHint = getDateHintFromContainer(container);
      const titleHint = (anchor.getAttribute("title") || anchor.textContent || image.getAttribute("alt") || "").trim();

      cards.set(activityId, {
        activityId,
        ownerHintAthleteId,
        dateHint,
        titleHint
      });
    }

    return [...cards.values()];
  }

  function buildCardSignature(cards) {
    return cards.map(card => `${card.activityId}:${card.dateHint || ""}:${card.ownerHintAthleteId || ""}`).join("|");
  }

  async function collectActivityCardsForWeek(yearWeek, targetAthleteId) {
    const targetHash = buildIntervalHash(yearWeek);
    const baselineCards = readWeeklyActivityCards(targetAthleteId);
    const baselineSignature = buildCardSignature(baselineCards);

    console.log(`[collect] week ${yearWeek}`);

    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }

    await sleep(Math.max(2500, minDelayMs));

    let lastSignature = "";
    let stableCount = 0;
    let bestCards = [];
    let bestWeekCards = [];
    const startedAt = Date.now();
    const maxWaitMs = 12000;

    while (Date.now() - startedAt < maxWaitMs) {
      const cards = readWeeklyActivityCards(targetAthleteId);
      const signature = buildCardSignature(cards);
      const weekCards = cards.filter(card => getIsoYearWeek(parseActivityDate(card.dateHint)) === yearWeek);

      if (cards.length > 0) bestCards = cards;
      if (weekCards.length > 0) bestWeekCards = weekCards;

      if (signature && signature === lastSignature) {
        stableCount += 1;
      } else {
        stableCount = 0;
        lastSignature = signature;
      }

      debug(`poll week=${yearWeek} cards=${cards.length} weekCards=${weekCards.length} stableCount=${stableCount} signatureChanged=${signature !== baselineSignature}`);

      if (stableCount >= 2 && signature && signature !== baselineSignature) {
        break;
      }

      await sleep(500);
    }

    const chosenCards = bestWeekCards.length > 0 ? bestWeekCards : bestCards;
    debug(`week ${yearWeek} cards:`, chosenCards);
    return chosenCards;
  }

  function extractJsonFieldPair(html, fieldName) {
    const patterns = [
      new RegExp(`\\"${fieldName}\\"\\s*:\\s*(\\[[^\\]]+\\]|null)`),
      new RegExp(`"${fieldName}"\\s*:\\s*(\\[[^\\]]+\\]|null)`),
      new RegExp(`${fieldName}\\s*:\\s*(\\[[^\\]]+\\]|null)`)
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match || match[1] === "null") continue;

      try {
        const pair = JSON.parse(match[1]);
        if (Array.isArray(pair) && pair.length >= 2) {
          const lat = Number(pair[0]);
          const lon = Number(pair[1]);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return { lat, lon, matchedField: fieldName };
          }
        }
      } catch (error) {
        debug(`failed parsing ${fieldName} with pattern ${pattern}: ${error.message}`);
      }
    }

    return null;
  }

  function extractCoordinateByScalarFields(html, latFieldName, lonFieldName) {
    const patterns = [
      new RegExp(`\\"${latFieldName}\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
      new RegExp(`\\"${lonFieldName}\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
      new RegExp(`"${latFieldName}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
      new RegExp(`"${lonFieldName}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)
    ];

    const latMatch = html.match(patterns[0]) || html.match(patterns[2]);
    const lonMatch = html.match(patterns[1]) || html.match(patterns[3]);
    if (!latMatch || !lonMatch) return null;

    const lat = Number(latMatch[1]);
    const lon = Number(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return { lat, lon, matchedField: `${latFieldName}/${lonFieldName}` };
  }

  function extractCoordinateCandidateSnippets(html) {
    const patterns = [
      /start_latlng[^\n\r]{0,180}/gi,
      /end_latlng[^\n\r]{0,180}/gi,
      /startLatlng[^\n\r]{0,180}/gi,
      /endLatlng[^\n\r]{0,180}/gi,
      /startLatitude[^\n\r]{0,180}/gi,
      /endLatitude[^\n\r]{0,180}/gi,
      /latlng[^\n\r]{0,180}/gi,
      /map[^\n\r]{0,180}/gi
    ];

    const snippets = [];
    for (const pattern of patterns) {
      const matches = html.match(pattern) || [];
      for (const match of matches.slice(0, 2)) {
        snippets.push(match);
      }
    }

    return [...new Set(snippets)].slice(0, 10);
  }

  function extractStartCoordinate(html) {
    const pairFields = [
      "start_latlng",
      "startLatlng",
      "start_lat_lng",
      "start_coords",
      "startCoords"
    ];

    for (const fieldName of pairFields) {
      const result = extractJsonFieldPair(html, fieldName);
      if (result) return result;
    }

    return extractCoordinateByScalarFields(html, "start_latitude", "start_longitude")
      || extractCoordinateByScalarFields(html, "startLatitude", "startLongitude");
  }

  function extractEndCoordinate(html) {
    const pairFields = [
      "end_latlng",
      "endLatlng",
      "end_lat_lng",
      "end_coords",
      "endCoords"
    ];

    for (const fieldName of pairFields) {
      const result = extractJsonFieldPair(html, fieldName);
      if (result) return result;
    }

    return extractCoordinateByScalarFields(html, "end_latitude", "end_longitude")
      || extractCoordinateByScalarFields(html, "endLatitude", "endLongitude");
  }

  function extractActivityMeta(html) {
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "unknown";
    const datePatterns = [
      /\\"start_date_local\\":\\"([^\\"]+)\\"/,
      /"start_date_local":"([^"]+)"/,
      /\\"startDateLocal\\":\\"([^\\"]+)\\"/,
      /"startDateLocal":"([^"]+)"/,
      /datetime=\"([^\"]+)\"/i
    ];
    const athletePatterns = [
      /\\"athlete\\"\s*:\s*\{[^}]*\\"id\\"\s*:\s*(\d+)/i,
      /"athlete"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/i,
      /\\"athlete_id\\":(\d+)/i,
      /"athlete_id":(\d+)/i,
      /rel=\"author\"[^>]*href=\"\/athletes\/(\d+)\"/i,
      /href=\"\/athletes\/(\d+)\"/i
    ];

    let startDateLocal = "";
    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        startDateLocal = match[1];
        break;
      }
    }

    let ownerAthleteId = "";
    for (const pattern of athletePatterns) {
      const match = html.match(pattern);
      if (match) {
        ownerAthleteId = match[1];
        break;
      }
    }

    return { title, startDateLocal, ownerAthleteId };
  }

  function extractExportGpxPath(html) {
    const match = html.match(/href=\"(\/activities\/\d+\/export_gpx)\"/i);
    return match ? match[1] : null;
  }

  function isValidCoord(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function toMapUrl(lat, lon) {
    return `https://www.google.com/maps?q=${lat},${lon}`;
  }

  function parseGpxFirstLastPoints(gpxText) {
    const xml = new DOMParser().parseFromString(gpxText, "application/xml");
    const points = Array.from(xml.querySelectorAll("trkpt"));
    if (!points.length) return { start: null, end: null };

    const first = points[0];
    const last = points[points.length - 1];
    const start = { lat: Number(first.getAttribute("lat")), lon: Number(first.getAttribute("lon")) };
    const end = { lat: Number(last.getAttribute("lat")), lon: Number(last.getAttribute("lon")) };

    if (!isValidCoord(start.lat, start.lon)) return { start: null, end: null };
    if (!isValidCoord(end.lat, end.lon)) return { start: null, end: null };

    return { start, end };
  }

  async function gpxFallback(activityId, activityHtml) {
    if (gpxRateLimited) {
      debug(`gpx fallback skipped for ${activityId}: rate-limited earlier in this run`);
      return { start: null, end: null };
    }

    try {
      const exportPath = extractExportGpxPath(activityHtml);
      const gpxUrl = exportPath
        ? `${window.location.origin}${exportPath}`
        : `${window.location.origin}/activities/${activityId}/export_gpx`;
      const gpxText = await fetchText(gpxUrl);
      return parseGpxFirstLastPoints(gpxText);
    } catch (error) {
      if (String(error.message).includes("HTTP 429")) {
        gpxRateLimited = true;
      }
      debug(`gpx fallback failed for ${activityId}: ${error.message}`);
      return { start: null, end: null };
    }
  }

  async function extractPointsForActivity(activityId, targetAthleteId, collectedDateHint, collectedYearWeek, collectedOwnerHintAthleteId) {
    const activityUrl = `${window.location.origin}/activities/${activityId}`;

    try {
      const html = await fetchText(activityUrl);
      let start = extractStartCoordinate(html);
      let end = extractEndCoordinate(html);
      let source = "activity_page";
      const meta = extractActivityMeta(html);
      const ownerMatchFromPage = !!meta.ownerAthleteId && meta.ownerAthleteId === targetAthleteId;
      const ownerMatchFromCard = !!collectedOwnerHintAthleteId && collectedOwnerHintAthleteId === targetAthleteId;
      const ownerStatus = ownerMatchFromPage || ownerMatchFromCard
        ? "match"
        : meta.ownerAthleteId && collectedOwnerHintAthleteId && meta.ownerAthleteId !== targetAthleteId && collectedOwnerHintAthleteId !== targetAthleteId
          ? "mismatch"
          : "unknown";

      if (start && !isValidCoord(start.lat, start.lon)) start = null;
      if (end && !isValidCoord(end.lat, end.lon)) end = null;

      if (!start && !end) {
        const snippets = extractCoordinateCandidateSnippets(html);
        if (snippets.length) {
          debug(`no coordinates found in activity ${activityId}; candidate snippets:`, snippets);
        } else {
          debug(`no coordinates found in activity ${activityId}; no candidate coordinate snippets found`);
        }
      }

      const date = parseActivityDate(meta.startDateLocal || collectedDateHint);
      const effectiveYearWeek = date ? getIsoYearWeek(date) : (collectedYearWeek || "");

      return {
        activityId,
        title: meta.title,
        startDateLocal: meta.startDateLocal || collectedDateHint || "",
        ownerAthleteId: meta.ownerAthleteId,
        collectedOwnerHintAthleteId: collectedOwnerHintAthleteId || "",
        ownerStatus,
        ownerMatches: ownerStatus !== "mismatch",
        yearWeek: effectiveYearWeek,
        startLat: start ? start.lat : null,
        startLon: start ? start.lon : null,
        endLat: end ? end.lat : null,
        endLon: end ? end.lon : null,
        startMapUrl: start ? toMapUrl(start.lat, start.lon) : "",
        endMapUrl: end ? toMapUrl(end.lat, end.lon) : "",
        activityHtml: html,
        source,
        ok: !!(start || end)
      };
    } catch (error) {
      return {
        activityId,
        title: "",
        startDateLocal: collectedDateHint || "",
        ownerAthleteId: "",
        collectedOwnerHintAthleteId: collectedOwnerHintAthleteId || "",
        ownerStatus: collectedOwnerHintAthleteId === targetAthleteId ? "match" : "unknown",
        ownerMatches: collectedOwnerHintAthleteId === targetAthleteId || !collectedOwnerHintAthleteId,
        yearWeek: collectedYearWeek || "",
        startLat: null,
        startLon: null,
        endLat: null,
        endLon: null,
        startMapUrl: "",
        endMapUrl: "",
        activityHtml: "",
        source: "error",
        ok: false,
        error: error.message
      };
    }
  }

  async function enrichWithGpxIfNeeded(row) {
    if (!useGpxFallback || gpxRateLimited || row.ok || row.ownerStatus === "mismatch") {
      return row;
    }

    await sleep(gpxDelayMs);

    const gpxPoints = await gpxFallback(row.activityId, row.activityHtml || "");
    const start = row.startLat != null && row.startLon != null
      ? { lat: row.startLat, lon: row.startLon }
      : gpxPoints.start;
    const end = row.endLat != null && row.endLon != null
      ? { lat: row.endLat, lon: row.endLon }
      : gpxPoints.end;

    return {
      ...row,
      startLat: start ? start.lat : null,
      startLon: start ? start.lon : null,
      endLat: end ? end.lat : null,
      endLon: end ? end.lon : null,
      startMapUrl: start ? toMapUrl(start.lat, start.lon) : "",
      endMapUrl: end ? toMapUrl(end.lat, end.lon) : "",
      source: (gpxPoints.start || gpxPoints.end) ? "activity_page+gpx" : row.source,
      ok: !!(start || end)
    };
  }

  function encodeMapPoint(lat, lon) {
    return `${lat},${lon}`;
  }

  function buildGoogleMapsDirectionsUrl(points) {
    if (!points.length) return "";
    if (points.length === 1) return toMapUrl(points[0].lat, points[0].lon);

    const origin = encodeURIComponent(encodeMapPoint(points[0].lat, points[0].lon));
    const destination = encodeURIComponent(encodeMapPoint(points[points.length - 1].lat, points[points.length - 1].lon));
    const waypoints = points.slice(1, -1).map(point => encodeMapPoint(point.lat, point.lon)).join("|");
    const params = ["api=1", `origin=${origin}`, `destination=${destination}`];

    if (waypoints) params.push(`waypoints=${encodeURIComponent(waypoints)}`);

    return `https://www.google.com/maps/dir/?${params.join("&")}`;
  }

  function buildGoogleMapsBatches(points, maxPointsPerMap = 10) {
    const batches = [];

    for (let index = 0; index < points.length; index += maxPointsPerMap) {
      const batchPoints = points.slice(index, index + maxPointsPerMap);
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
        const label = `${point.type.toUpperCase()} · ${point.activityId} · ${point.lat}, ${point.lon}`;
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
      .batch {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 20px;
        margin-top: 18px;
      }
      .primary {
        display: inline-block;
        padding: 10px 14px;
        border-radius: 999px;
        background: var(--accent);
        color: #fff;
        text-decoration: none;
      }
      a {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>Enlaces agrupados de puntos de inicio y fin extraidos desde vistas semanales del atleta.</p>
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

    const lats = points.map(point => point.lat);
    const lons = points.map(point => point.lon);
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
      sample: points.slice(0, 8).map(point => ({
        activityId: point.activityId,
        type: point.type,
        lat: point.lat,
        lon: point.lon,
        map: toMapUrl(point.lat, point.lon)
      })),
      googleMaps: googleMaps.map(batch => ({
        mapIndex: batch.index,
        pointCount: batch.pointCount,
        url: batch.url
      }))
    };
  }

  function toCsv(rows) {
    const headers = [
      "activityId",
      "title",
      "startDateLocal",
      "yearWeek",
      "collectedYearWeek",
      "ownerAthleteId",
      "collectedOwnerHintAthleteId",
      "ownerStatus",
      "startLat",
      "startLon",
      "endLat",
      "endLon",
      "startMapUrl",
      "endMapUrl",
      "source",
      "ok"
    ];

    const escapeValue = value => {
      const text = value == null ? "" : String(value);
      if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    };

    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map(header => escapeValue(row[header])).join(","));
    }

    return lines.join("\n");
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function buildPointGeoJson(rows) {
    const features = [];

    for (const row of rows) {
      if (isValidCoord(row.startLat, row.startLon)) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [row.startLon, row.startLat] },
          properties: {
            activityId: row.activityId,
            pointType: "start",
            startDateLocal: row.startDateLocal,
            yearWeek: row.yearWeek,
            title: row.title
          }
        });
      }

      if (isValidCoord(row.endLat, row.endLon)) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [row.endLon, row.endLat] },
          properties: {
            activityId: row.activityId,
            pointType: "end",
            startDateLocal: row.startDateLocal,
            yearWeek: row.yearWeek,
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
      if (isValidCoord(row.startLat, row.startLon)) {
        points.push({ lat: row.startLat, lon: row.startLon, activityId: row.activityId, type: "start" });
      }
      if (isValidCoord(row.endLat, row.endLon)) {
        points.push({ lat: row.endLat, lon: row.endLon, activityId: row.activityId, type: "end" });
      }
    }

    return points;
  }

  if (!ensureCorrectPageContext(athleteId)) {
    return;
  }

  const targetWeeks = buildWeekSequence(intervalYear, intervalStartWeek, intervalWeeksToScan);
  const allowedWeeks = new Set(targetWeeks);
  const collectedCards = [];

  console.log("[collect] target weeks:", targetWeeks);

  for (const yearWeek of targetWeeks) {
    const weekCards = await collectActivityCardsForWeek(yearWeek, athleteId);
    const remainingSlots = maxActivities - collectedCards.length;
    const knownIds = new Set(collectedCards.map(card => card.activityId));
    const newCards = weekCards.filter(card => !knownIds.has(card.activityId)).slice(0, Math.max(0, remainingSlots));

    if (newCards.length === 0) {
      console.log(`[collect] no visible activities for week ${yearWeek}`);
    } else {
      collectedCards.push(...newCards.map(card => ({
        ...card,
        collectedYearWeek: yearWeek
      })));
      console.log(`[collect] week ${yearWeek}: ${newCards.length} activities (total ${collectedCards.length})`);
    }

    if (collectedCards.length >= maxActivities) break;
    await waitRandomDelay();
  }

  if (collectedCards.length === 0) {
    fail("[stop] No activities found in the requested weekly views.");
    return;
  }

  const results = [];

  for (let index = 0; index < collectedCards.length; index++) {
    const card = collectedCards[index];
    console.log(`[extract] ${index + 1}/${collectedCards.length} activity ${card.activityId}`);
    const baseRow = await extractPointsForActivity(
      card.activityId,
      athleteId,
      card.dateHint,
      card.collectedYearWeek,
      card.ownerHintAthleteId
    );

    const row = await enrichWithGpxIfNeeded(baseRow);

    if (!row.ownerMatches) {
      debug(`discarded activity ${card.activityId} due to owner mismatch: pageOwner=${row.ownerAthleteId || "unknown"}, cardOwner=${row.collectedOwnerHintAthleteId || "unknown"}, target=${athleteId}`);
    } else if (row.yearWeek && allowedWeeks.has(row.yearWeek)) {
      results.push({
        ...row,
        collectedYearWeek: card.collectedYearWeek
      });
    } else {
      debug(`discarded activity ${card.activityId} outside requested weeks: extracted=${row.yearWeek || "unknown"}, collected=${card.collectedYearWeek || "unknown"}`);
    }

    if (results.length >= maxActivities) {
      console.log(`[filter] Reached requested count of ${maxActivities} matching activities, stopping early.`);
      break;
    }

    await waitRandomDelay();
  }

  console.log(`[filter] kept ${results.length} activities in requested weeks`);

  if (results.length === 0) {
    fail("[stop] No extracted activities matched the requested weeks.");
    return;
  }

  const okRows = results.filter(row => row.ok);
  const badRows = results.filter(row => !row.ok);

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
    console.table(coordSummary.googleMaps);
  }

  const csv = toCsv(results);
  const exportRows = results.map(({ activityHtml, ...rest }) => rest);
  const geojson = JSON.stringify(buildPointGeoJson(okRows), null, 2);
  const mapPoints = buildMapPoints(okRows);
  const googleMapsBatches = buildGoogleMapsBatches(mapPoints);
  const googleMapsHtml = buildGoogleMapsHtml("Strava start/end points", googleMapsBatches);

  downloadText("strava_activity_points.csv", toCsv(exportRows), "text/csv");
  downloadText("strava_activity_points.geojson", geojson, "application/geo+json");
  if (googleMapsBatches.length) {
    downloadText("strava_activity_points_google_maps.html", googleMapsHtml, "text/html");
  }

  console.log("[done] Exported strava_activity_points.csv and strava_activity_points.geojson");
  if (googleMapsBatches.length) {
    console.log("[done] Exported strava_activity_points_google_maps.html");
  }
  alert(`[done] Finished. Matching activities kept: ${results.length}.`);
})();
