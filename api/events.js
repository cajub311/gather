// Gather — live community events aggregator (Vercel serverless function)
// Pulls real, public event feeds server-side and normalizes them into the
// activities schema the front-end uses.
//
// Adapters:
//   tribe  -> "The Events Calendar" WordPress REST API (no auth, public)
//   meetup -> Meetup's public city page (no paid API)
//   eventbrite -> Eventbrite's public city results (no API key)
//   ics    -> Google Calendar / iCal public feeds (.ics)
//
// Add a venue/org: drop it in SOURCES with its type. That's the whole job.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Gather/1.0";

const SOURCES = [
  // --- The Events Calendar (Tribe) REST — confirmed live ---
  { type: "tribe", name: "Surly Brewing Co.", base: "https://surlybrewing.com", lat: 44.9696, lng: -93.2089, addr: "520 Malcolm Ave SE, Minneapolis" },
  { type: "tribe", name: "Modist Brewing", base: "https://modistbrewing.com", lat: 44.9852, lng: -93.2772, addr: "505 N 3rd St, Minneapolis" },
  { type: "tribe", name: "Indeed Brewing", base: "https://indeedbrewing.com", lat: 44.9996, lng: -93.2476, addr: "711 NE 15th Ave, Minneapolis" },
  { type: "tribe", name: "Landmark Center", base: "https://landmarkcenter.org", lat: 44.9462, lng: -93.0969, addr: "75 W 5th St, St Paul" },
  { type: "tribe", name: "56 Brewing", base: "https://56brewing.com", lat: 45.0156, lng: -93.2410, addr: "3134 California St NE, Minneapolis" },
  { type: "tribe", name: "Minneapolis Parks", base: "https://www.minneapolisparks.org", lat: 44.9778, lng: -93.2650, addr: "Minneapolis" },
  { type: "tribe", name: "Como Zoo & Conservatory", base: "https://comozooconservatory.org", lat: 44.9822, lng: -93.1519, addr: "1225 Estabrook Dr, St Paul" },
  { type: "tribe", name: "Summit Brewing", base: "https://www.summitbrewing.com", lat: 44.9160, lng: -93.1360, addr: "910 Montreal Cir, St Paul" },
  { type: "tribe", name: "Utepils Brewing", base: "https://www.utepilsbrewing.com", lat: 44.9790, lng: -93.3080, addr: "225 Thomas Ave N, Minneapolis" },
  { type: "tribe", name: "White Squirrel Bar", base: "https://whitesquirrelbar.com", lat: 44.9270, lng: -93.1250, addr: "974 W 7th St, St Paul" },

  // --- Squarespace event collections (?format=json) — confirmed live ---
  { type: "squarespace", name: "Bad Weather Brewing", base: "https://www.badweatherbrewery.com/events", lat: 44.9276, lng: -93.1310, addr: "1505 7th St W, St Paul" },
  { type: "squarespace", name: "Lake Monster Brewing", base: "https://www.lakemonsterbrewing.com/events", lat: 44.9636, lng: -93.1880, addr: "550 Vandalia St, St Paul" },
  { type: "squarespace", name: "Arbeiter Brewing", base: "https://www.arbeiterbrewing.com/events", lat: 44.9487, lng: -93.2310, addr: "3038 Minnehaha Ave, Minneapolis" },
  { type: "squarespace", name: "Pryes Brewing", base: "https://www.pryesbrewing.com/events", lat: 44.9920, lng: -93.2790, addr: "1401 West River Rd N, Minneapolis" },
  { type: "squarespace", name: "The Cedar", base: "https://www.thecedar.org/events", lat: 44.9689, lng: -93.2470, addr: "416 Cedar Ave S, Minneapolis", cat: "Music" },
  { type: "squarespace", name: "Berlin", base: "https://www.berlinmpls.com/calendar", lat: 44.9822, lng: -93.2717, addr: "204 N 1st St, Minneapolis", cat: "Music" },

  // --- Library systems (BiblioCommons JSON) — free events, storytimes, classes ---
  { type: "biblio", name: "St Paul Library", lib: "sppl", addr: "St Paul" },
  { type: "biblio", name: "Hennepin Co. Library", lib: "hclib", addr: "Minneapolis" },

  // --- Wide public discovery pages ---
  { type: "meetup", name: "Meetup", url: "https://www.meetup.com/find/us--mn--minneapolis/?eventType=inPerson&source=EVENTS" },
  { type: "meetup", name: "Meetup St Paul", url: "https://www.meetup.com/find/us--mn--saint-paul/?eventType=inPerson&source=EVENTS" },
  { type: "eventbrite", name: "Eventbrite", url: "https://www.eventbrite.com/d/mn--minneapolis/events--today/" },
  { type: "eventbrite", name: "Eventbrite (page 2)", url: "https://www.eventbrite.com/d/mn--minneapolis/events--today/?page=2" },
  { type: "eventbrite", name: "Eventbrite St Paul", url: "https://www.eventbrite.com/d/mn--saint-paul/events--this-week/" },
];

