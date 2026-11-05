#!/usr/bin/env node
// Makes api/_slaa-online.json: SLAA's online meetings (slaafws.org/onlinemeetings).
// The list is a Caspio page that only fills in after its own JavaScript runs, so
// this opens it in a hidden browser on the Mac and steps through every page.
// Only English meetings with a clear day, time and zone are kept, and only the
// name, platform, open/closed tags and SLAA's listing ID — no emails, phones,
// links or passcodes. Run every couple of months, then commit the JSON:
//   node scripts/refresh-slaa-online.mjs           (opens the list, ~24 pages)
//   node scripts/refresh-slaa-online.mjs <dir>     (re-reads saved p01.txt… pages)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const LIST = "https://c3gaf515.caspio.com/dp/54ce40005809686590da44cca405";
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "api", "_slaa-online.json");

async function readPages() {
  const { chromium } = require("playwright");
  const b = await chromium.launch({ executablePath: process.env.PW_BIN || undefined, args: ["--use-angle=metal"] });
  const p = await b.newPage();
  await p.goto(LIST, { waitUntil: "domcontentloaded", timeout: 60000 });
  const pages = [];
  let last = "";
  for (let i = 0; i < 60; i++) {
    await p.waitForFunction((prev) => {
      const m = document.body.innerText.match(/Records \d+-\d+ of \d+/);
      return m && m[0] !== prev;
    }, last, { timeout: 30000 }).catch(() => {});
    const r = await p.evaluate(() => (document.body.innerText.match(/Records \d+-\d+ of \d+/) || [""])[0]);
    if (!r || r === last) break;
    last = r;
    pages.push(await p.evaluate(() => document.body.innerText));
    console.log(r);
    const m = r.match(/(\d+)-(\d+) of (\d+)/);
    if (+m[2] >= +m[3]) break;
    const next = await p.$('a.cbResultSetNavigationLinks:has(img[src*="next.gif"]):not(:has(img[src*="next10"]))');
    if (!next) break;
    await next.evaluate((a) => a.click());
    await p.waitForTimeout(2500); // be gentle with their server
  }
  await b.close();
  return pages;
}

const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const DAYW = `(?:EVERY DAY|${DAYS.join("|")})`;
const WHEN = new RegExp(`^(${DAYW}(?:, ${DAYW})*) (\\d{1,2})(?::(\\d\\d))? ?([AP])\\.?M\\.? ([A-Z]{2,3})$`, "i");
// zone letters read by api/meetings.js (Australia is left out: its meetings land overnight here)
const ZONES = { ET: "E", EST: "E", EDT: "E", CT: "C", CST: "C", CDT: "C", MT: "M", MST: "M", MDT: "M",
  PT: "P", PST: "P", PDT: "P", UTC: "U", GMT: "U", UKT: "L", CET: "X" };

function parse(text) {
  const seen = new Set(), rows = [];
  for (const b of text.split(/\n(?=[A-Z][A-Z ]* MEETING \| )/).slice(1)) {
    const lines = b.split("\n").map((l) => l.trim());
    const head = lines[0].match(/^([A-Z ]+) MEETING \| (.+)$/);
    const id = (b.match(/\nID:[ \t]*(\d+)/) || [])[1];
    if (!head || !id || seen.has(id)) continue;
    seen.add(id);
    if (!/English/.test((b.match(/\nLanguages Spoken[ \t]*(.+)/) || [])[1] || "")) continue;
    const when = (lines[1] || "").match(WHEN);
    const zone = when && ZONES[when[5].toUpperCase()];
    if (!zone) continue;
    const fmt = (b.match(/\nMeeting Format[ \t]*(.*)/) || [])[1] || "";
    const tags = (/Closed Meeting/.test(b) ? "C" : /Open Meeting/.test(b) ? "O" : "") +
      (/Women Only/.test(fmt) ? "W" : "") + (/Men Only/.test(fmt) ? "M" : "") + (/LGBT/.test(fmt) ? "L" : "") + (/Newcomers/.test(fmt) ? "N" : "");
    const platform = head[1].replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()).replace("Whatsapp", "WhatsApp");
    const clock = `${when[2]}:${when[3] || "00"} ${when[4].toLowerCase()}m`;
    const days = /EVERY DAY/i.test(when[1]) ? [0, 1, 2, 3, 4, 5, 6] : when[1].toUpperCase().split(", ").map((d) => DAYS.indexOf(d));
    for (const d of days) rows.push([d, clock, zone, head[2].replace(/\s+/g, " ").trim(), platform, tags, +id]);
  }
  return rows;
}

const dir = process.argv[2];
const pages = dir
  ? fs.readdirSync(dir).filter((f) => /^p\d+\.txt$/.test(f)).sort().map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
  : await readPages();
const rows = parse(pages.join("\n"));
if (rows.length < 100) throw new Error(`only ${rows.length} rows — the page probably changed; old file kept`);
const listed = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
fs.writeFileSync(OUT, JSON.stringify({ listed, rows }));
console.log(`wrote ${OUT}: ${rows.length} meeting times from ${new Set(rows.map((r) => r[6])).size} groups`);
