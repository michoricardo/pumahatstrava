(() => {
  const html = document.documentElement.outerHTML;
  const hrefMatches = html.match(/\/activities\/(\d{6,})/g) || [];
  const ids = [...new Set(hrefMatches.map(m => (m.match(/(\d{6,})/) || [])[1]).filter(Boolean))];

  console.log("[diag] current URL:", location.href);
  console.log("[diag] /activities/<id> matches on current page:", ids.length);
  console.log("[diag] sample IDs:", ids.slice(0, 20));

  const anchors = Array.from(document.querySelectorAll('a[href^="/activities/"]')).slice(0, 10).map(a => a.href);
  console.log("[diag] sample anchors:", anchors);

  if (ids.length === 0) {
    console.warn("[diag] Open https://www.strava.com/athlete/training and run again.");
  }
})();
