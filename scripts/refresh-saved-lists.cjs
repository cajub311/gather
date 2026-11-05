#!/usr/bin/env node
// Makes the api/_*.json lists that are too slow to read on every page load
// or that refuse Vercel (now: Nicotine Anonymous, ~10 slow pages; ACA online,
// ~33 pages; GA online, ~60 pages;
// SAA online, ~30 pages; SMART Recovery, HTTP 403). Run from a Mac every couple of months:
//   node scripts/refresh-saved-lists.cjs   then commit the JSON files.
const fs = require("fs");
const path = require("path");
const meetings = require("../api/meetings.js");

(async () => {
  const listed = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  for (const [file, fn] of Object.entries(meetings.savedLists)) {
    try {
      const rows = await fn();
      if (rows.length < 10) throw new Error(`only ${rows.length} rows`);
      fs.writeFileSync(path.join(__dirname, "..", "api", file), JSON.stringify({ listed, rows }));
      console.log(`${file}: ${rows.length}`);
    } catch (e) {
      console.log(`${file}: FAILED (${e.message}) — old file kept`);
    }
  }
})();