// skip taproom logistics / non-activity filler that some venues publish as "events"
function isNoise(title) {
  return /^(open|closed|now open|patio|taproom|kitchen|we'?re open|happy hour)\b|food truck|truck:|open at|hours|curbside|to[- ]go|growler|lean six sigma|project management techniques training|certification training/i.test(
    title || ""
  );
}

// map a free-text title / category to one of the app's fixed activity types
function classify(text) {
  const t = (text || "").toLowerCase();
  const has = (re) => re.test(t);
  if (has(/trivia|quiz|bingo|board game|tabletop|chess|d&d|dungeons|magic the|euchre|card game/)) return "Games";
  if (has(/watch party|singles mixer|meet new|networking|happy hour/)) return "Social";
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
    .replace(/&#x27;|&apos;/gi, "'")
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
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: url },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function getText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(12000),
  });
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
    const v = Array.isArray(e.venue) ? (e.venue[0] || {}) : (e.venue || {});
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
      image: e.image && e.image.url,
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

// Squarespace stores event start as an absolute epoch (ms). Convert to the
// venue's wall-clock time in America/Chicago so day/time are correct.
function chicagoParts(ms) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  let h = +o.hour; if (h === 24) h = 0;
  return { y: +o.year, mo: +o.month, d: +o.day, h, mi: +o.minute };
}

