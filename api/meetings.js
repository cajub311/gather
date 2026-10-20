// Gather — live meetings aggregator (Vercel serverless function)
// AA (Mpls intergroup + statewide), Al-Anon, NA → one clean Twin Cities list.
//
// Output shape the front-end already uses, plus optional notes/door:
// { cat,name,day,time,dur,fmt,loc,addr,lat,lng,types,url,notes,door,region,approx,live,verified }

const AA_URL = "https://aaminneapolis.org/wp-admin/admin-ajax.php?action=meetings";
const NA_URL =
  "https://bmlt.naminnesota.org/main_server/client_interface/json/?switcher=GetSearchResults";
const AA_MN_PAGE = "https://aaminnesota.org/meetings/";
const ALANON_URL = "https://mnsa-afg.org/wp-admin/admin-ajax.php?action=meetings";
// Recovery Dharma = meditation-based recovery (national TSML feed, MN rows filtered below)
const DHARMA_URL = "https://recoverydharma.org/wp-admin/admin-ajax.php?action=meetings";
// Refuge Recovery + Buddhist Recovery Network: national TSML feeds with no real
// Twin Cities chapter addresses (online rows geocode to a US-wide placeholder,
// not MN) — kept via looksCentralTime() on the meeting name instead of geo.
const REFUGE_URL = "https://refugerecoverymeetings.org/wp-admin/admin-ajax.php?action=meetings";
const BUDDHIST_URL = "https://buddhistrecovery.org/wp-admin/admin-ajax.php?action=meetings";
// More fellowships that publish a public TSML feed. Each one is optional: a
// feed that fails just shows as a failed source, the rest still load.
const EXTRA_TSML = [
  { cat: "CMA", label: "Crystal Meth Anonymous", url: "https://www.crystalmeth.org/wp-admin/admin-ajax.php?action=meetings" },
];
// Sexaholics Anonymous Twin Cities: WP Store Locator, one row per meeting with
// the day and time inside the name ("Meraki – Saturday, 7:00 AM").
const SA_URL =
  "https://satwincities.org/wp-admin/admin-ajax.php?action=store_search&lat=44.9778&lng=-93.265&max_results=500&search_radius=250&autoload=1";
// Fellowships with no public feed of their own (OA, CoDA, ACA, SMART, ...).
// SobaSearch is a third-party meeting directory; one search per program,
// asked one at a time because it rate-limits after about ten quick calls.
const SOBA_URL =
  "https://sobasearch.com/api/v1/search?location=Minneapolis%2C%20MN&kind=meeting&radius_miles=30&limit=100&q=";
const SOBA_PROGRAMS = [
  ["OA", "OA"], ["CoDA", "CoDA"], ["ACA", "ACA"], ["SMART", "SMART"],
  ["Celebrate Recovery", "CR"], ["MA", "MA"], ["EDA", "EDA"], ["Wellbriety", "WB"],
];
const SOBA_CAT = { WB: "Wellbriety" };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Gather/1.0";

// TSML codes → short UI labels. Skip noise codes that appear on almost every row (MW).
const TSML_TYPES = {
  O: "Open", C: "Closed", M: "Men", W: "Women",
  B: "Beginners", BE: "Newcomers", Y: "Young People", YP: "Young People",
  BB: "Big Book", D: "Discussion", SP: "Speaker", ST: "Step", STEP: "Step",
  TR: "Tradition", TO: "Topic", LGBTQ: "LGBTQ", G: "Gay", L: "Lesbian",
  X: "Wheelchair", HA: "Accessible", WC: "Wheelchair",
  BV: "Babysitting", CC: "Childcare", CF: "Child-friendly",
  S: "Spanish", HE: "Spanish", POC: "People of Color",
  ONL: "Online", DB: "Digital Basket", "11": "11th Step",
  TC: "Temp. closed",
};
// Codes we never show as chips (redundant or meaningless to seekers)
const TSML_HIDE = new Set(["MW", "ONL", "DB"]);

const NA_FORMATS = {
  O: "Open", C: "Closed", M: "Men", W: "Women", GL: "LGBTQ",
  BT: "Basic Text", JT: "Just for Today", RF: "Rotating",
  WC: "Wheelchair", VM: "Virtual", TC: "Temp. closed",
  BEG: "Beginners", BK: "Book study", To: "Topic",
  SD: "Speaker", SPAD: "SPAD",
};

