#!/usr/bin/env node
// Makes api/_backup.json: a copy of the sources that block Vercel's servers
// (Cloudflare 403 by IP) but work from a home connection. The live API uses
// it only when the real read fails, and ignores it after 75 days.
// Run from a Mac:  node scripts/backup-blocked.cjs   then commit api/_backup.json
const fs = require("fs");
const path = require("path");
const events = require("../api/events.js");
const meetings = require("../api/meetings.js");

// confirmed failing on a Vercel preview 2026-10-19: 403s, plus SiteGround
// captcha pages (HTML instead of JSON) and DanceMN timeouts
const BLOCKED_EVENTS = ["GriefShare", "DivorceCare", "Utepils Brewing", "American Swedish Institute", "Indeed Brewing",
  "56 Brewing", "Minnesota Museum of American Art", "DanceMN"];
const DAYS = 90; // cover the backup's whole useful life, not just the next 45 days

function chicagoKey(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
}

(async () => {
  const now = new Date();
  const startISO = chicagoKey(now) + " 00:00:00";
  const endISO = chicagoKey(new Date(now.getTime() + DAYS * 864e5)) + " 23:59:59";
  const out = { taken: now.toISOString(), events: {}, meetings: {} };

  for (const name of BLOCKED_EVENTS) {
    const src = events.SOURCES.find((s) => s.name === name);
    if (!src) { console.log(`skip ${name}: not in SOURCES`); continue; }
    try {
      const list = await events.readSource({ ...src, days: DAYS }, startISO, endISO);
      out.events[name] = list;
      console.log(`${name}: ${list.length}`);
    } catch (e) {
      console.log(`${name}: FAILED (${e.message}) — left out`);
    }
  }
  for (const [label, fn] of Object.entries(meetings.backupFetchers)) {
    try {
      const list = await fn();
      out.meetings[label] = list;
      console.log(`${label}: ${list.length}`);
    } catch (e) {
      console.log(`${label}: FAILED (${e.message}) — left out`);
    }
  }
  const file = path.join(__dirname, "..", "api", "_backup.json");
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`wrote ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
})();