async function fromSquarespace(src) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < 3; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${String(dt.getMonth() + 1).padStart(2, "0")}-${dt.getFullYear()}`);
  }
  const origin = new URL(src.base).origin;
  const out = [], seen = new Set();
  for (const m of months) {
    let j;
    try { j = await getJSON(`${src.base}?format=json&month=${m}`); } catch { continue; }
    const items = [...(j.upcoming || []), ...(j.items || [])];
    for (const e of items) {
      if (!e.startDate) continue;
      const title = decode(e.title);
      if (!title || isNoise(title)) continue;
      const p = chicagoParts(e.startDate);
      const date = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
      const k = title + "|" + date;
      if (seen.has(k)) continue;
      seen.add(k);
      const loc = e.location || {};
      const lat = parseFloat(loc.mapLat), lng = parseFloat(loc.mapLng);
      out.push({
        cat: src.cat || classify(title + " " + (e.tags || []).join(" ") + " " + (e.categories || []).join(" ")),
        name: title,
        day: dayKey(p),
        time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
        dur: 120,
        fmt: "in-person",
        loc: decode(loc.addressTitle || src.name),
        addr: decode([loc.addressLine1, loc.addressLine2].filter(Boolean).join(", ")) || src.addr,
        lat: isFinite(lat) && lat ? lat : src.lat,
        lng: isFinite(lng) && lng ? lng : src.lng,
        types: [],
        url: e.fullUrl ? origin + e.fullUrl : src.base,
        date,
        dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
        source: src.name,
        live: true,
        verified: true,
      });
    }
  }
  return out;
}

// BiblioCommons (library events). Entities carry the real data; items is the
// ordered id list. Branch + place entities both have geocoded centrePoints.
async function fromBiblio(src) {
  const start = chicagoDateKey(new Date());
  const end = chicagoDateKey(new Date(Date.now() + 45 * 864e5));
  const out = [];
  for (let page = 1; page <= 2; page++) {
    let j;
    try {
      j = await getJSON(`https://gateway.bibliocommons.com/v2/libraries/${src.lib}/events?startDate=${start}&endDate=${end}&limit=100&page=${page}`);
    } catch { break; }
    const ids = (j.events && j.events.items) || [];
    const ents = j.entities || {};
    const evs = ents.events || {}, locs = ents.locations || {}, places = ents.places || {};
    const typesEnt = ents.eventTypes || {}, auds = ents.eventAudiences || {}, imgs = ents.images || {};
    for (const id of ids) {
      const e = (evs[id] || {}).definition;
      if (!e || e.isCancelled) continue;
      const m = String(e.start || "").match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) continue;
      const p = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
      const title = decode(e.title);
      if (!title || isNoise(title)) continue;
      const locEnt = locs[e.branchLocationId] || places[e.nonBranchLocationId];
      const cp = locEnt && locEnt.mapLocation && locEnt.mapLocation.centrePoint;
      if (!cp || !cp.lat || !cp.lng) continue;
      if (cp.lat < 44.6 || cp.lat > 45.35 || cp.lng < -93.8 || cp.lng > -92.75) continue; // metro only
      const a = locEnt.address || {};
      const typeNames = (e.typeIds || []).map((t) => (typesEnt[t] || {}).name).filter(Boolean);
      const audNames = (e.audienceIds || []).map((t) => (auds[t] || {}).name).filter(Boolean);
      const img = imgs[e.featuredImageId];
      out.push({
        cat: classify(title + " " + typeNames.join(" ")),
        name: title,
        day: dayKey(p),
        time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
        dur: duration(e.start, e.end),
        fmt: "in-person",
        loc: decode(locEnt.name || src.name),
        addr: decode([a.number && a.street ? `${a.number} ${a.street}` : a.street, a.city].filter(Boolean).join(", ")) || src.addr,
        lat: cp.lat, lng: cp.lng,
        types: ["Free", audNames[0] || typeNames[0] || ""].filter(Boolean).slice(0, 2),
        url: `https://${src.lib}.bibliocommons.com/events/${id}`,
        image: img && img.url,
        date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
        dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
        source: src.name,
        live: true,
        verified: true,
      });
    }
    const pg = j.events && j.events.pagination;
    if (!pg || page >= pg.pages) break;
  }
  return out;
}

function cityPoint(city) {
  const c = String(city || "").toLowerCase();
  if (c.includes("st. paul") || c.includes("saint paul")) return { lat: 44.9537, lng: -93.0900 };
  if (c.includes("bloomington")) return { lat: 44.8408, lng: -93.2983 };
  if (c.includes("edina")) return { lat: 44.8897, lng: -93.3499 };
  if (c.includes("shoreview")) return { lat: 45.0791, lng: -93.1472 };
  return { lat: 44.9778, lng: -93.2650 };
}

function duration(start, end) {
  const mins = (Date.parse(end) - Date.parse(start)) / 60000;
  return Number.isFinite(mins) && mins > 0 && mins < 1440 ? Math.round(mins) : 120;
}

async function fromMeetup(src) {
  const html = await getText(src.url);
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("Meetup data not found");
  const data = JSON.parse(match[1]);
  const found = [], seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (value.eventUrl && value.dateTime && value.title && !seen.has(value.eventUrl)) {
      seen.add(value.eventUrl);
      found.push(value);
    }
    Object.values(value).forEach(walk);
  }
  walk(data.props && data.props.pageProps);
  return found.map((e) => {
    const p = chicagoParts(Date.parse(e.dateTime));
    const venue = e.venue || {};
    const point = cityPoint(venue.city);
    const address = [venue.address, venue.city, venue.state].filter(Boolean).join(", ");
    const going = e.going && Number(e.going.totalCount);
    return {
      cat: classify(`${e.title} ${e.group && e.group.name || ""}`),
      name: decode(e.title),
      day: dayKey(p),
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      dur: duration(e.dateTime, e.endTime),
      fmt: e.isOnline || e.eventType === "ONLINE" ? "online" : e.eventType === "HYBRID" ? "hybrid" : "in-person",
      loc: decode(venue.name || (e.group && e.group.name) || "Meetup"),
      addr: decode(address || "Twin Cities"),
      lat: point.lat,
      lng: point.lng,
      approx: true,
      types: [going ? `${going} going` : "", e.group && e.group.name].filter(Boolean).slice(0, 2),
      url: e.eventUrl,
      image: e.displayPhoto && e.displayPhoto.highResUrl,
      date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    };
  });
}

