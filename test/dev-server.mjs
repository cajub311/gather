// Throwaway local server: static index.html + the two serverless handlers.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const events = require("../api/events.js");
const meetings = require("../api/meetings.js");
const root = new URL("../", import.meta.url).pathname;

// Vercel caches these responses for 15 minutes; without the same cache here, a
// test run re-fetches all 85 sources every time and Eventbrite starts answering
// 429 for the whole host — which reads exactly like a code regression but isn't.
// Set DEV_NO_CACHE=1 when you actually want to re-probe every source.
const CACHE_MS = process.env.DEV_NO_CACHE ? 0 : 15 * 60 * 1000;
const cache = new Map();
async function cached(key, handler, req, res) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return void res.end(hit.body);
  }
  let body = "";
  await handler(req, {
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { res.statusCode = c; return this; },
    json(d) { body = JSON.stringify(d); },
  });
  cache.set(key, { at: Date.now(), body });
  res.end(body);
}

createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  const shim = {
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { res.statusCode = c; return this; },
    json(d) { res.end(JSON.stringify(d)); },
  };
  try {
    if (path === "/api/events") return void (await cached("events", events, req, res));
    if (path === "/api/meetings") return void (await cached("meetings", meetings, req, res));
    const file = path === "/" ? "index.html" : path.replace(/^\//, "");
    const body = readFileSync(root + file);
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript"
      : file.endsWith(".json") ? "application/json"
      : file.endsWith(".png") ? "image/png" : "text/html");
    res.end(body);
  } catch (e) {
    res.statusCode = 404; res.end("nope: " + e.message);
  }
}).listen(8795, () => console.log("dev on http://localhost:8795"));
