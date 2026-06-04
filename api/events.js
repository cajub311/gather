// Gather — live community events aggregator (Vercel serverless function)
// Pulls real, public event feeds server-side and normalizes them into the
// activities schema the front-end uses.
//
// Two adapters:
//   tribe  -> "The Events Calendar" WordPress REST API (no auth, public)
//   ics    -> Google Calendar / iCal public feeds (.ics)  [ready for curated IDs]
//
// Add a venue/org: drop it in SOURCES with its type. That's the whole job.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Gather/1.0";

const SOURCES = [
  // --- The Events Calendar (Tribe) REST — confirmed live ---
  { type: "tribe", name: "Surly Brewing Co.", base: "https://surlybrewing.com", lat: 44.9696, lng: -93.2089, addr: "520 Malcolm Ave SE, Minneapolis" },
  { type: "tribe", name: "Modist Brewing", base: "https://modistbrewing.com", lat: 44.9852, lng: -93.2772, addr: "505 N 3rd St, Minneapolis" },
  { type: "tribe", name: "Indeed Brewing", base: "https://indeedbrewing.com", lat: 44.9996, lng: -93.2476, addr: "711 NE 15th Ave, Minneapolis" },
  { type: "tribe", name: "Hook & Ladder Theater", base: "https://thehookmpls.com", lat: 44.9486, lng: -93.2308, addr: "3010 Minnehaha Ave, Minneapolis" },
  { type: "tribe", name: "Landmark Center", base: "https://landmarkcenter.org", lat: 44.9462, lng: -93.0969, addr: "75 W 5th St, St Paul" },

  // --- Google Calendar / ICS public feeds ---
  // Add real Twin Cities public calendars here, e.g.:
  // { type: "ics", name: "Hennepin County Library", cat: "Books",
  //   url: "https://calendar.google.com/calendar/ical/<id>/public/basic.ics",
  //   lat: 44.9788, lng: -93.2700, addr: "Minneapolis" },
];

// skip taproom logistics / non-activity filler that some venues publish as "events"
function isNoise(title) {
  return /^(open|closed|now open|patio|taproom|kitchen|we'?re open|happy hour)\b|food truck|truck:|open at|hours|curbside|to[- ]go|growler/i.test(
    title || ""
  );
}

// map a free-text title / category to one of the app's fixed activity types
function classify(text) {
  const t = (text || "").toLowerCase();
  const has = (re) => re.test(t);
  if (has(/trivia|quiz|bingo|board game|tabletop|chess|d&d|dungeons|magic the|euchre|card game/)) return "Games";
  if (has(/music|concert|\bband\b|\bjam\b|\bdj\b|open mic|singer|songwriter|orchestra|jazz|acoustic|hip[- ]?hop|punk|metal|indie|live at|festival|tour\b/)) return "Music";
  if (has(/meditat|mindful|sound bath|breathwork|yin yoga|restorative/)) return "Zen";
  if (has(/hike|trail|nature walk|birding|kayak|paddle|garden|cleanup|park\b/)) return "Outdoors";
  if (has(/book|author|reading|poetry|\blit\b|storytime|writers/)) return "Books";
  if (has(/art|craft|paint|pottery|knit|maker|draw|ceramic|print|gallery|exhibit/)) return "Art";
  if (has(/run|\b5k\b|fitness|workout|yoga|pilates|volleyball|pickleball|climb|cycling|bike ride|sport/)) return "Fitness";
  if (has(/volunteer|serve|donate|food shelf|fundrais|charity/)) return "Volunteer";
  if (has(/language|spanish|french|german|conversation table|esl/)) return "Language";
  return "Social";
}

function decode(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#0?38;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8217;/g, "’")
    .replace(/&#8211;/g, "–").replace(/&#8212;/g, "—").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseLocal(s) {
  // "YYYY-MM-DD HH:MM:SS" (venue-local) — keep as wall time, no TZ math
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: url } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function dayKey(p) {
  return new Date(p.y, p.mo - 1, p.d).getDay();
}

async function fromTribe(src, startISO, endISO) {
  const url = `${src.base}/wp-json/tribe/events/v1/events?per_page=50&start_date=${startISO}&end_date=${endISO}`;
  const data = await getJSON(url);
  const events = Array.isArray(data.events) ? data.events : [];
  const out = [];
  for (const e of events) {
    const p = parseLocal(e.start_date);
    if (!p) continue;
    const title = decode(e.title);
    if (isNoise(title)) continue;
    const v = e.venue || {};
    const lat = parseFloat(v.geo_lat), lng = parseFloat(v.geo_lng);
    const catNames = (e.categories || []).map((c) => c.name);
    out.push({
      cat: src.cat || classify(title + " " + catNames.join(" ")),
      name: title,
      day: dayKey(p),
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      dur: 120,
      fmt: e.is_virtual ? "online" : "in-person",
      loc: decode(v.venue || src.name),
      addr: decode(v.address ? `${v.address}, ${v.city || ""}`.replace(/, $/, "") : src.addr),
      lat: isFinite(lat) ? lat : src.lat,
      lng: isFinite(lng) ? lng : src.lng,
      types: [e.cost ? decode(e.cost) : "", catNames[0] || ""].filter(Boolean).slice(0, 2),
      url: e.url,
      date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    });
  }
  return out;
}

function parseICS(text, src) {
  const out = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const b of blocks) {
    const get = (k) => {
      const m = b.match(new RegExp(`${k}[^:]*:(.*)`));
      return m ? m[1].trim() : "";
    };
    const dt = get("DTSTART");
    const m = dt.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) continue;
    const p = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 12), mi: +(m[5] || 0) };
    const title = decode(get("SUMMARY"));
    if (!title || isNoise(title)) continue;
    out.push({
      cat: src.cat || classify(title + " " + get("DESCRIPTION")),
      name: title,
      day: dayKey(p),
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      dur: 120,
      fmt: "in-person",
      loc: decode(get("LOCATION")) || src.name,
      addr: decode(get("LOCATION")) || src.addr,
      lat: src.lat, lng: src.lng,
      types: [],
      url: get("URL") || src.base || undefined,
      date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    });
  }
  return out;
}

module.exports = async (req, res) => {
  const now = new Date();
  const end = new Date(now.getTime() + 45 * 864e5); // next 45 days
  const startISO = now.toISOString().slice(0, 10) + " 00:00:00";
  const endISO = end.toISOString().slice(0, 10) + " 23:59:59";
  const todayStr = now.toISOString().slice(0, 10);

  const sources = [];
  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      const list =
        src.type === "ics"
          ? parseICS(await getText(src.url), src)
          : await fromTribe(src, startISO, endISO);
      return { src, list };
    })
  );

  let events = [];
  results.forEach((r, i) => {
    const src = SOURCES[i];
    if (r.status === "fulfilled") {
      const list = r.value.list.filter((e) => e.date >= todayStr && e.lat && e.lng);
      events = events.concat(list);
      sources.push({ name: src.name, count: list.length, ok: true });
    } else {
      sources.push({ name: src.name, count: 0, ok: false });
    }
  });

  // de-dupe (same title+date+venue) and sort by soonest
  const seen = new Set();
  events = events
    .filter((e) => {
      const k = e.name + "|" + e.date + "|" + e.loc;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({ updated: new Date().toISOString(), sources, events });
};
