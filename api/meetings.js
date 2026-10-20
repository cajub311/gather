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
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

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

// Emotions Anonymous: a site search widget. Its settings (ajax URL + tokens) are
// a JSON blob on the page; the list has city/day/time, the street address is on
// each meeting's own page, and the pin comes from the Census geocoder.
const EA_PAGE = "https://emotionsanonymous.org/find-an-ea-meeting/usa-database/search-tool.html";

async function fetchEA() {
  const page = await fetch(EA_PAGE, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!page.ok) throw new Error(`ea page HTTP ${page.status}`);
  const cfgM = (await page.text()).match(/fdpUserProfileSearch\((\{[\s\S]*?\})\);/);
  if (!cfgM) throw new Error("ea search settings not found");
  const cfg = JSON.parse(cfgM[1]);
  const r = await fetch(new URL(cfg.ajaxUrl, EA_PAGE), {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: EA_PAGE,
    },
    body: new URLSearchParams({ page: 1, ...cfg.params, query: "", qtype: "" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`ea list HTTP ${r.status}`);
  const mn = ((await r.json()).data || []).filter((x) => /\(MN\)/.test(x.profile?.["13647360"]?.value || ""));
  const field = (html, label) => {
    const m = html.match(new RegExp(`<strong>${label}[^<]*</strong>\\s*</div>\\s*<div class="info-row__content">([\\s\\S]*?)</div>`));
    return m ? cleanText(m[1]).replace(/&#0*39;/g, "'").replace(/&amp;/g, "&") : "";
  };
  const rows = await Promise.all(
    mn.slice(0, 20).map(async (x) => {
      const url = `${EA_PAGE}?get_id=${x.detailsGetId}`;
      const html = await (await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) })).text();
      const addr = field(html, "Meeting Location Address");
      if (!/\b55[0-5]\d\d\b/.test(addr + " " + field(html, "Zip Code"))) return null; // metro ZIPs only
      const day = WEEKDAYS.indexOf((field(html, "Meeting Day").match(/\w+day/i) || [""])[0].toLowerCase());
      const tm = field(html, "Meeting Time").match(/(\d{1,2}):(\d{2})\s*(AM|PM)(?:[^\d]+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
      if (day < 0 || !tm || !addr) return null;
      const h = (+tm[1] % 12) + (/pm/i.test(tm[3]) ? 12 : 0);
      const end = tm[4] ? ((+tm[4] % 12) + (/pm/i.test(tm[6]) ? 12 : 0)) * 60 + +tm[5] : 0;
      const ll = await censusPin(addr).catch(() => null);
      if (!ll) return null;
      const online = /^yes/i.test(field(html, "Is Internet Required"));
      const notes = field(html, "Additional Meeting Information");
      return {
        cat: "EA",
        name: `Emotions Anonymous — ${field(html, "City")}`,
        day,
        time: String(h).padStart(2, "0") + ":" + tm[2],
        dur: end > h * 60 + +tm[2] ? end - h * 60 - +tm[2] : 60,
        fmt: online ? "online" : "in-person",
        loc: field(html, "Name of Location Where the Meeting is Held") || "EA Group",
        addr: addr.replace(/,?\s*(?:MN|Minnesota)\s+\d{5}(?:-\d{4})?$/i, ""),
        lat: +ll[0].toFixed(5),
        lng: +ll[1].toFixed(5),
        types: [],
        notes: notes || undefined,
        url,
        live: true,
        verified: true,
      };
    })
  );
  return rows.filter(Boolean);
}

// LifeRing and Women for Sobriety list meetings on Pathminder sites: server
// HTML, 25 per page, each row carrying its next start in UTC. Nearly all are
// online and open to anyone (kept at waking Central hours); in-person rows are
// kept only in Minnesota, pinned to their ZIP since the room is shared by email.
// Families Anonymous lists groups only in PDF directories, so its one Twin
// Cities group is copied by hand. Source: "1. US In-Person Directory 10.15.26"
// on familiesanonymous.org/meetings/meeting-directories/ (re-check it when
// refreshing api/_backup.json).
const FA_ROOMS = [
  { cat: "FA", name: "Families Anonymous — Summit Church (group 2188)", day: 3, time: "17:30", dur: 60, fmt: "in-person",
    loc: "Summit Church", addr: "845 Summit Ave, St Paul", lat: 44.94144, lng: -93.13551, types: ["Open"],
    door: "Enter via the east parking lot off Summit, Door D. No meeting Thanksgiving week.",
    url: "https://familiesanonymous.org/meetings/meeting-directories/", listed: "2026-10-15", live: true, verified: true },
];

// FA's online groups, from "2. Virtual US Canada 10.13.26" in the same
// directory: [day, Central time, group's home, group #]. The PDF holds Zoom
// links and passcodes, so each row points to the directory instead.
const FA_ONLINE_LISTED = "2026-10-13";
const FA_ONLINE = [
  [0,"11:00","Bradenton, FL",2177], [0,"16:30","Marlboro, NJ",2187], [0,"19:00","Huntley, IL",157],
  [0,"19:00","Des Plaines, IL",162], [1,"18:00","Miami, FL",134], [1,"18:00","Antigo, WI",2186],
  [1,"18:00","Glenville, NY",899], [1,"18:00","Syosset, NY",1974], [1,"18:15","Roswell, GA",1906],
  [1,"18:30","Mount Laurel, NJ",2119], [1,"18:30","Annandale, VA",874], [1,"18:30","Lawrenceville, NJ",665],
  [1,"18:30","Syracuse, NY",1301], [1,"18:30","Lafayette Hill, PA",2105], [1,"19:00","Chandler, TX",2176],
  [1,"19:00","New Lenox, IL",1196], [1,"19:00","Edmond, OK",1806], [1,"19:00","Buffalo Grove, IL",2023],
  [1,"19:00","Gurnee, IL",177], [1,"19:30","Park Ridge, IL",173], [1,"19:30","Canada",1444],
  [1,"21:00","Torrance, CA",121], [2,"17:00","Spanish-speaking",2153], [2,"17:15","Boca Raton, FL",1318],
  [2,"17:30","Franklin, MA",2159], [2,"18:00","Suffield, CT",2038], [2,"18:00","Chicago - Near North, IL",2204],
  [2,"18:00","Charlottesville, VA",1561], [2,"18:15","Tenafly, NJ",1533], [2,"18:30","Milford, CT",788],
  [2,"18:30","Bradenton, FL",2056], [2,"19:00","Glencoe, IL",2027], [2,"19:00","Rock Island, IL",2101],
  [2,"19:00","McKinney, TX",1391], [2,"19:00","Dallas, TX",631], [2,"21:00","Redlands, CA",641],
  [2,"21:00","Ridgecrest, CA",1979], [3,"11:00","Jupiter, FL",2191], [3,"13:00","Canada",1833],
  [3,"16:30","Shallotte, NC",2030], [3,"17:30","Willoughby, OH",1840], [3,"18:00","Bradenton, FL",2205],
  [3,"18:00","Louisville, KY",2082], [3,"18:00","Laurel, MD",1739], [3,"18:00","Hauppauge, NY",2068],
  [3,"18:00","Henrico County - Lakeside, VA",1978], [3,"18:00","Colts Neck, NJ",976], [3,"18:30","Mahwah, NJ",1735],
  [3,"18:45","Cherry Hill, NJ",1345], [3,"19:00","Franklin and Nashville, TN",2108],
  [3,"19:30","Arlington Hts., IL",171], [3,"20:30","Vancouver, Canada",2116],
  [3,"21:00","San Luis Obispo Area, CA",2149], [4,"16:30","Parkland, FL",1831], [4,"18:00","E. Ellenton, FL",2185],
  [4,"18:00","St. Augustine, FL",2200], [4,"18:00","Fort Myers, FL",1996], [4,"18:00","Buckhead, GA",1639],
  [4,"18:00","Birmingham, MI",1615], [4,"18:00","Summit, NJ",252], [4,"18:00","Chattanooga, TN",337],
  [4,"19:00","Dallas, TX",2085], [4,"19:00","Grapevine, TX",1686], [4,"19:30","Fort Collins, CO",2136],
  [5,"10:00","Skokie, IL",831], [5,"18:15","Massapequa, NY",270], [5,"18:15","Englewood, NJ",1152],
  [5,"19:30","Glenview, IL",478], [6,"08:30","Amityville, NY",279], [6,"09:30","Bloomfield, CT",1187],
  [6,"12:30","Santa Barbara, CA",1346],
].map(([day, time, home, grp]) => ({
  cat: "FA", name: `Families Anonymous — ${home} (group ${grp})`, day, time, dur: 60, fmt: "online",
  types: /^Spanish/.test(home) ? ["Open", "Spanish"] : ["Open"],
  notes: "Zoom link or contact is in FA's Virtual Directory PDF. Some groups meet only on certain weeks.",
  url: "https://familiesanonymous.org/meetings/meeting-directories/", listed: FA_ONLINE_LISTED, live: true, verified: true,
}));

const PATHMINDER = [
  { cat: "LifeRing", label: "LifeRing Secular Recovery", base: "https://meetings.lifering.org", types: ["Secular"] },
  { cat: "WFS", label: "Women for Sobriety", base: "https://meetings.womenforsobriety.org", types: ["Women", "Secular"] },
  // SMART's list stays empty until a city is searched (50 miles; online = ones run from nearby)
  { cat: "SMART", label: "SMART Recovery", base: "https://meetings.smartrecovery.org", types: [], near: "Minneapolis, MN",
    // same names as SobaSearch's copies, so the two merge instead of doubling
    name: (x, city) => (/family/i.test(x.title) ? "SMART Family & Friends" : "SMART Recovery") + (city ? ` – ${city}` : " online") },
];
// ZIP centers (OpenStreetMap) for rooms with no street number to geocode
const ZIP_PINS = { 55105: [44.935, -93.1666], 55305: [44.9529, -93.4264], 55391: [44.9741, -93.5066] };

async function fetchPathminder(site) {
  // own cleaner: cleanText splits glued words, and "LifeRing" is one
  const plain = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
  const get = async (path) => {
    const r = await fetch(site.base + path, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`${site.cat} HTTP ${r.status}`);
    return r.text();
  };
  const scopeRows = async (scope) => {
    const first = await get(site.near
      ? `/meetings/?location=${encodeURIComponent(site.near)}&coordinates=50&finder_form=true&scope=${scope}`
      : `/meetings/?scope=${scope}`);
    const n = +((first.match(/Found (\d+) meetings/) || [])[1] || 0);
    // a city search ignores page=2, so it keeps its first 25
    const pages = site.near ? 1 : Math.min(Math.max(1, Math.ceil(n / 25)), 12);
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => get(`/meetings/?scope=${scope}&page=${i + 2}`)));
    return [first, ...rest].flatMap((t) => t.split(/<a[^>]+href="\/meetings\/(?=\d+\/\?fromlist)/).slice(1).map((b) => b.slice(0, 7000)));
  };
  const parse = (b) => {
    const utc = (b.match(/data-utc="([^"]+)"/) || [])[1];
    const md = (b.split(/d-none d-md-block text-center">/)[1] || "").split("</span>")[0];
    const [title = "", program = "", audience = ""] = md.split(/<br\s*\/?>/).map(plain);
    if (!utc || !title) return null;
    return { id: b.match(/^\d+/)[0], ...utcToCentral(utc), title, program, audience, online: /fa-video/.test(b.slice(0, 2500)) };
  };
  const row = (x, extra, city) => ({
    cat: site.cat,
    name: site.name ? site.name(x, city) : x.title,
    day: x.day,
    time: x.time,
    dur: 60,
    types: [...site.types, ...(/family/i.test(x.title) ? ["Family & friends"] : []),
      ...x.audience.split(/,\s*/).filter((t) => t && !/^(english|all are welcome)$/i.test(t))],
    notes: (site.name ? [x.title, x.program].filter(Boolean).join(" · ") : x.program) || undefined,
    url: `${site.base}/meetings/${x.id}/`,
    live: true,
    verified: true,
    ...extra,
  });
  // each its own loc: dedupe treats same program + slot + place as one meeting
  const online = (x) => ({ fmt: "online", approx: true, loc: `${site.label} online #${x.id}`, addr: "Online", lat: null, lng: null });
  const [global, local] = await Promise.all([scopeRows("only"), scopeRows("hide")]);
  const out = global.map(parse).filter((x) => x && x.time >= "06:00" && x.time <= "22:00").map((x) => row(x, online(x)));
  const mn = local.filter((b) => /Minnesota|Twin Cities|,\s*MN\b/.test(b)).map(parse).filter(Boolean);
  await Promise.all(mn.map(async (x) => {
    const page = plain(await get(`/meetings/${x.id}/`).catch(() => ""));
    // "Location <venue> <street>, <city>, MN 55343" — only the place, never the facilitators
    const at = !x.online && page.match(/Location\s+(.*?)\s*(\d+ [^,]+?)\s*,(?:\s*Suite [^,]+,)?\s*([^,]+?),\s*(?:MN|Minnesota),?\s*(\d{5})/);
    const ll = at && await censusPin(`${at[2].replace(/\bNicolett\b/i, "Nicollet")}, ${at[3]}, MN ${at[4]}`).catch(() => null);
    const zip = (page.match(/Location\s+[^|]*?,\s*MN,\s*(\d{5})/) || [])[1];
    if (ll) {
      out.push(row(x, { fmt: "in-person", loc: at[1] || at[3], addr: `${at[2]}, ${at[3]}`, lat: ll[0], lng: ll[1] }, at[3]));
    } else if (!x.online && ZIP_PINS[zip]) {
      const city = (page.match(/Location\s+([^,]+),\s*MN/) || [])[1] || "Twin Cities";
      out.push(row(x, { fmt: "in-person", approx: true, loc: `${city} (room shared by email)`, addr: `${city}, MN ${zip}`, lat: ZIP_PINS[zip][0], lng: ZIP_PINS[zip][1] }, city));
    } else if (x.online) out.push(row(x, online(x)));
  }));
  return out;
}

// National lists for programs with few or no Twin Cities rooms. Online rows
// are kept at waking Central hours; programs with hundreds online (DA, MA)
// keep only the ones run on Central Time, like Refuge/Buddhist above.
const CA_ONLINE_URL = "https://caws-api.azurewebsites.net/api/v1/meetings-tsml?area=Online";
const MA_PAGE = "https://marijuana-anonymous.org/meetings/";
const DA_BASE = "https://debtorsanonymous.org";
const GAMANON_URL = "https://gam-anon.org/meeting-directory/virtual-meetings";
const HA_URL = "https://heroinanonymous.org/meetings/";
const ZONE = { eastern: "America/New_York", est: "America/New_York", edt: "America/New_York", central: "America/Chicago",
  cst: "America/Chicago", cdt: "America/Chicago", mountain: "America/Denver", mst: "America/Denver", mdt: "America/Denver",
  pacific: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", az: "America/Phoenix", arizona: "America/Phoenix" };
const htmlText = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&apos;|&#x27;/g, "'").replace(/&#x28;/g, "(").replace(/&#x29;/g, ")")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const wakingCentral = (x) => x.time >= "06:00" && x.time <= "22:00";
// "7:00 PM" on day 4 in zone tz -> Central day + "HH:MM"
// a moment in UTC -> weekday and "HH:MM" in Central
function utcToCentral(utc) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(utc)).map((x) => [x.type, x.value])
  );
  return { day: WEEKDAYS.indexOf(p.weekday.toLowerCase()), time: `${p.hour}:${p.minute}` };
}
function clockToCentral(day, clock, tz) {
  const m = String(clock).match(/(\d{1,2}):(\d{2})\s*([ap])\.?m/i);
  if (!m || day < 0) return null;
  let mins = ((+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0)) * 60 + +m[2] + hoursToCentral(tz) * 60;
  if (mins < 0) { mins += 1440; day = (day + 6) % 7; }
  if (mins >= 1440) { mins -= 1440; day = (day + 1) % 7; }
  return { day, time: String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0") };
}
// every online row says "Online meeting"; dedupe would fold different meetings
// at the same hour into one, so each gets its own loc
function onlineOnly(list) {
  return list.filter((x) => x.fmt === "online" && wakingCentral(x))
    .map((x) => ({ ...x, approx: true, lat: null, lng: null, loc: `Online meeting · ${x.name}`, addr: "Online" }));
}
const getText = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

async function fetchCAOnline() {
  return onlineOnly(normalizeAA(await getJSON(CA_ONLINE_URL), "CA"));
}

async function fetchMA() {
  const m = (await getText(MA_PAGE)).match(/data-src=['"]([^'"]+)/);
  if (!m) throw new Error("ma data-src not found");
  const rows = await getJSON(new URL(m[1], MA_PAGE).href);
  return [
    ...normalizeAA(rows, "MA").filter((x) => x.fmt !== "online" && x.lat && x.lng && inMetro(x))
      .map((x) => ({ ...x, loc: x.loc.split(" - ").pop(), region: undefined })), // region is just "United States"
    ...onlineOnly(normalizeAA(rows.filter((r) => r.timezone === "America/Chicago"), "MA")),
  ];
}

async function fetchDA() {
  const out = [];
  // rooms: one table for the world; the state is only in each row's link
  const f2f = await getText(`${DA_BASE}/meeting-search-f2f/`);
  const rooms = [...f2f.matchAll(/href="\/meeting-search-detail\/\?mid=(\d+)[^"]*&sn=MN&gn=([^&"]+)/g)];
  for (const [, mid, gn] of rooms.slice(0, 10)) {
    const url = `${DA_BASE}/meeting-search-detail/?mid=${mid}&searchType=F2F`;
    const t = htmlText((await getText(url).catch(() => "")).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ""));
    const v = t.match(/Get Directions (.+?) MN (\d{5}) US (\w+day) (\d{1,2}:\d{2} [ap]m) to (\d{1,2}:\d{2} [ap]m)/i);
    if (!v) continue;
    const name = htmlText(gn);
    // "Unity Church - Unitarian 732 Holly Av St. Paul"; some give only a crossing
    const [, venue, street] = v[1].match(/^(.*?) (\d+ [^&]+)$/) || [, v[1], ""];
    const at = clockToCentral(WEEKDAYS.indexOf(v[3].toLowerCase()), v[4], "America/Chicago");
    const end = clockToCentral(0, v[5], "America/Chicago");
    const exact = street ? await censusPin(`${street} MN ${v[2]}`).catch(() => null) : null;
    const ll = exact || ZIP_PINS[v[2]];
    if (!at || !ll) continue;
    out.push({
      cat: "DA", name, ...at, dur: end ? durMins(at.time, end.time) : 60,
      fmt: /Hybrid meeting|Video/i.test(t.slice(0, t.indexOf("Get Directions"))) ? "hybrid" : "in-person",
      loc: venue, addr: street || v[1], approx: exact ? undefined : true, lat: +ll[0].toFixed(5), lng: +ll[1].toFixed(5),
      types: [], url, live: true, verified: true,
    });
  }
  // online: times shown in Central; a day name only on the first row of each day
  const virt = await getText(`${DA_BASE}/meeting-search-virtual/?mytz=Y&mytimezone=America%2FChicago`);
  let day = -1;
  const seen = new Set();
  for (const tr of virt.split(/<tr[\s>]/).slice(1)) {
    const td = tr.split(/<td[^>]*>/).slice(1);
    if (td.length < 4) continue;
    const dayCell = htmlText(td[0]);
    if (/day$/i.test(dayCell)) day = WEEKDAYS.indexOf(dayCell.toLowerCase());
    const nameCell = htmlText(td[2]);
    const clock = (htmlText(td[1]).match(/(\d{1,2}:\d{2} [ap]m) your time/) || [])[1];
    const mid = (td[2].match(/mid=(\d+)/) || [])[1];
    if (!/Central Time \(US\/CAN\)/.test(nameCell) || !clock || !mid) continue;
    const many = (nameCell.match(/Multiple Days: ([\w,]+)/) || [])[1];
    const days = many ? many.split(",").map((d) => WEEKDAYS.indexOf(d.toLowerCase())) : [day];
    const venue = htmlText(td[3]);
    for (const d of days) {
      const at = clockToCentral(d, clock, "America/Chicago");
      if (!at || seen.has(mid + "|" + at.day)) continue;
      seen.add(mid + "|" + at.day);
      out.push({
        cat: "DA", name: nameCell.split(" (")[0], ...at, dur: 60, fmt: "online", approx: true,
        loc: `Online meeting · DA ${mid}`, addr: /^phone/i.test(venue) ? "Phone meeting" : "Online", lat: null, lng: null,
        types: /^phone/i.test(venue) ? ["Phone"] : [], url: `${DA_BASE}/meeting-search-detail/?mid=${mid}&searchType=virtual`,
        live: true, verified: true,
      });
    }
  }
  return out.filter(wakingCentral);
}

async function fetchGamAnon() {
  const html = await getText(GAMANON_URL);
  const out = [];
  for (const item of html.split(/class="latestnews-item /).slice(1)) {
    const field = (n) => htmlText((item.match(new RegExp(`detail_jfield_${n} "[\\s\\S]*?<span class="detail_data">([\\s\\S]*?)</span>`)) || [])[1]);
    const title = htmlText((item.match(/<span>([^<]+)<\/span>\s*<\/a>/) || [])[1]);
    const href = (item.match(/href="(\/meeting-directory\/meeting-details\/[^"]+)"/) || [])[1];
    const zone = ZONE[(field(31).split(" ")[0] || "").toLowerCase()];
    const at = clockToCentral(WEEKDAYS.indexOf(field(1).toLowerCase()), field(27), zone);
    if (!at || !zone || !href) continue;
    const lang = field(34);
    out.push({
      cat: "Gam-Anon", name: `Gam-Anon online ${title.replace(/^\w+\s*/, "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())}`.trim(), ...at, dur: 60, fmt: "online",
      types: lang && !/^english$/i.test(lang) ? [lang] : [], url: new URL(href, GAMANON_URL).href, live: true, verified: true,
    });
  }
  return onlineOnly(out);
}

// Heroin Anonymous: one national table; rows can hold members' phone numbers
// and passcodes, so only the name, day and time are kept
async function fetchHA() {
  const html = await getText(HA_URL);
  const out = [];
  for (const tr of html.split(/<tr[\s>]/).slice(1)) {
    const td = tr.split(/<td[^>]*>/).slice(1).map(htmlText);
    if (td.length < 6 || !/^online$/i.test(td[5])) continue;
    const tz = ZONE[((td[2].match(/\b([PMCE][SD]T)\b|\((AZ)\b/i) || []).slice(1).find(Boolean) || "").toLowerCase()];
    const at = tz && clockToCentral(WEEKDAYS.indexOf(td[1].toLowerCase()), td[2], tz);
    if (!at) continue;
    out.push({ cat: "HA", name: td[0], ...at, dur: 60, fmt: "online", types: [], url: HA_URL, live: true, verified: true });
  }
  return onlineOnly(out);
}

// Dual Recovery Anonymous (dual diagnosis): ~30 US groups in a WordPress API,
// none in Minnesota, so only the ones you can join online. "about" text can
// hold Zoom passcodes and phone numbers; only name, day and time are kept.
const DRA_API = "https://draonline.org/wp-json/wp/v2";
const STATE_TZ = Object.fromEntries([
  ["America/New_York", "ct connecticut ma massachusetts pa pennsylvania vt vermont ny new-york nj new-jersey oh ohio nc north-carolina va virginia md maryland fl florida ga georgia me maine nh new-hampshire mi michigan"],
  ["America/Chicago", "il illinois mn minnesota wi wisconsin mo missouri ne nebraska tx texas ia iowa tn tennessee"],
  ["America/Denver", "ut utah co colorado"],
  ["America/Los_Angeles", "ca california wa washington or oregon"],
].flatMap(([tz, list]) => list.split(" ").map((st) => [st.replace("-", " "), tz])));
async function fetchDRA() {
  const [rows, days, kinds] = await Promise.all(["meetings", "day-of-meeting", "f2f-or-online"]
    .map((t) => getJSON(`${DRA_API}/${t}?per_page=100`)));
  const name = (list, ids) => (ids || []).map((id) => (list.find((x) => x.id === id) || {}).name || "");
  const out = [];
  for (const r of rows) {
    const d = name(days, r["day-of-meeting"]);
    const kind = name(kinds, r["f2f-or-online"]).join(" ");
    if (d.length !== 1 || !/online/i.test(kind)) continue; // skips the "display your meeting here" sample
    const meta = r.meta || {};
    const about = htmlText(meta["about-meeting"]);
    const st = String(meta["state-or-county"] || "").trim().toLowerCase();
    const zoneWord = (about.match(/\b([ECMP][SD]T)\b/) || [])[1];
    const tz = zoneWord ? ZONE[zoneWord.toLowerCase()] : STATE_TZ[st] || (/massclubs/.test(about) ? "America/New_York" : null);
    const [h, mi] = String(meta["time-of-meeting"] || "").split(":");
    const at = tz && h ? clockToCentral(WEEKDAYS.indexOf(d[0].toLowerCase()), `${+h % 12 || 12}:${mi} ${+h >= 12 ? "pm" : "am"}`, tz) : null;
    if (!at) continue;
    const city = /hybrid/i.test(kind) && meta.city ? ` (${htmlText(meta.city).replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())}, also in person)` : "";
    out.push({
      cat: "DDA", name: htmlText(r.title && r.title.rendered) + city, ...at, dur: 60, fmt: "online",
      types: ["Dual Recovery Anonymous", "Dual diagnosis", ...(/ASL/.test(about) ? ["ASL"] : [])], url: r.link, live: true, verified: true,
    });
  }
  return onlineOnly(out);
}

// Celebrate Recovery's national Zoom group; the page says when it meets and
// hands out the link after an email sign-up
const CR_ONLINE_URL = "https://celebraterecovery.com/weekly-online-recovery-meetings/";
async function fetchCROnline() {
  const t = htmlText(await getText(CR_ONLINE_URL));
  const m = t.match(/every (\w+day) at (\d{1,2})(?::(\d\d))? ?([ap]m) ([ECMP][SD]T)/i);
  if (!m) throw new Error("cr online: meeting time not found on page");
  const at = clockToCentral(WEEKDAYS.indexOf(m[1].toLowerCase()), `${m[2]}:${m[3] || "00"} ${m[4]}`, ZONE[m[5].toLowerCase()]);
  if (!at) throw new Error("cr online: bad time");
  return [{
    cat: "CR", name: "Celebrate Recovery online group", ...at, dur: 60, fmt: "online", approx: true, lat: null, lng: null,
    loc: "Online meeting · Celebrate Recovery national", addr: "Online", types: ["Open", "Christian"],
    notes: "Sign up with your email on the page to get the Zoom link.", url: CR_ONLINE_URL, live: true, verified: true,
  }];
}

// Recovering Couples Anonymous, Survivors of Incest Anonymous and Workaholics
// Anonymous (a saved JSON file its finder reads) share the TSML format AA uses. Nearly all are online; each row carries its own zone.
const TSML_ONLINE = [
  ["RCA", "https://recovering-couples.org/wp-admin/admin-ajax.php?action=meetings"],
  ["SIA", "https://siawso.org/wp-admin/admin-ajax.php?action=meetings"],
  ["WA", "https://workaholics-anonymous.org/wp-content/meetings/sfdc_transformed_json_n8n_no_unscheduled_FINAL.json", waPrep],
];
// WA's file has no attendance field and puts a placeholder pin on virtual
// meetings, so mark them by their Zoom/phone details; keep English ones only
const WA_LANGS = /^(S|SP|RUS|HU|SK|POL|DE|FR|WA_Czech|WA_bilingual)$/;
function waPrep(rows) {
  return rows
    .filter((m) => !(m.types || []).some((t) => WA_LANGS.test(t)))
    .map((m) => (m.conference_url || m.conference_phone)
      ? { ...m, attendance_option: !m.location || /virtual/i.test(m.location) ? "online" : "hybrid" }
      : m);
}
async function fetchTSMLOnline([cat, url, prep = (r) => r]) {
  const rows = normalizeAA(prep(await getJSON(url)), cat);
  return [...rows.filter((x) => x.fmt !== "online" && x.lat && x.lng && inMetro(x)), ...onlineOnly(rows)];
}

// Nicotine Anonymous runs its meetings as The Events Calendar events, one per
// occurrence, each with "Language" and "Type" custom fields. A week of them is
// folded into weekly slots: Twin Cities rooms plus English online/phone meetings.
// Links, dial-in numbers and passcodes stay on the NicA event page. Their server
// answers one 50-event page at a time (~10 pages, 3s each), too slow for a page
// load, so scripts/refresh-saved-lists.cjs saves the result to api/_nica.json.
const NICA_API = "https://nicotine-anonymous.org/wp-json/tribe/events/v1/events";
// NicA turns away the plain Gather user agent, so ask like a browser does
const getNicA = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": CHROME_UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`nica HTTP ${r.status}`);
  return r.json();
};
async function fetchNicA() {
  const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
  const q = `?per_page=50&start_date=${ymd(new Date())}&end_date=${ymd(new Date(Date.now() + 6 * 864e5))}%2023:59:59`;
  const all = [await getNicA(`${NICA_API}${q}&page=1`)];
  for (let p = 2; p <= Math.min(all[0].total_pages || 1, 15); p++) all.push(await getNicA(`${NICA_API}${q}&page=${p}`));
  const field = (e, label) => Object.values(e.custom_fields || {}).find((c) => c.label === label)?.value || "";
  const seen = new Set(), out = [];
  for (const e of all.flatMap((r) => r.events || [])) {
    const at = utcToCentral(e.utc_start_date.replace(" ", "T") + "Z");
    const name = htmlText(e.title).replace(/\s+/g, " ").trim();
    const key = `${name}|${at.day}|${at.time}`;
    if (at.day < 0 || seen.has(key)) continue;
    seen.add(key);
    const dur = Math.round((Date.parse(e.utc_end_date + "Z") - Date.parse(e.utc_start_date + "Z")) / 60000) || 60;
    const topic = field(e, "Topic");
    const base = { cat: "NicA", name: /nicotine|nica/i.test(name) ? name : `Nicotine Anonymous — ${name}`, ...at,
      dur: dur > 0 && dur <= 180 ? dur : 60, types: topic ? [topic.replace(/ Meeting$/, "")] : [], url: e.url, live: true, verified: true };
    const v = e.venue || {};
    if (field(e, "Type") === "In-Person") {
      if (v.state !== "MN" && v.stateprovince !== "MN") continue;
      const ll = await censusPin(`${v.address}, ${v.city}, MN ${v.zip || ""}`).catch(() => null);
      if (!ll) continue;
      const room = { ...base, fmt: "in-person", loc: htmlText(v.venue), addr: `${v.address}, ${v.city}`,
        lat: +ll[0].toFixed(5), lng: +ll[1].toFixed(5) };
      if (inMetro(room)) out.push(room);
    } else if (field(e, "Language") === "English") {
      out.push({ ...base, fmt: "online", notes: "Join details are on the Nicotine Anonymous meeting page." });
    }
  }
  return [...out.filter((x) => x.fmt !== "online"), ...onlineOnly(out)];
}

let NICA_SAVED = { listed: "", rows: [] };
try { NICA_SAVED = require("./_nica.json"); } catch {}

// SLAA's online list only fills in inside a real browser, so it is copied on the
// Mac by scripts/refresh-slaa-online.mjs into api/_slaa-online.json as
// [day, clock, zone letter, name, platform, tags, SLAA listing ID]. Times are
// turned into Central here so daylight saving stays right.
const SLAA_ZONES = { E: "America/New_York", C: "America/Chicago", M: "America/Denver", P: "America/Los_Angeles",
  U: "UTC", L: "Europe/London", X: "Europe/Paris" };
const SLAA_TAGS = { O: "Open", C: "Closed", W: "Women", M: "Men", L: "LGBTQ", N: "Newcomer" };
let SLAA_SAVED = { listed: "", rows: [] };
try { SLAA_SAVED = require("./_slaa-online.json"); } catch {}
function slaaOnline() {
  return SLAA_SAVED.rows.map(([day, clock, zone, name, platform, tags, id]) => {
    const at = SLAA_ZONES[zone] && clockToCentral(day, clock, SLAA_ZONES[zone]);
    return at && {
      cat: "SLAA", name: `SLAA — ${name.replace(/^S\.?L\.?A\.?A\.?\s*[-—:]?\s+(?=\S)/i, "")} (${platform})`, ...at, dur: 60, fmt: "online",
      types: [...tags].map((t) => SLAA_TAGS[t]).filter(Boolean),
      notes: `Join details: search listing ID ${id} on SLAA's online meetings page.`,
      url: "https://slaafws.org/onlinemeetings/", listed: SLAA_SAVED.listed, live: true, verified: true,
    };
  }).filter(Boolean);
}

// Pills Anonymous lists meetings as plain text on two Wix pages: blocks of
// "ST - City / Day 7:00PM / Meeting Code: O / "Name" / ...". Rooms are kept in
// Minnesota; US online meetings are kept with their state's clock turned into
// Central. Contacts, links and passcodes are left on the PA page.
const PA_BASE = "https://www.pillsanonymous.org";
const PA_CODES = { O: "Open", C: "Closed", W: "Women", M: "Men", LGBT: "LGBTQ" };
function paBlocks(html) {
  const lines = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li|span)>/g, "\n").replace(/&ndash;|&#8211;/g, "-")
    .replace(/&[lr]dquo;|&#822[01];/g, '"').replace(/&[lr]squo;|&#821[67];/g, "'").replace(/\u200b/g, "")
    .split("\n").map(htmlText).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const head = line.match(/^([A-Z]{2}) [-–] (.+)$/);
    if (head) out.push({ st: head[1], city: head[2], lines: [] });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  return out.map((b) => {
    const when = b.lines.join(" ").match(/\b(Su|Mo|Tu|We|Th|Fr|Sa)\w*:? (\d{1,2})(?::(\d\d))?(?: ?- ?\d{1,2}(?::\d\d)?)? ?([AP])M(?:\s*\((\w+)\))?/i);
    const code = (b.lines.find((l) => /^Meeting Code:/i.test(l)) || "").replace(/^Meeting Code:\s*/i, "");
    const quoted = b.lines.find((l) => /^["“].+["”]$/.test(l));
    const day = when ? WEEKDAYS.findIndex((d) => d.startsWith(when[1].toLowerCase())) : -1;
    return {
      ...b, day, clock: when ? `${when[2]}:${when[3] || "00"} ${when[4]}m` : "", zone: when?.[5],
      name: quoted ? quoted.replace(/^["“]|["”]$/g, "") : "",
      types: code.split(/,\s*/).map((c) => PA_CODES[c.trim()]).filter(Boolean),
    };
  }).filter((b) => b.day >= 0 && b.clock);
}
async function fetchPA() {
  const [rooms, online] = await Promise.all([getText(`${PA_BASE}/find-a-meeting`), getText(`${PA_BASE}/find-a-virtual-meeting`)]);
  const out = [];
  for (const b of paBlocks(rooms).filter((x) => x.st === "MN")) {
    const i = b.lines.findIndex((l) => /,? MN \d{5}/.test(l));
    const at = clockToCentral(b.day, b.clock, "America/Chicago");
    const ll = i > 0 ? await censusPin(`${b.lines[i - 1]}, ${b.lines[i]}`).catch(() => null) : null;
    const zip = (b.lines[i] || "").match(/\d{5}/)?.[0];
    const pin = ll || ZIP_PINS[zip];
    if (!at || !pin) continue;
    const end = b.lines.join(" ").match(/\d{1,2}(?::\d\d)?-(\d{1,2})(?::(\d\d))? ?([AP])M/i);
    out.push({
      cat: "PA", name: b.name ? `Pills Anonymous — ${b.name}` : `Pills Anonymous — ${b.city}`, ...at,
      dur: end ? durMins(at.time, clockToCentral(0, `${end[1]}:${end[2] || "00"} ${end[3]}m`, "America/Chicago").time) : 60,
      fmt: "in-person", loc: b.city, addr: `${b.lines[i - 1]}, ${b.lines[i].replace(/,? MN \d{5}.*/, "")}`,
      approx: ll ? undefined : true, lat: +pin[0].toFixed(5), lng: +pin[1].toFixed(5), types: b.types,
      url: `${PA_BASE}/find-a-meeting`, live: true, verified: true,
    });
  }
  const usStart = online.indexOf("United States of America");
  if (usStart < 0) throw new Error("pa: US online section not found");
  for (const b of paBlocks(online.slice(usStart))) {
    const tz = b.zone ? ZONE[b.zone.toLowerCase()] : b.st === "AZ" ? "America/Phoenix" : STATE_TZ[b.st.toLowerCase()];
    const at = tz && clockToCentral(b.day, b.clock, tz);
    if (!at) continue;
    out.push({
      cat: "PA", name: `Pills Anonymous — ${b.name || b.city} (${b.city}, ${b.st})`, ...at, dur: 60, fmt: "online",
      types: b.types, notes: "Join details are on the Pills Anonymous virtual meeting page.",
      url: `${PA_BASE}/find-a-virtual-meeting`, live: true, verified: true,
    });
  }
  return [...out.filter((x) => x.fmt !== "online"), ...onlineOnly(out)];
}

// Recovery International (mental health self-help, Abraham Low method) keeps
// its meeting list in a public Google Sheet. Kept: weekly Twin Cities rooms and
// weekly Zoom/phone meetings open to anyone. Leaders' names, phones and Zoom
// links stay on RI's list; each row is named by RI's own meeting number.
const RI_SHEET = "https://docs.google.com/spreadsheets/d/1CxqeIiayBdvmH6Bk3UdjjTnkWLgwbru32ZXXc2gP4lo/export?format=csv";
const RI_PAGE = "https://www.recoveryinternational.org/meetings/";
function csvRows(text) {
  const rows = [[]];
  let f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { rows[rows.length - 1].push(f); f = ""; }
    else if (c === "\n") { rows[rows.length - 1].push(f); f = ""; rows.push([]); }
    else if (c !== "\r") f += c;
  }
  rows[rows.length - 1].push(f);
  return rows;
}
async function fetchRI() {
  const [head, ...rows] = csvRows(await getText(RI_SHEET));
  const col = (name) => head.findIndex((h) => h.trim().toLowerCase().startsWith(name));
  const [ID, TYPE, DAY, START, ZN, OFTEN, ADDR] = ["leader ref", "mtg type", "meeting day", "start time", "time zone", "occurrence", "address"].map(col);
  if ([ID, TYPE, DAY, START, ZN].some((i) => i < 0)) throw new Error("ri: sheet columns changed");
  const out = [];
  for (const r of rows) {
    const type = (r[TYPE] || "").replace(/\s+/g, " ").trim();
    if (!/^weekly$/i.test((r[OFTEN] || "").trim()) || /membership|chat/i.test(type)) continue;
    const clock = (r[START] || "").trim().replace(/^(\d{1,2})\s*([ap])/i, "$1:00$2");
    const tz = ZONE[(r[ZN] || "").trim().toLowerCase()];
    const at = tz && clockToCentral(WEEKDAYS.indexOf((r[DAY] || "").trim().toLowerCase()), clock, tz);
    if (!at) continue;
    const id = (r[ID] || "").trim();
    if (/zoom|phone/i.test(type)) {
      const how = /phone/i.test(type) ? "phone" : "Zoom";
      out.push({
        cat: "RI", name: `Recovery International — ${/newcomer/i.test(type) ? "newcomers' " : ""}${how} meeting ${id}`, ...at, dur: 90,
        fmt: "online", types: /literature/i.test(type) ? ["Literature"] : [],
        notes: "Join details are on Recovery International's meeting list.", url: RI_PAGE, live: true, verified: true,
      });
    } else if (/, MN\b/.test(r[ADDR] || "")) {
      const lines = r[ADDR].split("\n").map((l) => l.trim()).filter(Boolean);
      const ll = await censusPin(lines.slice(1).join(", ")).catch(() => null);
      const pin = ll || ZIP_PINS[(r[ADDR].match(/\b\d{5}\b/) || [])[0]];
      if (!pin || !inMetro({ lat: pin[0], lng: pin[1] })) continue;
      out.push({
        cat: "RI", name: `Recovery International — ${lines[0]}`, ...at, dur: 90, fmt: "in-person", loc: lines[0],
        addr: lines.slice(1).join(", ").replace(/,? MN \d{5}.*/, ""), approx: ll ? undefined : true,
        lat: +pin[0].toFixed(5), lng: +pin[1].toFixed(5), types: [], url: RI_PAGE, live: true, verified: true,
      });
    }
  }
  return [...out.filter((x) => x.fmt !== "online"), ...onlineOnly(out)];
}

// S-Anon (family and friends of sex addicts): its finder posts to a WordPress
// ajax action and gets back HTML blocks. Each block's "Add to Calendar" form
// holds the next date, time, place and the zone it's written in. Group emails
// and phone numbers are left on S-Anon's page.
const SANON_AJAX = "https://sanon.org/wp-admin/admin-ajax.php";
const SANON_PAGE = "https://sanon.org/find-a-meeting/";
async function sanonBlocks(fields) {
  const body = new URLSearchParams({ action: "meeting_areas_load_meetings", weekday: "", search: "", lang: "", time: "",
    special: "any", country: "", user_location: "0", location_selected: "0", city_state: "", ...fields });
  const r = await fetch(SANON_AJAX, { method: "POST", body, headers: { "User-Agent": CHROME_UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`s-anon HTTP ${r.status}`);
  return (await r.text()).split('<div class="meeting"').slice(1).map((b) => {
    const hidden = (n) => htmlText((b.match(new RegExp(`name="${n}" value="([^"]*)"`)) || [])[1]);
    const [, ymd, hh, mm] = hidden("date_start").match(/^(\d{4}-\d\d-\d\d) (\d\d):(\d\d)/) || [];
    const at = ymd && clockToCentral(new Date(`${ymd}T12:00:00Z`).getUTCDay(), `${+hh % 12 || 12}:${mm} ${+hh < 12 ? "am" : "pm"}`, hidden("timezone"));
    const end = hidden("date_end").match(/ (\d\d):(\d\d)/);
    return {
      at, name: htmlText((b.match(/class="title">([^<]*)/) || [])[1]), id: (b.match(/ID:<\/span><strong>([^<]+)/) || [])[1],
      place: htmlText((b.match(/fa-map-marker[^>]*><\/i>\s*<strong>([^<]*)/) || [])[1]),
      where: hidden("location").replace(/\s*USA & Canada\s*$/, ""), lang: htmlText((b.match(/Language:[\s\S]*?<strong>([^<]*)|Language:<\/span>\s*([^<]*)/) || [])[1]),
      dur: end ? Math.max(30, (+end[1] * 60 + +end[2] - (+hh * 60 + +mm) + 1440) % 1440) : 60,
      extra: htmlText((b.match(/class="additional_information">([^<]*)/) || [])[1]),
    };
  }).filter((x) => x.at && x.name);
}
async function fetchSAnon() {
  const [rooms, online] = await Promise.all([
    sanonBlocks({ city_state: "Minnesota-MN", type: "in_person" }),
    sanonBlocks({ type: "phone_web", lang: "English" }),
  ]);
  const out = [];
  for (const b of rooms) {
    const ll = await censusPin(b.where).catch(() => null);
    const pin = ll || ZIP_PINS[(b.where.match(/\b\d{5}\b/) || [])[0]];
    if (!pin || !inMetro({ lat: pin[0], lng: pin[1] })) continue;
    out.push({
      cat: "S-Anon", name: `S-Anon — ${b.name}`, ...b.at, dur: b.dur, fmt: "in-person", loc: b.place || b.where.replace(/,? MN .*/, ""),
      addr: b.where.replace(/,? MN \d{5}.*/, "").replace(/\s+/g, " "), approx: ll ? undefined : true,
      lat: +pin[0].toFixed(5), lng: +pin[1].toFixed(5), types: [],
      door: b.extra && !/@|\d{3}\D?\d{4}/.test(b.extra) ? b.extra : undefined, url: SANON_PAGE, live: true, verified: true,
    });
  }
  const seen = new Set();
  for (const b of online) {
    if (seen.has(b.id || b.name + b.at.day + b.at.time)) continue;
    seen.add(b.id || b.name + b.at.day + b.at.time);
    out.push({
      cat: "S-Anon", name: `S-Anon — ${b.name.replace(/^S-Anon\s+/i, "")}${b.id ? ` (${b.id})` : ""}`, ...b.at, dur: b.dur, fmt: "online", types: [],
      notes: "Join details are on S-Anon's meeting finder.", url: SANON_PAGE, live: true, verified: true,
    });
  }
  return [...out.filter((x) => x.fmt !== "online"), ...onlineOnly(out)];
}

// NA's online meetings live on their own BMLT server (virtual-na.org). Each row
// has its own zone; kept: English meetings set in US/Canada zones, at waking
// hours here. Phone numbers and access codes stay on virtual-na.org.
const NA_VIRTUAL = "https://bmlt.virtual-na.org/main_server/client_interface/json/?switcher=GetSearchResults" +
  "&data_field_key=id_bigint,meeting_name,weekday_tinyint,start_time,duration_time,time_zone,lang_enum,venue_type";
const NA_ZONES = /^(America\/(New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Toronto|Vancouver|Edmonton|Winnipeg|Regina|Halifax|Detroit|Boise|Indiana\/.+|Kentucky\/.+)|Pacific\/Honolulu)$/;
async function fetchNAVirtual() {
  const out = [];
  for (const r of await getJSON(NA_VIRTUAL)) {
    if (r.lang_enum !== "en" || r.venue_type !== "2" || !NA_ZONES.test(r.time_zone)) continue;
    const [h, mm] = String(r.start_time).split(":").map(Number);
    const at = clockToCentral((+r.weekday_tinyint + 6) % 7, `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`, r.time_zone);
    if (!at) continue;
    out.push({
      cat: "NA", name: cleanText(r.meeting_name) || "NA Meeting", ...at,
      dur: r.duration_time ? durMins("00:00", hhmm(r.duration_time)) || 60 : 60, fmt: "online", types: [],
      notes: "Join details are on NA's virtual meeting list.", url: "https://virtual-na.org/meetings/", live: true, verified: true,
    });
  }
  return onlineOnly(out);
}

// SLAA's finder is a Caspio search form: plain HTML that posts back to itself.
// Send the form's own fields with State = Minnesota and read each result's
// "Sunday 1:00 PM CT | name | Location | Address" block (contacts left out).
const SLAA_FORM = "https://c3gaf515.caspio.com/dp/54ce4000ebf69838cd594d3698e5";
async function fetchSLAA() {
  const form = await getText(SLAA_FORM);
  const body = new URLSearchParams();
  for (const [tag] of form.matchAll(/<input[^>]*>/g)) {
    const n = (tag.match(/name="([^"]+)"/) || [])[1];
    if (n && n !== "searchID") body.set(n, htmlText((tag.match(/value="([^"]*)"/) || [, ""])[1]));
  }
  if (!body.get("AppKey")) throw new Error("slaa: search form not found");
  body.set("Value2_1", "United States");
  body.set("Value3_1", "Minnesota");
  body.set("cbParamVirtual2", "Minnesota");
  body.set("searchID", "Search");
  const r = await fetch(SLAA_FORM, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Referer: "https://slaafws.org/meetings/" },
    body,
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`slaa HTTP ${r.status}`);
  const out = [];
  for (const rec of (await r.text()).split(/data-cb-name="DataCtnr"/).slice(1)) {
    const block = (rec.match(/gi == 'Group'\) \{\s*document[^=]*= '([\s\S]*?)';/) || [])[1];
    if (!block) continue; // intergroup rows are links to other lists
    const t = htmlText(block);
    const v = t.match(/(\w+day) (\d{1,2})(?::(\d\d))? ?([ap])m (?:CT|CST|CDT|Central)\b.*?MEETING \| (.+?) \(edit\) Location: (.+?) Address: (.+?),? Minnesota (\d{5})/i);
    if (!v) continue;
    const at = clockToCentral(WEEKDAYS.indexOf(v[1].toLowerCase()), `${v[2]}:${v[3] || "00"} ${v[4]}m`, "America/Chicago");
    const ll = await censusPin(`${v[7]} MN ${v[8]}`).catch(() => null);
    if (!at || !ll) continue;
    const head = rec.slice(0, 4000);
    out.push({
      cat: "SLAA", name: v[5], ...at, dur: 60, fmt: "in-person",
      loc: v[6], addr: v[7].replace(/\s+(Minneapolis|St\.? Paul|Eagan)$/i, ", $1"), lat: +ll[0].toFixed(5), lng: +ll[1].toFixed(5),
      types: [/Open Meeting \(/.test(head) ? "Open" : "Closed", /Women Only/.test(head) ? "Women" : ""].filter(Boolean),
      url: "https://slaafws.org/meetings/", live: true, verified: true,
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
  // ...unless one is for family and friends (SMART runs both in one room at once)
  return `${m.cat}|${m.day}|${m.time}|${placeKey(m)}${forFamily(m) ? "|family" : ""}`;
}
const forFamily = (m) => !!m.types?.includes("Family & friends");

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
            Math.abs(o.lat - m.lat) < 0.0025 && Math.abs(o.lng - m.lng) < 0.003 && forFamily(o) === forFamily(m) && sameMeetingName(o.name, m.name))
        : -1;
      if (i >= 0) kept[i] = prefer(kept[i], m);
      else kept.push(m);
    }
    out.push(...kept);
  }
  return out;
}

// Backup copy for feeds that block Vercel's servers (see api/events.js BACKUP)
let BACKUP = {};
try { BACKUP = require("./_backup.json"); } catch {}
const backupFresh = () => BACKUP.taken && Date.now() - Date.parse(BACKUP.taken) < 75 * 864e5;
async function withBackup(label, fn) {
  try {
    return await fn();
  } catch (e) {
    const saved = backupFresh() && BACKUP.meetings && BACKUP.meetings[label];
    if (!saved) throw e;
    const list = saved.map((x) => ({ ...x }));
    list.backup = BACKUP.taken;
    return list;
  }
}
const SAA_LABEL = "Sex Addicts Anonymous (SAA)";

module.exports = async (req, res) => {
  const sources = [];
  let meetings = [];

  // start the newer feeds alongside the main ones, not after them
  const extrasP = Promise.allSettled(EXTRA_TSML.map((f) => getJSON(f.url)));
  const moreP = Promise.allSettled([getJSON(SA_URL), fetchSoba(), withBackup(SAA_LABEL, fetchSAA), fetchGA(), fetchNarAnon(), fetchEA(), fetchCAOnline(), fetchMA(), fetchDA(), fetchGamAnon(), fetchHA(), fetchDRA(), fetchCROnline(), fetchSLAA(), fetchPA(), fetchRI(), fetchSAnon(), fetchNAVirtual(), ...TSML_ONLINE.map(fetchTSMLOnline), ...PATHMINDER.map(fetchPathminder)]);
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
  const [sa, soba, saa, ga, naranon, ea, caOnline, ma, da, gamanon, ha, dra, crOnline, slaa, pa, ri, sanon, naVirtual, rca, sia, wa, ...pm] = await moreP;

  function take(label, result, list) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      sources.push({ name: label, count: list.length, ok: true, ...(result.value.backup ? { backup: result.value.backup } : {}) });
      meetings = meetings.concat(list);
    } else {
      sources.push({ name: label, count: 0, ok: false, error: String(result.reason?.message || result.reason || "no data").slice(0, 120) });
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
  take(SAA_LABEL, saa,
    saa.status === "fulfilled" ? saa.value.filter((x) => inMetro(x)) : []);
  take("Gamblers Anonymous", ga,
    ga.status === "fulfilled" ? ga.value.filter((x) => inMetro(x)) : []);
  take("Nar-Anon", naranon,
    naranon.status === "fulfilled" ? naranon.value.filter((x) => inMetro(x)) : []);
  take("Emotions Anonymous", ea,
    ea.status === "fulfilled" ? ea.value.filter((x) => inMetro(x)) : []);
  take("Cocaine Anonymous (online)", caOnline, caOnline.status === "fulfilled" ? caOnline.value : []);
  take("Marijuana Anonymous", ma, ma.status === "fulfilled" ? ma.value : []);
  take("Debtors Anonymous", da, da.status === "fulfilled" ? da.value : []);
  take("Gam-Anon (online)", gamanon, gamanon.status === "fulfilled" ? gamanon.value : []);
  take("Heroin Anonymous (online)", ha, ha.status === "fulfilled" ? ha.value : []);
  take("Families Anonymous (directory 2026-10-15)", { status: "fulfilled", value: FA_ROOMS }, FA_ROOMS);
  take(`Families Anonymous online (directory ${FA_ONLINE_LISTED})`, { status: "fulfilled", value: FA_ONLINE }, onlineOnly(FA_ONLINE));
  take("Dual Recovery Anonymous (online)", dra, dra.status === "fulfilled" ? dra.value : []);
  take("Celebrate Recovery (online)", crOnline, crOnline.status === "fulfilled" ? crOnline.value : []);
  take("SLAA (Sex and Love Addicts Anonymous)", slaa, slaa.status === "fulfilled" ? slaa.value.filter((x) => inMetro(x)) : []);
  const slaaOn = slaaOnline();
  take(`SLAA online (copied ${SLAA_SAVED.listed || "—"})`, { status: slaaOn.length ? "fulfilled" : "rejected", value: slaaOn, reason: new Error("api/_slaa-online.json missing") }, onlineOnly(slaaOn));
  take(`Nicotine Anonymous (copied ${NICA_SAVED.listed || "—"})`, { status: NICA_SAVED.rows.length ? "fulfilled" : "rejected",
    value: NICA_SAVED.rows, reason: new Error("api/_nica.json missing") }, NICA_SAVED.rows);
  take("Recovering Couples Anonymous", rca, rca.status === "fulfilled" ? rca.value : []);
  take("Survivors of Incest Anonymous (online)", sia, sia.status === "fulfilled" ? sia.value : []);
  take("Workaholics Anonymous (online)", wa, wa.status === "fulfilled" ? wa.value : []);
  take("Recovery International", ri, ri.status === "fulfilled" ? ri.value : []);
  take("S-Anon", sanon, sanon.status === "fulfilled" ? sanon.value : []);
  take("NA online (virtual-na.org)", naVirtual, naVirtual.status === "fulfilled" ? naVirtual.value : []);
  take("Pills Anonymous", pa, pa.status === "fulfilled" ? pa.value.filter((x) => x.fmt === "online" || inMetro(x)) : []);
  PATHMINDER.forEach((site, i) => take(site.label, pm[i], pm[i].status === "fulfilled" ? pm[i].value : []));
  // SMART's own list has real addresses; SobaSearch's SMART copies are only a fallback
  const smartRooms = PATHMINDER.some((site, i) => site.cat === "SMART" && pm[i].status === "fulfilled" && pm[i].value.some((x) => x.fmt !== "online"));
  take("SobaSearch (OA, CoDA, ACA, SMART, CR, MA, EDA)", soba,
    soba.status === "fulfilled" ? soba.value.filter((x) => inMetro(x) && !(smartRooms && x.cat === "SMART")) : []);

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

// for scripts/backup-blocked.cjs
module.exports.backupFetchers = { [SAA_LABEL]: fetchSAA };
module.exports.savedLists = { "_nica.json": fetchNicA };
