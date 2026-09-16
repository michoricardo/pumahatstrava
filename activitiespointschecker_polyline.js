(async () => {
  const athleteId = (prompt("Athlete ID (number)", "10419453") || "").trim();
  const intervalYear = Number(prompt("Interval year (YYYY)", "2026")) || new Date().getFullYear();
  const intervalStartWeek = Number(prompt("Start week (1-53)", "15")) || 1;
  const intervalWeeksToScan = Number(prompt("How many weeks to scan from start week?", "1")) || 1;
  const maxActivities = Number(prompt("How many matching activities to inspect?", "10")) || 10;
  const minDelayMs = Number(prompt("Min delay between activity requests (ms)", "1200")) || 1200;
  const maxDelayMs = Number(prompt("Max delay between activity requests (ms)", "2200")) || 2200;
  const diagnostics = confirm("Enable diagnostics logs?");

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function debug(...args) {
    if (diagnostics) console.log("[diag]", ...args);
  }

  function fail(message) {
    console.error(message);
    alert(message);
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
    return status === 500 || status === 502 || status === 503 || status === 504;
  }

  async function fetchWithRetry(url, maxRetries = 1) {
    let attempt = 0;

    while (true) {
      const response = await fetch(url, { credentials: "include" });

      if (response.ok) return response;

      if (response.status === 429) {
        throw new Error(`RATE_LIMIT HTTP 429 on ${url}`);
      }

      if (attempt >= maxRetries || !isRetriableStatus(response.status)) {
        throw new Error(`HTTP ${response.status} on ${url}`);
      }

      const backoff = randomBetween(1500, 3000) * (attempt + 1);
      debug(`retry ${attempt + 1}/${maxRetries} for ${url} after HTTP ${response.status}, waiting ${backoff}ms`);
      await sleep(backoff);
      attempt += 1;
    }
  }

  async function fetchText(url, maxRetries = 1) {
    const response = await fetchWithRetry(url, maxRetries);
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

      cards.set(activityId, {
        activityId,
        ownerHintAthleteId,
        dateHint: getDateHintFromContainer(container),
        titleHint: (anchor.getAttribute("title") || anchor.textContent || image.getAttribute("alt") || "").trim()
      });
    }

    return [...cards.values()];
  }

  function buildCardSignature(cards) {
    return cards.map(card => `${card.activityId}:${card.dateHint || ""}:${card.ownerHintAthleteId || ""}`).join("|");
  }

  async function collectActivityCardsForWeek(yearWeek, targetAthleteId) {
    const targetHash = buildIntervalHash(yearWeek);
    const baselineSignature = buildCardSignature(readWeeklyActivityCards(targetAthleteId));

    console.log(`[collect] week ${yearWeek}`);
    window.location.hash = targetHash;

    let lastSignature = baselineSignature;
    let lastCards = [];
    const deadline = Date.now() + 9000;

    while (Date.now() < deadline) {
      const cards = readWeeklyActivityCards(targetAthleteId);
      const signature = buildCardSignature(cards);
      lastCards = cards;

      if (cards.length > 0 && signature !== baselineSignature && signature !== lastSignature) {
        debug(`week ${yearWeek}: detected ${cards.length} cards`);
        return cards;
      }

      lastSignature = signature;
      await sleep(700);
    }

    debug(`week ${yearWeek}: returning ${lastCards.length} cards after timeout`);
    return lastCards;
  }

  function extractJsonFieldPair(html, fieldName) {
    const patterns = [
      new RegExp(`\\"${fieldName}\\"\\s*:\\s*\\[\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\]`),
      new RegExp(`"${fieldName}"\\s*:\\s*\\[\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\]`)
    ];

    for (const pattern of patterns) {
      try {
        const match = html.match(pattern);
        if (match) {
          const lat = Number(match[1]);
          const lon = Number(match[2]);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return { lat, lon, matchedField: fieldName };
          }
        }
      } catch (error) {
        debug(`failed parsing ${fieldName}: ${error.message}`);
      }
    }

    return null;
  }

  function extractCoordinateByScalarFields(html, latFieldName, lonFieldName) {
    const latPatterns = [
      new RegExp(`\\"${latFieldName}\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
      new RegExp(`"${latFieldName}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)
    ];
    const lonPatterns = [
      new RegExp(`\\"${lonFieldName}\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
      new RegExp(`"${lonFieldName}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`)
    ];

    const latMatch = latPatterns.map(pattern => html.match(pattern)).find(Boolean);
    const lonMatch = lonPatterns.map(pattern => html.match(pattern)).find(Boolean);
    if (!latMatch || !lonMatch) return null;

    const lat = Number(latMatch[1]);
    const lon = Number(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return { lat, lon, matchedField: `${latFieldName}/${lonFieldName}` };
  }

  function extractStartCoordinate(html) {
    const pairFields = ["start_latlng", "startLatlng", "start_lat_lng", "start_coords", "startCoords"];

    for (const fieldName of pairFields) {
      const result = extractJsonFieldPair(html, fieldName);
      if (result) return result;
    }

    return extractCoordinateByScalarFields(html, "start_latitude", "start_longitude")
      || extractCoordinateByScalarFields(html, "startLatitude", "startLongitude");
  }

  function extractEndCoordinate(html) {
    const pairFields = ["end_latlng", "endLatlng", "end_lat_lng", "end_coords", "endCoords"];

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
      /datetime="([^\"]+)"/i
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

  function extractPolylineCandidates(html) {
    const patterns = [
      /"polyline"\s*:\s*"([^"]+)"/gi,
      /\\"polyline\\"\s*:\s*\\"([^\\"]+)\\"/gi,
      /"summary_polyline"\s*:\s*"([^"]+)"/gi,
      /\\"summary_polyline\\"\s*:\s*\\"([^\\"]+)\\"/gi,
      /"map_polyline"\s*:\s*"([^"]+)"/gi,
      /\\"map_polyline\\"\s*:\s*\\"([^\\"]+)\\"/gi,
      /"encodedPolyline"\s*:\s*"([^"]+)"/gi,
      /\\"encodedPolyline\\"\s*:\s*\\"([^\\"]+)\\"/gi,
      /"points"\s*:\s*"([^"]+)"/gi,
      /"polylineEncoded"\s*:\s*"([^"]+)"/gi,
      /\\"polylineEncoded\\"\s*:\s*\\"([^\\"]+)\\"/gi,
      /"overview_polyline"\s*:\s*"([^"]+)"/gi,
      /\\"overview_polyline\\"\s*:\s*\\"([^\\"]+)\\"/gi
    ];

    const candidates = [];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        if (match[1]) candidates.push(match[1]);
        if (candidates.length >= 10) return candidates;
      }
    }

    if (!candidates.length) {
      const looseMatches = html.match(/[A-Za-z0-9_\\-]{20,}/g) || [];
      for (const token of looseMatches.slice(0, 200)) {
        if (/^[A-Za-z0-9_\\-]+$/.test(token) && token.length >= 40) {
          candidates.push(token);
        }
        if (candidates.length >= 10) break;
      }
    }

    return [...new Set(candidates)];
  }

  function decodePolyline(encoded) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lon = 0;

    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let byte = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);

      const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += deltaLat;

      result = 0;
      shift = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);

      const deltaLon = (result & 1) ? ~(result >> 1) : (result >> 1);
      lon += deltaLon;

      points.push({ lat: lat / 1e5, lon: lon / 1e5 });
    }

    return points;
  }

  function isValidCoord(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function toMapUrl(lat, lon) {
    return `https://www.google.com/maps?q=${lat},${lon}`;
  }

  function parseActivityPointsFromHtml(html) {
    let start = extractStartCoordinate(html);
    let end = extractEndCoordinate(html);
    let source = "activity_page";

    if (start && !isValidCoord(start.lat, start.lon)) start = null;
    if (end && !isValidCoord(end.lat, end.lon)) end = null;

    if (!start || !end) {
      const candidates = extractPolylineCandidates(html);
      debug(`polyline candidates found: ${candidates.length}`);
      if (!candidates.length) {
        debug("polyline probe snippet:", html.slice(0, 1200));
      }

      for (const candidate of candidates) {
        try {
          const points = decodePolyline(candidate);
          if (points.length >= 2) {
            debug(`polyline decoded with ${points.length} points`);
            start = start || points[0];
            end = end || points[points.length - 1];
            source = source === "activity_page" ? "activity_page+polyline" : source;
            break;
          }
        } catch (error) {
          debug(`polyline decode failed: ${error.message}`);
        }
      }
    }

    return { start, end, source };
  }

  async function extractPointsForActivity(activityId, targetAthleteId, collectedDateHint, collectedYearWeek, collectedOwnerHintAthleteId) {
    const activityUrl = `${window.location.origin}/activities/${activityId}`;

    try {
      const html = await fetchText(activityUrl, 1);
      const meta = extractActivityMeta(html);
      const points = parseActivityPointsFromHtml(html);
      const ownerMatchFromPage = !!meta.ownerAthleteId && meta.ownerAthleteId === targetAthleteId;
      const ownerMatchFromCard = !!collectedOwnerHintAthleteId && collectedOwnerHintAthleteId === targetAthleteId;
      const ownerStatus = ownerMatchFromPage || ownerMatchFromCard
        ? "match"
        : meta.ownerAthleteId && collectedOwnerHintAthleteId && meta.ownerAthleteId !== targetAthleteId && collectedOwnerHintAthleteId !== targetAthleteId
          ? "mismatch"
          : "unknown";

      const date = meta.startDateLocal || collectedDateHint || "";

      return {
        activityId,
        title: meta.title,
        startDateLocal: date,
        ownerAthleteId: meta.ownerAthleteId,
        collectedOwnerHintAthleteId: collectedOwnerHintAthleteId || "",
        ownerStatus,
        ownerMatches: ownerStatus !== "mismatch",
        yearWeek: collectedYearWeek || "",
        startLat: points.start ? points.start.lat : null,
        startLon: points.start ? points.start.lon : null,
        endLat: points.end ? points.end.lat : null,
        endLon: points.end ? points.end.lon : null,
        startMapUrl: points.start ? toMapUrl(points.start.lat, points.start.lon) : "",
        endMapUrl: points.end ? toMapUrl(points.end.lat, points.end.lon) : "",
        source: points.source,
        ok: !!(points.start || points.end),
        activityHtml: html
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
        source: error.message.includes("RATE_LIMIT") ? "rate_limited" : "error",
        ok: false,
        error: error.message,
        activityHtml: ""
      };
    }
  }

  function buildCsv(rows) {
    const header = [
      "activityId",
      "title",
      "startDateLocal",
      "yearWeek",
      "ownerAthleteId",
      "collectedOwnerHintAthleteId",
      "ownerStatus",
      "source",
      "startLat",
      "startLon",
      "endLat",
      "endLon",
      "startMapUrl",
      "endMapUrl",
      "ok",
      "error"
    ];

    const escapeCsv = value => {
      const text = String(value ?? "");
      if (/^\d{8,}$/.test(text)) return `\t${text}`;
      if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    };

    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push([
        row.activityId,
        row.title,
        row.startDateLocal,
        row.yearWeek,
        row.ownerAthleteId,
        row.collectedOwnerHintAthleteId,
        row.ownerStatus,
        row.source,
        row.startLat,
        row.startLon,
        row.endLat,
        row.endLon,
        row.startMapUrl,
        row.endMapUrl,
        row.ok,
        row.error || ""
      ].map(escapeCsv).join(","));
    }

    return lines.join("\n");
  }

  function buildGeoJson(rows) {
    return {
      type: "FeatureCollection",
      features: rows.flatMap(row => {
        const features = [];

        if (isValidCoord(row.startLat, row.startLon)) {
          features.push({
            type: "Feature",
            properties: {
              activityId: row.activityId,
              title: row.title,
              kind: "start",
              source: row.source,
              yearWeek: row.yearWeek,
              ownerAthleteId: row.ownerAthleteId
            },
            geometry: {
              type: "Point",
              coordinates: [row.startLon, row.startLat]
            }
          });
        }

        if (isValidCoord(row.endLat, row.endLon)) {
          features.push({
            type: "Feature",
            properties: {
              activityId: row.activityId,
              title: row.title,
              kind: "end",
              source: row.source,
              yearWeek: row.yearWeek,
              ownerAthleteId: row.ownerAthleteId
            },
            geometry: {
              type: "Point",
              coordinates: [row.endLon, row.endLat]
            }
          });
        }

        return features;
      })
    };
  }

  function buildMapExportHtml(rows) {
    const points = rows.flatMap(row => {
      const features = [];

      if (isValidCoord(row.startLat, row.startLon)) {
        features.push({
          type: "start",
          activityId: row.activityId,
          title: row.title,
          lat: row.startLat,
          lon: row.startLon,
          color: "#2563eb"
        });
      }

      if (isValidCoord(row.endLat, row.endLon)) {
        features.push({
          type: "end",
          activityId: row.activityId,
          title: row.title,
          lat: row.endLat,
          lon: row.endLon,
          color: "#ef4444"
        });
      }

      return features;
    });

    const lines = rows
      .filter(row => isValidCoord(row.startLat, row.startLon) && isValidCoord(row.endLat, row.endLon))
      .map(row => ({
        activityId: row.activityId,
        title: row.title,
        points: [
          [row.startLat, row.startLon],
          [row.endLat, row.endLon]
        ]
      }));

    const safePointsJson = JSON.stringify(points);
    const safeLinesJson = JSON.stringify(lines);
    const safeTitle = "Strava activity map export";

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body { height: 100%; margin: 0; }
      body { font-family: Inter, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
      header { padding: 14px 18px; background: #111827; border-bottom: 1px solid #334155; }
      h1 { font-size: 16px; margin: 0 0 6px; }
      p { margin: 0; font-size: 13px; color: #94a3b8; }
      #map { height: calc(100vh - 74px); width: 100%; }
      .legend {
        position: absolute; top: 90px; right: 14px; z-index: 1000;
        background: rgba(15,23,42,.92); border: 1px solid #334155; border-radius: 12px;
        padding: 10px 12px; font-size: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.35);
      }
      .dot { display:inline-block; width:10px; height:10px; border-radius:999px; margin-right:6px; }
      .row { display:flex; align-items:center; gap:6px; margin:4px 0; }
    </style>
  </head>
  <body>
    <header>
      <h1>${safeTitle}</h1>
      <p>Puntos de inicio y fin exportados desde Strava.</p>
    </header>
    <div id="map"></div>
    <div class="legend">
      <div class="row"><span class="dot" style="background:#2563eb"></span>Inicio</div>
      <div class="row"><span class="dot" style="background:#ef4444"></span>Fin</div>
    </div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const points = ${safePointsJson};
      const lines = ${safeLinesJson};
      const map = L.map('map');
      const bounds = [];

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      points.forEach(point => {
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: 6,
          color: point.color,
          fillColor: point.color,
          fillOpacity: 0.9,
          weight: 2
        }).addTo(map);

        marker.bindPopup('Activity ' + point.activityId + '<br>' + point.type.toUpperCase() + '<br>' + (point.title || '') + '<br>' + point.lat + ', ' + point.lon);
        bounds.push([point.lat, point.lon]);
      });

      lines.forEach(line => {
        const polyline = L.polyline(line.points, { color: '#f59e0b', weight: 2, opacity: 0.7 }).addTo(map);
        bounds.push(...line.points);
        polyline.bindPopup('Activity ' + line.activityId + '<br>' + (line.title || ''));
      });

      if (bounds.length) {
        map.fitBounds(bounds, { padding: [24, 24] });
      } else {
        map.setView([25.6866, -100.3161], 10);
      }
    </script>
  </body>
</html>`;
  }

  function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        sample: []
      };
    }

    const lats = points.map(point => point.lat);
    const lons = points.map(point => point.lon);

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
      }))
    };
  }

  if (!/^[0-9]+$/.test(athleteId)) {
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

  if (!ensureCorrectPageContext(athleteId)) {
    return;
  }

  const targetWeeks = buildWeekSequence(intervalYear, intervalStartWeek, intervalWeeksToScan);
  const collectedCards = [];
  const seenActivityIds = new Set();

  console.log("[start] Strava polyline activity extractor started");
  console.log("[start] current location:", window.location.href);
  console.log("[start] target weeks:", targetWeeks);
  console.log("[start] inputs:", { athleteId, intervalYear, intervalStartWeek, intervalWeeksToScan, maxActivities, minDelayMs, maxDelayMs, diagnostics });
  console.log("[note] this script uses activity-page HTML and polyline hints; it stops on 429 instead of trying to evade rate limits.");

  for (const yearWeek of targetWeeks) {
    if (collectedCards.length >= maxActivities) break;

    const cards = await collectActivityCardsForWeek(yearWeek, athleteId);
    console.log(`[collect] week ${yearWeek}: ${cards.length} activities`);

    for (const card of cards) {
      if (collectedCards.length >= maxActivities) break;
      if (seenActivityIds.has(card.activityId)) continue;

      seenActivityIds.add(card.activityId);
      collectedCards.push({ ...card, yearWeek });
    }

    await waitRandomDelay();
  }

  if (!collectedCards.length) {
    console.log("[done] no matching activities found.");
    return;
  }

  const rows = [];
  let rateLimited = false;

  for (const card of collectedCards) {
    await waitRandomDelay();

    const row = await extractPointsForActivity(
      card.activityId,
      athleteId,
      card.dateHint || "",
      card.yearWeek || "",
      card.ownerHintAthleteId || ""
    );

    rows.push(row);

    if (row.source === "rate_limited" || String(row.error || "").includes("RATE_LIMIT")) {
      rateLimited = true;
      console.warn(`[rate-limit] stopped after activity ${card.activityId}`);
      break;
    }
  }

  const summary = summarizeCoordinates(rows);
  const csv = buildCsv(rows);
  const geojson = JSON.stringify(buildGeoJson(rows), null, 2);
  const mapHtml = buildMapExportHtml(rows);

  console.log("[done] rows:", rows);
  console.log("[done] summary:", summary);

  downloadTextFile("strava_activity_points_polyline.csv", csv, "text/csv;charset=utf-8");
  downloadTextFile("strava_activity_points_polyline.geojson", geojson, "application/geo+json;charset=utf-8");
  downloadTextFile("strava_activity_points_polyline_map.html", mapHtml, "text/html;charset=utf-8");

  if (rateLimited) {
    console.warn("[done] Strava returned 429 for at least one activity. The script stopped to avoid pushing further requests.");
  }
})();