async function getJSON(url, ms = 25000) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,*/*", Referer: url },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

// Sex Addicts Anonymous national site (Drupal). The day filter only honours one
// value per request, so ask once per weekday. Only the map-view blocks are
// real rooms — the teaser list mixes in Zoom groups wearing a default address.
const SAA_URL =
  "https://saa-recovery.org/meetings?field_geolocation_proximity_center%5Bcoordinates%5D%5Blat%5D=44.9778&field_geolocation_proximity_center%5Bcoordinates%5D%5Blng%5D=-93.265&field_geolocation_proximity=50&meeting_day_of_week_views_filter%5B%5D=";
const SAA_DAYS = [32, 22, 30, 18, 28, 24, 26]; // Sun..Sat

async function fetchSAA() {
  const pages = await Promise.all(
    SAA_DAYS.map(async (code, day) => {
      const r = await fetch(SAA_URL + code, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`saa HTTP ${r.status}`);
      return { day, html: await r.text() };
    })
  );
  const out = [];
  const seen = new Set();
  const unent = (s) => s.replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const txt = (block, cls) => {
    const m = block.match(new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</(?:div|span|li|a)>`));
    return m ? unent(cleanText(m[1])) : "";
  };
  for (const { day, html } of pages) {
    for (const block of html.split(/class="geolocation-location\b/).slice(1)) {
      const lat = parseFloat((block.match(/data-lat="([-\d.]+)"/) || [])[1]);
      const lng = parseFloat((block.match(/data-lng="([-\d.]+)"/) || [])[1]);
      const link = block.match(/<a href="(\/meetings\/[^"]+)"[^>]*>([^<]+)<\/a>/);
      const tm = block.match(/meeting-time-time">\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*C[DS]?T/i);
      if (!link || !tm || !isFinite(lat)) continue;
      const key = link[1] + "|" + day;
      if (seen.has(key)) continue;
      seen.add(key);
      const h = (+tm[1] % 12) + (/pm/i.test(tm[3]) ? 12 : 0);
      const street = txt(block, "address-line1");
      const city = txt(block, "locality");
      const access = txt(block, "field--field-access");
      const gender = txt(block, "field--field-gender");
      const types = [/open/i.test(access) ? "Open" : /closed/i.test(access) ? "Closed" : "", /^men/i.test(gender) ? "Men" : /^women/i.test(gender) ? "Women" : ""].filter(Boolean);
      out.push({
        cat: "SAA",
        name: unent(cleanText(link[2])),
        day,
        time: String(h).padStart(2, "0") + ":" + tm[2],
        dur: 60,
        fmt: "in-person",
        loc: txt(block, "field--field-facility-name") || "SAA Group",
        addr: [street, city].filter(Boolean).join(", ") || "Twin Cities",
        lat,
        lng,
        types,
        url: "https://saa-recovery.org" + link[1],
        live: true,
        verified: true,
      });
    }
  }
  return out;
}

// Gamblers Anonymous national list: plain HTML pages, street address but no pin.
// Pins below come from the US Census geocoder (2026-10-19), keyed "house# zip";
// a new metro address is looked up live the same way.
const GA_URL = "https://gamblersanonymous.org/usa-meetings/?state=Minnesota&term=147&paged=";
const GA_PINS = {
  "850 55303": [45.19036, -93.37565], "1701 55431": [44.82637, -93.30216],
  "4938 55429": [45.04471, -93.31966], "2051 55313": [45.22309, -93.84662],
  "11100 55337": [44.80185, -93.23138], "305 55008": [45.57481, -93.23323],
  "3837 55421": [45.03667, -93.24713], "6875 55016": [44.84853, -92.92164],
  "2180 55122": [44.80118, -93.21961], "6716 55439": [44.88091, -93.38213],
  "715 55343": [44.93093, -93.40852], "1390 55113": [44.99195, -93.04302],
  "7550 55428": [45.05474, -93.37555], "5011 55417": [44.91246, -93.22706],
  "509 55063": [45.82665, -92.96972], "3920 55126": [45.06027, -93.13126],
  "520 55101": [44.95142, -93.09462], "253 55107": [44.93823, -93.07758],
  "7380 55125": [44.92335, -92.95614],
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

async function censusPin(addr) {
  const u = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(addr);
  const j = await getJSON(u, 6000);
  const m = j?.result?.addressMatches?.[0];
  return m ? [m.coordinates.y, m.coordinates.x] : null;
}

async function fetchGA() {
  const pages = await Promise.all(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(async (n) => {
      const r = await fetch(GA_URL + n, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`ga HTTP ${r.status}`);
      return r.text();
    })
  );
  const rows = [];
  const seen = new Set();
  const unent = (s) => s.replace(/&#0*39;|&#8217;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  for (const html of pages) {
    const re = /<a href='([^']+)'><div[^>]*><h4>([^<]+)<\/h4>\s*<p[^>]*>Location:\s*([^<]+)<\/p>\s*<p[^>]*>Time:\s*(\d{1,2}):(\d{2})\s*(AM|PM)<\/p>\s*<div>([\s\S]*?)<\/div><\/div><\/a>/gi;
    for (const m of html.matchAll(re)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = unent(m[2]).trim();
      const day = WEEKDAYS.indexOf((title.match(/-\s*(\w+day)\s*$/i) || [])[1]?.toLowerCase());
      const addr = unent(m[3]).replace(/,?\s*United States/i, "").trim();
      const zip = (addr.match(/\b(55[0-5]\d\d)\b/) || [])[1];
      if (day < 0 || !zip) continue; // 55000-55599 = the metro side of the state
      // first <p> is the place name, the rest is door / room notes
      const paras = [...m[7].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => unent(cleanText(p[1]))).filter(Boolean);
      const place = paras[0] && !/^(?:open|closed) meeting/i.test(paras[0]) ? paras.shift() : "";
      const notes = paras.join(" · ");
      const h = (+m[4] % 12) + (/pm/i.test(m[6]) ? 12 : 0);
      rows.push({
        cat: "GA",
        name: title.replace(/\s*-\s*\w+day\s*$/i, ""),
        day,
        time: String(h).padStart(2, "0") + ":" + m[5],
        dur: 90,
        fmt: "in-person",
        loc: place || "GA Group",
        addr: addr.replace(/,?\s*Minnesota,?\s*\d{5}$/i, "").replace(/\s+Minnesota\s+\d{5}$/i, ""),
        key: (addr.match(/^\d+/) || [""])[0] + " " + zip,
        full: addr,
        types: [/open meeting/i.test(notes) ? "Open" : /closed meeting/i.test(notes) ? "Closed" : ""].filter(Boolean),
        notes: notes.replace(/\b(?:open|closed) meeting;?\s*(?:·\s*)?/gi, "").replace(/[\s·]+$/, "") || undefined,
        url: m[1],
        live: true,
        verified: true,
      });
    }
  }
  const missing = [...new Set(rows.filter((r) => !GA_PINS[r.key]).map((r) => r.full))].slice(0, 8);
  const found = {};
  await Promise.all(missing.map(async (a) => { try { found[a] = await censusPin(a); } catch {} }));
  return rows
    .map(({ key, full, ...r }) => {
      const ll = GA_PINS[key] || found[full];
      return ll ? { ...r, lat: ll[0], lng: ll[1] } : null;
    })
    .filter(Boolean);
}

// Nar-Anon world service runs on Knack; its public map view takes a "near ZIP" filter
const NARANON_URL =
  "https://api.knack.com/v1/pages/scene_5/views/view_7/records?rows_per_page=200&filters=" +
  encodeURIComponent(JSON.stringify([{ field: "field_1", operator: "near", value: "55401", range: "50" }]));

async function fetchNarAnon() {
  const r = await fetch(NARANON_URL, {
    headers: { "User-Agent": UA, "X-Knack-Application-Id": "54dd0787f294e1891969b4db", "X-Knack-REST-API-Key": "knack" },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`nar-anon HTTP ${r.status}`);
  const out = [];
  for (const x of (await r.json()).records || []) {
    const a = x.field_1_raw || {};
    const day = WEEKDAYS.indexOf((String(x.field_6).match(/\w+day/i) || [""])[0].toLowerCase());
    const tm = String(x.field_82).match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (day < 0 || !tm || !isFinite(a.latitude) || /disband|inactive/i.test(x.field_67)) continue;
    const h = (+tm[1] % 12) + (/pm/i.test(tm[3]) ? 12 : 0);
    out.push({
      cat: "Nar-Anon",
      name: `Nar-Anon at ${cleanText(x.field_5) || a.city}`,
      day,
      time: String(h).padStart(2, "0") + ":" + tm[2],
      dur: 60,
      fmt: "in-person",
      loc: cleanText(x.field_5) || "Nar-Anon Group",
      addr: [a.street, a.city].filter(Boolean).join(", "),
      lat: a.latitude,
      lng: a.longitude,
      types: [],
      notes: [/of the month/i.test(x.field_6) ? "Meets once a month — check the day with the group" : "",
        /virtual/i.test(x.field_4) ? "Also has an online option" : ""].filter(Boolean).join(" · ") || undefined,
      url: "https://www.nar-anon.org/find-a-meeting",
      live: true,
      verified: true,
    });
  }
  return out;
}

async function fetchAAMinnesota() {
  const r = await fetch(AA_MN_PAGE, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`tsml page HTTP ${r.status}`);
  const m = (await r.text()).match(/data-src=['"]([^'"]+)/);
  if (!m) throw new Error("tsml data-src not found");
  return getJSON(new URL(m[1], AA_MN_PAGE).href);
}

function inMetro(m) {
  return m.lat > 44.6 && m.lat < 45.35 && m.lng > -93.8 && m.lng < -92.75;
}

// National online-meeting feeds often list several timezone offsets in the
// title ("4:30am PT- 6:30am CT- 7:30am ET"); Central Time is the closest
// available signal to "relevant to a Minnesotan" when geo is a placeholder.
function looksCentralTime(name) {
  return /central time|america\/chicago|\bCT\b|\bC\.T\.\b/i.test(String(name || ""));
}

function hhmm(t) {
  if (!t) return "12:00";
  const m = String(t).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "12:00";
}

function durMins(start, end) {
  try {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let d = eh * 60 + em - (sh * 60 + sm);
    if (d <= 0) d += 24 * 60;
    return d > 0 && d <= 300 ? d : 60;
  } catch {
    return 60;
  }
}

function cleanAddr(s) {
  return String(s || "")
    .replace(/,?\s*USA\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    // "UptownAFG" / "Grp" style glued words from some feeds
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function to24h(t) {
  if (/\bnoon\b/i.test(t || "")) return "12:00";
  const m = String(t || "").match(/(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
  if (!m) return null;
  let h = +m[1] % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return String(h).padStart(2, "0") + ":" + m[2];
}

function normalizeSA(rows) {
  const out = [];
  for (const r of rows || []) {
    const store = cleanText(String(r.store || "").replace(/&#8211;|&ndash;/g, "–"));
    const m = store.match(/^(.*?)\s*[–-]\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b[^,]*,?\s*(\d{1,2}:\d{2}\s*[ap]\.?m\.?|12 noon)/i);
    if (!m) continue;
    const time = to24h(m[3]);
    if (!time) continue;
    const inRoom = /in[- ]person/i.test(r.meeting_type || "");
    const online = !inRoom;
    const hybrid = inRoom && /dial/i.test(r.meeting_type || "");
    const hidden = /not published/i.test(r.address || "");
    const addr = [r.address, r.address2].filter((x) => x && !/only|not published/i.test(x)).join(", ");
    out.push({
      cat: "SA",
      name: m[1] || "SA meeting",
      day: DAY_NAMES.findIndex((d) => d.startsWith(m[2].toLowerCase())),
      time,
      dur: 60,
      fmt: online ? "online" : hybrid ? "hybrid" : "in-person",
      loc: online ? "Phone / Zoom" : hidden ? "Call for the location" : cleanText(r.address),
      addr: online ? "Call or email for the link" : cleanAddr(`${addr ? addr + ", " : ""}${r.city || ""}, ${r.state || "MN"} ${r.zip || ""}`),
      lat: +r.lat || null,
      lng: +r.lng || null,
      types: [r.genders, r.meeting_type].filter(Boolean).map(cleanText),
      notes: cleanText(r.note) || undefined,
      url: "https://satwincities.org/",
      approx: online || hidden || undefined,
      region: r.city || "Twin Cities",
      live: true,
      verified: true,
    });
  }
  return out;
}

// Hours to add to a SobaSearch time to make it Central. Their rows carry the
// zone the time is written in; Twin Cities OA rows are labelled Denver but
// written an hour early, so converting by the label lands on the right time
// (checked against OA Unity Intergroup's own sheet, 2026-10-19).
function hoursToCentral(tz) {
  if (!tz || tz === "America/Chicago") return 0;
  try {
    const at = (z) => +new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "numeric", hourCycle: "h23" }).format(new Date());
    return ((at("America/Chicago") - at(tz)) + 36) % 24 - 12;
  } catch {
    return 0;
  }
}

function normalizeSoba(rows, want) {
  const out = [];
  for (const r of rows || []) {
    if (r.program_type !== want || r.latitude == null || r.longitude == null) continue;
    // a Duluth, Georgia meeting was geocoded into the metro box
    if (r.state && !/^(MN|Minnesota)$/i.test(r.state)) continue;
    const t = String(r.starts_at || "").match(/^(\d{2}):(\d{2})/);
    if (!t) continue;
    let mins = +t[1] * 60 + +t[2] + hoursToCentral(r.timezone) * 60;
    let shift = 0;
    if (mins < 0) { mins += 1440; shift = -1; }
    if (mins >= 1440) { mins -= 1440; shift = 1; }
    const time = String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    let dur = 60;
    const e = String(r.ends_at || "").match(/^(\d{2}):(\d{2})/);
    if (e) {
      const d = +e[1] * 60 + +e[2] - (+t[1] * 60 + +t[2]);
      if (d > 0 && d <= 240) dur = d;
    }
    const virtual = r.attendance_mode === "online" || /only held virtually/i.test(r.name || "");
    const hybrid = r.attendance_mode === "hybrid" || /hybrid/i.test(r.name || "");
    const cat = SOBA_CAT[want] || want;
    const name = /only held virtually/i.test(r.name || "")
      ? `${cat} – ${r.city || "Twin Cities"}`
      : cleanText(r.name).replace(/^SMART Recovery USA - Meeting #\d+\s*(.*?)(?:, Minnesota)?$/i, "SMART Recovery – $1");
    // some directory rows carry scraped page code instead of a street
    const street = /[<>]|manage your meeting/i.test(r.address || "") || String(r.address || "").length < 5 ? "" : r.address;
    for (const day of r.days || []) {
      out.push({
        cat,
        name,
        day: (day + shift + 7) % 7,
        time,
        dur,
        fmt: virtual ? "online" : hybrid ? "hybrid" : "in-person",
        loc: virtual ? "Online for now" : name,
        addr: cleanAddr(street ? (r.formatted_address || [street, r.city, r.state].filter(Boolean).join(", ")) : `${r.city || "Twin Cities"}, MN`),
        lat: +r.latitude,
        lng: +r.longitude,
        types: [],
        notes: "Listed by SobaSearch, a meeting directory. Check with the group before you go.",
        url: "https://sobasearch.com" + (r.detail_url || ""),
        approx: virtual || !street || undefined,
        region: r.city || "Twin Cities",
        live: true,
        verified: true,
      });
    }
  }
  return out;
}

async function fetchSoba() {
  const lists = [];
  const stopAt = Date.now() + 12000; // the function has 30s; never spend most of it here
  for (const [q, want] of SOBA_PROGRAMS) {
    if (Date.now() > stopAt) break;
    try {
      const d = await getJSON(SOBA_URL + encodeURIComponent(q), 5000);
      lists.push(normalizeSoba(d.data, want));
    } catch (e) {
      if (/HTTP 429/.test(e.message)) break; // asked too often: keep what we have
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!lists.length) throw new Error("sobasearch: no answers");
  return lists.flat();
}

function isCityOnlyAddr(addr) {
  const a = cleanAddr(addr);
  if (!a) return true;
  if (
    /^(twin cities|minneapolis|st\.?\s*paul|saint paul|edina|bloomington|richfield|roseville|brooklyn park|maple grove|plymouth|minnetonka|eagan|burnsville|woodbury|apple valley|blaine|coon rapids|anoka|shakopee|eden prairie|hopkins|st\.?\s*louis park)(,|\s)/i.test(
      a
    ) &&
    !/\d/.test(a)
  )
    return true;
  if (/^[A-Za-z .'-]+, MN$/i.test(a)) return true;
  return false;
}

// Filterable access/identity attributes. Separate from `types` because that list
// is trimmed to 4 labels for display — a wheelchair-accessible Spanish meeting
// could lose the very attribute someone is filtering on. Built from the full
// code list, never truncated.
const FLAG_CODES = {
  X: "Wheelchair", WC: "Wheelchair", HE: "Spanish", SP_LANG: "Spanish",
  LGBTQ: "LGBTQ", GL: "LGBTQ", POC: "People of Color",
  W: "Women", M: "Men", B: "Beginners", BEG: "Beginners",
  Y: "Young People", BV: "Babysitting", ASL: "ASL",
};
function flagTypes(codes) {
  const out = new Set();
  for (const c of codes || []) {
    const f = FLAG_CODES[c];
    if (f) out.add(f);
  }
  return [...out];
}

function labelTypes(codes, map) {
  const out = [];
  const seen = new Set();
  for (const c of codes || []) {
    if (TSML_HIDE.has(c)) continue;
    const lab = map[c];
    if (!lab || lab === "Online" || lab === "Virtual" || seen.has(lab)) continue;
    // Temp closed handled by caller
    if (lab === "Temp. closed") continue;
    seen.add(lab);
    out.push(lab);
  }
  // Open/Closed first — most useful for first-timers
  out.sort((a, b) => {
    const rank = (t) => (/^Open$/i.test(t) ? 0 : /^Closed$/i.test(t) ? 1 : 2);
    return rank(a) - rank(b);
  });
  return out.slice(0, 4);
}

function normalizeAA(rows, cat = "AA") {
  const out = [];
  for (const m of rows) {
    if (String(m.attendance_option || "").toLowerCase() === "inactive") continue;
    const types = Array.isArray(m.types) ? m.types : [];
    // skip temporarily closed
    if (types.includes("TC")) continue;

    const lat = parseFloat(m.latitude),
      lng = parseFloat(m.longitude);
    const ao = (m.attendance_option || "").toLowerCase();
    let fmt = "in-person";
    if (ao === "online" || (types.includes("ONL") && !lat)) fmt = "online";
    else if (ao === "hybrid") fmt = "hybrid";
    else if (types.includes("ONL")) fmt = "hybrid";

    const labels = labelTypes(types, TSML_TYPES);
    const flags = flagTypes(types);
    const addr = cleanAddr(m.formatted_address || m.region || "Minneapolis area");
    const approx =
      fmt === "online" ||
      String(m.approximate).toLowerCase() === "yes" ||
      isCityOnlyAddr(addr);

    let loc = m.location || m.region || cat + " Group";
    if (/no meeting place/i.test(loc)) loc = m.region || "Address not public";
    if (fmt === "online" && (!loc || /minneapolis|st\.?\s*paul|online/i.test(loc))) {
      loc = "Online meeting";
    }

    const notes = cleanText(m.notes);
    const door = cleanText(m.location_notes);

    // national feeds (Refuge, Buddhist, Dharma, CMA) write each time in the
    // meeting's own zone — "5am PT" was showing as 5 AM here instead of 7
    let day = typeof m.day === "number" ? m.day : Number(m.day) || 0;
    let time = hhmm(m.time);
    const shiftH = hoursToCentral(m.timezone);
    if (shiftH) {
      let mins = +time.slice(0, 2) * 60 + +time.slice(3) + shiftH * 60;
      if (mins < 0) { mins += 1440; day = (day + 6) % 7; }
      if (mins >= 1440) { mins -= 1440; day = (day + 1) % 7; }
      time = String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    }

    out.push({
      cat,
      name: cleanText(m.name) || cat + " Meeting",
      day,
      time,
      dur: m.end_time ? durMins(hhmm(m.time), hhmm(m.end_time)) : 60,
      fmt,
      approx: approx || undefined,
      loc,
      addr: fmt === "online" ? (addr && !isCityOnlyAddr(addr) ? addr : "Online") : addr,
      lat: isFinite(lat) ? lat : null,
      lng: isFinite(lng) ? lng : null,
      types: labels,
      flags: flags.length ? flags : undefined,
      notes: notes || undefined,
      door: door || undefined,
      url: m.conference_url || m.url || undefined,
      region: m.region || undefined,
      live: true,
      verified: true,
    });
  }
  return out;
}

function normalizeNA(rows) {
  const out = [];
  for (const r of rows) {
    const lat = parseFloat(r.latitude),
      lng = parseFloat(r.longitude);
    const wd = parseInt(r.weekday_tinyint, 10); // 1=Sun..7=Sat
    const day = isNaN(wd) ? 0 : (wd - 1 + 7) % 7;
    const vt = parseInt(r.venue_type, 10); // 1=in-person 2=virtual 3=hybrid
    const fmt = vt === 2 ? "online" : vt === 3 ? "hybrid" : "in-person";
    const dur = r.duration_time ? durMins("00:00", hhmm(r.duration_time)) : 60;
    const codes = String(r.formats || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (codes.includes("TC")) continue;
    const labels = labelTypes(codes, NA_FORMATS);
    const flags = flagTypes(codes);

    const street = [r.location_street, r.location_municipality, r.location_province]
      .filter(Boolean)
      .join(", ");
    const addr = cleanAddr(street || r.location_municipality || "Minnesota");
    const approx = fmt === "online" || isCityOnlyAddr(addr) || !r.location_street;
    const placeText = /^\s*(n\/?a|tbd|none)\s*$/i.test(r.location_text || "") ? "" : r.location_text;
    let loc = placeText || r.location_street || r.location_municipality || "NA Group";
    if (fmt === "online") loc = placeText || "Online meeting";

    const notes = cleanText(r.comments || r.location_info || "");

    out.push({
      cat: "NA",
      name: cleanText(r.meeting_name) || "NA Meeting",
      day,
      time: hhmm(r.start_time),
      dur: dur || 60,
      fmt,
      approx: approx || undefined,
      loc,
      addr: fmt === "online" ? "Online" : addr,
      lat: isFinite(lat) ? lat : null,
      lng: isFinite(lng) ? lng : null,
      types: labels,
      flags: flags.length ? flags : undefined,
      notes: notes || undefined,
      url: r.virtual_meeting_link || r.conference_url || undefined,
      live: true,
      verified: true,
    });
  }
  return out;
}

// "Squad # 5 Group" / "Squad 5" / "Prospect Park AA Group" / "Prospect Park Group"
function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(a\.?a\.?|n\.?a\.?|al-?anon|afg|group|grp|meeting|squad|sq\.?|#|the|of|and|&)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function placeKey(m) {
  if (m.lat != null && m.lng != null && !m.approx) {
    return `${m.lat.toFixed(3)},${m.lng.toFixed(3)}`;
  }
  return String(m.loc || m.addr || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 48);
}

function slotKey(m) {
  // same fellowship + day + time + block = almost certainly the same meeting
  // listed twice (Mpls intergroup + statewide AA)
  return `${m.cat}|${m.day}|${m.time}|${placeKey(m)}`;
}

function fuzzyNameKey(m) {
  return `${m.cat}|${m.day}|${m.time}|${nameKey(m.name)}`;
}

function quality(m) {
  return (
    (m.types && m.types.length ? m.types.length : 0) +
    (m.door ? 3 : 0) +
    (m.notes ? 2 : 0) +
    (m.url ? 1 : 0) +
    (m.approx ? 0 : 2) +
    (m.addr && m.addr !== "Online" && /\d/.test(m.addr) ? 1 : 0) +
    // prefer Open labeled when tied
    (m.types && m.types.some((t) => /^open$/i.test(t)) ? 0.5 : 0)
  );
}

function prefer(a, b) {
  return quality(a) >= quality(b) ? a : b;
}

function dedupeMeetings(list) {
  // Pass 1: same place + slot
  const bySlot = new Map();
  for (const m of list) {
    const k = slotKey(m);
    bySlot.set(k, bySlot.has(k) ? prefer(bySlot.get(k), m) : m);
  }
  let rows = [...bySlot.values()];

  // Pass 2: same fuzzy name + day + time (different loc string, same meeting)
  // only collapse if places are close or one is approx
  const byName = new Map();
  for (const m of rows) {
    const k = fuzzyNameKey(m);
    if (!byName.has(k)) {
      byName.set(k, m);
      continue;
    }
    const other = byName.get(k);
    const near =
      m.lat != null &&
      other.lat != null &&
      Math.abs(m.lat - other.lat) < 0.02 &&
      Math.abs(m.lng - other.lng) < 0.02;
    if (near || m.approx || other.approx) {
      byName.set(k, prefer(other, m));
    } else {
      // different places, keep both under a unique key
      byName.set(k + "|" + placeKey(m), m);
    }
  }
  return sameRoomRepeats([...byName.values()]);
}

// Pass 3: the two feeds spell the same meeting differently ("Squad 1-G Bryant
// Ave. Group" vs "Squad 1G", "Beltline Mon. 5:00 Mens" vs "Beltline Monday 5PM
// Men's"). Alano clubs run several meetings at the same hour in different
// rooms, so the names have to agree, not just the place and time.
const GENERIC = new Set("open closed discussion big book study step steps speaker men mens women womens noon morning night evening meditation beginners beginner newcomers newcomer literature hybrid online".split(" "));
function nameTokens(name) {
  return new Set(
    nameKey(String(name || "").replace(/'/g, "").replace(/\bnite\b/gi, "night").replace(/(\d)-([a-z])\b/gi, "$1$2"))
      .split(" ")
      .filter((t) => t && !/^\d+(am|pm)?$/.test(t) && !/^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|rsday|urday|sday)?$/.test(t) && !/^(am|pm|s|ave|st|sq)$/.test(t))
  );
}
function sameMeetingName(a, b) {
  const A = nameTokens(a), B = nameTokens(b);
  if (!A.size || !B.size) return false;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  if (both / (A.size + B.size - both) >= 0.5) return true;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  return both === small.size && [...small].some((t) => !GENERIC.has(t)) && big.size > 0;
}
function sameRoomRepeats(rows) {
  const groups = new Map();
  for (const m of rows) {
    const k = `${m.cat}|${m.day}|${m.time}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const out = [];
  for (const g of groups.values()) {
    const kept = [];
    for (const m of g) {
      const inPerson = m.fmt !== "online" && !m.approx && m.lat != null && m.lng != null;
      const i = inPerson
        ? kept.findIndex((o) => o.fmt !== "online" && !o.approx && o.lat != null &&
            Math.abs(o.lat - m.lat) < 0.0025 && Math.abs(o.lng - m.lng) < 0.003 && sameMeetingName(o.name, m.name))
        : -1;
      if (i >= 0) kept[i] = prefer(kept[i], m);
      else kept.push(m);
    }
    out.push(...kept);
  }
  return out;
}

module.exports = async (req, res) => {
  const sources = [];
  let meetings = [];

  // start the newer feeds alongside the main ones, not after them
  const extrasP = Promise.allSettled(EXTRA_TSML.map((f) => getJSON(f.url)));
  const moreP = Promise.allSettled([getJSON(SA_URL), fetchSoba(), fetchSAA(), fetchGA(), fetchNarAnon()]);
  const [aa, na, aamn, alanon, dharma, refuge, buddhist] = await Promise.allSettled([
    getJSON(AA_URL),
    getJSON(NA_URL),
    fetchAAMinnesota(),
    getJSON(ALANON_URL),
    getJSON(DHARMA_URL),
    getJSON(REFUGE_URL),
    getJSON(BUDDHIST_URL),
  ]);
  const extras = await extrasP;
  const [sa, soba, saa, ga, naranon] = await moreP;

  function take(label, result, list) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      sources.push({ name: label, count: list.length, ok: true });
      meetings = meetings.concat(list);
    } else {
      sources.push({ name: label, count: 0, ok: false });
    }
  }

  if (aa.status === "fulfilled" && Array.isArray(aa.value)) {
    const list = normalizeAA(aa.value).filter((x) => x.lat && x.lng && inMetro(x));
    take("AA Minneapolis Intergroup", aa, list);
  } else take("AA Minneapolis Intergroup", aa, []);

  if (aamn.status === "fulfilled" && Array.isArray(aamn.value)) {
    const list = normalizeAA(aamn.value).filter((x) => x.lat && x.lng && inMetro(x));
    take("aaMinnesota (St Paul + metro)", aamn, list);
  } else take("aaMinnesota (St Paul + metro)", aamn, []);

  if (alanon.status === "fulfilled" && Array.isArray(alanon.value)) {
    const list = normalizeAA(alanon.value, "Al-Anon").filter(
      (x) => x.lat && x.lng && inMetro(x)
    );
    take("Al-Anon MN South Area", alanon, list);
  } else take("Al-Anon MN South Area", alanon, []);

  if (dharma.status === "fulfilled" && Array.isArray(dharma.value)) {
    const list = normalizeAA(dharma.value, "Dharma").filter(
      (x) => x.lat && x.lng && inMetro(x)
    );
    take("Recovery Dharma (meditation)", dharma, list);
  } else take("Recovery Dharma (meditation)", dharma, []);

  if (na.status === "fulfilled" && Array.isArray(na.value)) {
    const list = normalizeNA(na.value).filter((x) => x.lat && x.lng && inMetro(x));
    take("NA Minnesota (BMLT)", na, list);
  } else take("NA Minnesota (BMLT)", na, []);

  // Buddhist Recovery Network re-lists every Refuge meeting; keep one copy
  const refugeKeys = new Set();
  const meetKey = (x) => `${x.day}|${x.time}|${x.name.toLowerCase()}`;
  if (refuge.status === "fulfilled" && Array.isArray(refuge.value)) {
    const list = normalizeAA(refuge.value, "Refuge").filter(
      (x) => (x.lat && x.lng && inMetro(x)) || (x.approx && looksCentralTime(x.name))
    );
    list.forEach((x) => refugeKeys.add(meetKey(x)));
    take("Refuge Recovery", refuge, list);
  } else take("Refuge Recovery", refuge, []);

  if (buddhist.status === "fulfilled" && Array.isArray(buddhist.value)) {
    const list = normalizeAA(buddhist.value, "Buddhist").filter(
      (x) => ((x.lat && x.lng && inMetro(x)) || (x.approx && looksCentralTime(x.name))) && !refugeKeys.has(meetKey(x))
    );
    take("Buddhist Recovery Network", buddhist, list);
  } else take("Buddhist Recovery Network", buddhist, []);

  EXTRA_TSML.forEach((f, i) => {
    const r = extras[i];
    const ok = r.status === "fulfilled" && Array.isArray(r.value);
    const list = ok ? normalizeAA(r.value, f.cat).filter((x) => x.lat && x.lng && inMetro(x)) : [];
    take(f.label, r, list);
  });

  take("Sexaholics Anonymous Twin Cities", sa,
    sa.status === "fulfilled" ? normalizeSA(sa.value).filter((x) => x.lat && x.lng && inMetro(x)) : []);
  take("Sex Addicts Anonymous (SAA)", saa,
    saa.status === "fulfilled" ? saa.value.filter((x) => inMetro(x)) : []);
  take("Gamblers Anonymous", ga,
    ga.status === "fulfilled" ? ga.value.filter((x) => inMetro(x)) : []);
  take("Nar-Anon", naranon,
    naranon.status === "fulfilled" ? naranon.value.filter((x) => inMetro(x)) : []);
  take("SobaSearch (OA, CoDA, ACA, SMART, CR, MA, EDA)", soba,
    soba.status === "fulfilled" ? soba.value.filter((x) => inMetro(x)) : []);

  const before = meetings.length;
  meetings = dedupeMeetings(meetings);
  meetings.sort(
    (a, b) => a.day - b.day || a.time.localeCompare(b.time) || a.name.localeCompare(b.name)
  );

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    updated: new Date().toISOString(),
    sources,
    deduped: before - meetings.length,
    meetings,
  });
};
