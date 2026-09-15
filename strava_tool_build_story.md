# Demo story: building a Strava OSINT tool with loops

## Objective
Build a simple UI-driven extractor to get start/end points from my own Strava activities without relying on paid API access.

## Why this is OSINT methodology (not tool worship)
The value is not "running a script". The value is the loop:

1. Collect small evidence from UI pages
2. Parse and normalize signals
3. Validate with fallback source (GPX)
4. Export to analyst-friendly formats (CSV, GeoJSON)
5. Re-run with different assumptions

## Script used
- [activitiespointschecker.js](activitiespointschecker.js)

## New workflow supported (athleteId + interval)
- Input `athleteId` as a number or `me`.
- Input interval as `year + week` pieces (for example year `2026` and start week `32`).
- Script builds weekly interval scans (`YYYYWW`) and attempts profile pages for each week.
- Then it runs additional collection routes and exports the results.

## Research loop shown in code
- Collect: paginate over training activities HTML endpoint
- Extract: open each activity page and parse start/end lat/lon
- Validate: if missing, attempt GPX fallback and parse first/last track points
- Export: CSV + GeoJSON for mapping and cluster analysis

## Live demo flow (8 minutes)
1. Open Strava while logged in.
2. Open DevTools Console.
3. Paste and run [activitiespointschecker.js](activitiespointschecker.js).
4. Select number of activities and GPX fallback.
5. Enter `athleteId` and optional interval range (year/week).
6. Show logs: interval scans, source stats, page-by-page extraction.
7. Show CSV and GeoJSON download outputs.
8. Open [map_loop_demo.html](map_loop_demo.html), load CSV, run clustering.
9. Explain uncertainty and devil's advocate interpretation.

## Talking points for your conference
- "API access is one path, not the only path."
- "OSINT mindset means designing repeatable loops from available surfaces."
- "Each AI output is a hypothesis until cross-validated."
- "A script is only useful if it feeds a decision loop with confidence labels."

## Suggested prompt pattern during demo
Role: "Act as an OSINT analyst with strict uncertainty handling."
Task: "Given these points, propose likely routine zones and alternatives."
Rules:
- Do not invent missing data.
- Mark unknowns explicitly.
- Always provide one strongest counter-hypothesis.
Output:
- Table with candidate zone, evidence, confidence, missing evidence.

## Risk and ethics notes
- Use your own account/data or authorized data only.
- Respect platform terms and legal constraints in your jurisdiction.
- Avoid over-claiming exact residence from sparse location evidence.
- Explain confidence and alternative explanations in every conclusion.