async function fromEventbrite(src) {
  const html = await getText(src.url);
  const match = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?})\s*;\s*window\.__REACT_QUERY_STATE__/i);
  if (!match) throw new Error("Eventbrite data not found");
  const data = JSON.parse(match[1]);
  const rows = data.search_data && data.search_data.events && data.search_data.events.results;
  if (!Array.isArray(rows)) throw new Error("Eventbrite results not found");
  return rows.filter((e) => !e.is_cancelled && !isNoise(e.name)).map((e) => {
    const a = e.primary_venue && e.primary_venue.address || {};
    const p = parseLocal(`${e.start_date} ${e.start_time}`);
    const tags = (e.tags || []).map((t) => decode(t.display_name)).filter(Boolean);
    const venueName = decode(e.primary_venue && e.primary_venue.name || a.city || "Twin Cities");
    const address = decode(a.localized_address_display || [a.address_1, a.city, a.region].filter(Boolean).join(", "));
    const onlinePlace = /(?:^|\b)(online|virtual|zoom)(?:\b|$)/i.test(`${venueName} ${address}`);
    return {
      cat: classify(`${e.name} ${tags.join(" ")}`),
      name: decode(e.name),
      day: dayKey(p),
      time: e.start_time,
      dur: 120,
      fmt: e.is_online_event || onlinePlace ? "online" : "in-person",
      loc: venueName,
      addr: address,
      lat: parseFloat(a.latitude),
      lng: parseFloat(a.longitude),
      types: tags.slice(0, 2),
      url: e.url,
      image: e.image && e.image.image_sizes && (e.image.image_sizes.medium || e.image.url),
      date: e.start_date,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    };
  });
}

function chicagoDateKey(date) {
  const p = chicagoParts(date.getTime());
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

module.exports = async (req, res) => {
  const now = new Date();
  const end = new Date(now.getTime() + 45 * 864e5); // next 45 days
  const startISO = chicagoDateKey(now) + " 00:00:00";
  const endISO = chicagoDateKey(end) + " 23:59:59";
  const endStr = chicagoDateKey(end);
  const todayStr = chicagoDateKey(now);

  const sources = [];
  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      let list;
      if (src.type === "ics") list = parseICS(await getText(src.url), src);
      else if (src.type === "biblio") list = await fromBiblio(src);
      else if (src.type === "squarespace") list = await fromSquarespace(src);
      else if (src.type === "meetup") list = await fromMeetup(src);
      else if (src.type === "eventbrite") list = await fromEventbrite(src);
      else list = await fromTribe(src, startISO, endISO);
      return { src, list };
    })
  );

  let events = [];
  results.forEach((r, i) => {
    const src = SOURCES[i];
    if (r.status === "fulfilled") {
      const list = r.value.list.filter((e) => e.date >= todayStr && e.date <= endStr && e.lat && e.lng);
      events = events.concat(list);
      sources.push({ name: src.name, count: list.length, ok: true });
    } else {
      sources.push({ name: src.name, count: 0, ok: false, error: String(r.reason && r.reason.message || r.reason || "Unavailable") });
    }
  });

  // de-dupe (same title+date+venue) and sort by soonest
  const seen = new Set();
  events = events
    .filter((e) => {
      const k = e.name.toLowerCase().replace(/\W+/g, " ").trim() + "|" + e.date + "|" + e.time;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=21600");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({ updated: new Date().toISOString(), sources, events });
};
