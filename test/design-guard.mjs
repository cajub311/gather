#!/usr/bin/env node
/** Structural guard: reject deployments that erase Gather's working dayboard. */
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const initBody = html.match(/function init\(\)\{([\s\S]*?)\n\}\nfunction setUserMarker/)?.[1] || "";

const checks = [
  ["dayboard design marker", html.includes('data-design="dayboard-v4"')],
  // Default is Everything (user asked for a full aggregator); For You stays one tap away.
  ["For You stays available as an option", html.includes('{id:"social",label:"For You"')],
  ["Everything is the default activity view", html.includes('let _vibeStored="all"')],
  ["20 mile radius option", html.includes('[20,"\\u226420 mi"]')],
  ["dayboard metadata", html.includes('name="gather-design" content="dayboard-v4"')],
  [
    "desktop and mobile Map/List stay visible",
    /\.mode-activities \.viewtabs\s*\{[\s\S]{0,180}?display:flex/.test(html),
  ],
  ["Map/List is never hidden in activities", !/\.mode-activities \.viewtabs\s*\{\s*display:\s*none/.test(html)],
  ["ticket time rail remains", html.includes(".meet-card .timecol")],
  ["activity titles can be links", html.includes('<a class="event-title" href="${href}"')],
  // Critical: Near me + radius must not wipe Meetup approx rows
  [
    "radius filter no approx hard-drop",
    !/if\s*\(\s*state\.radius\s*&&\s*state\.near\s*\)\s*\{[\s\S]{0,120}?m\.approx/.test(html) &&
      !html.includes("m.approx||m.lat==null") &&
      !html.includes("m.approx || m.lat == null"),
  ],
  [
    "radius filter uses lat/lng null check",
    /if\s*\(\s*state\.radius\s*&&\s*state\.near\s*\)\s*\{[\s\S]{0,200}?m\.lat\s*==\s*null/.test(html) ||
      html.includes("m.lat==null||m.lng==null"),
  ],
  ["soft distance sort for approx", html.includes("_sortD")],
  ["automatic startup does not request location", !initBody.includes("getCurrentPosition") && !initBody.includes("requestMyArea")],
  ["installed app refreshes itself", html.includes('serviceWorker.addEventListener("controllerchange"')],
  ["current app cache", sw.includes('const CACHE = "gather-v10"')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) {
  console.error(
    "FAILED:",
    failed.map((f) => f[0])
  );
  process.exit(1);
}
