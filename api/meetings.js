// Gather — live meetings aggregator (Vercel serverless function)
// Fetches real, public feeds server-side (no browser CORS) and normalizes
// them into the shape the front-end already uses.
//
//   AA      -> aaminneapolis.org + aaminnesota.org (12-step-meeting-list / TSML JSON)
//   NA      -> bmlt.naminnesota.org (BMLT JSON)
//   Al-Anon -> mnsa-afg.org (MN South Area, TSML JSON)
//
// Output: { updated, sources, meetings: [ {cat,name,day,time,dur,fmt,loc,addr,lat,lng,types,url,live,verified} ] }

const AA_URL = "https://aaminneapolis.org/wp-admin/admin-ajax.php?action=meetings";
const AA_MN_URL = "https://aaminnesota.org/wp-admin/admin-ajax.php?action=meetings";
const ALANON_URL = "https://mnsa-afg.org/wp-admin/admin-ajax.php?action=meetings";
const NA_URL =
  "https://bmlt.naminnesota.org/main_server/client_interface/json/?switcher=GetSearchResults";

// Statewide feeds include greater Minnesota; keep the metro area only.
const METRO = { latMin: 44.6, latMax: 45.4, lngMin: -93.8, lngMax: -92.6 };
function inMetro(m) {
  return (
    m.lat >= METRO.latMin && m.lat <= METRO.latMax &&
    m.lng >= METRO.lngMin && m.lng <= METRO.lngMax
  );
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Gather/1.0";

// readable labels for the most useful TSML type codes (kept short)
const TSML_TYPES = {
  O: "Open", C: "Closed", M: "Men", W: "Women", BV: "Babysitting",
  BB: "Big Book", D: "Discussion", B: "Beginners", Y: "Young People",
  ONL: "Online", "11": "11th Step", SP: "Speaker", ST: "Step", TR: "Tradition",
  LGBTQ: "LGBTQ", DB: "Digital Basket", X: "Wheelchair", HE: "Spanish",
  POC: "People of Color", WC: "Wheelchair",
};

async function getJSON(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,*/*", Referer: url },
  });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

function hhmm(t) {
  if (!t) return "12:00";
  const m = String(t).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "12:00";
}

function durMins(start, end) {
  // start/end "HH:MM"
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

function normalizeTSML(rows, cat) {
  const out = [];
  for (const m of rows) {
    const lat = parseFloat(m.latitude), lng = parseFloat(m.longitude);
    const types = Array.isArray(m.types) ? m.types : [];
    const ao = (m.attendance_option || "").toLowerCase();
    let fmt = "in-person";
    if (ao === "online" || (types.includes("ONL") && !lat)) fmt = "online";
    else if (ao === "hybrid") fmt = "hybrid";
    else if (types.includes("ONL")) fmt = "hybrid";
    const labels = types
      .map((t) => TSML_TYPES[t])
      .filter(Boolean)
      .slice(0, 3);
    out.push({
      cat,
      name: m.name || `${cat} Meeting`,
      day: typeof m.day === "number" ? m.day : Number(m.day) || 0,
      time: hhmm(m.time),
      dur: m.end_time ? durMins(hhmm(m.time), hhmm(m.end_time)) : 60,
      fmt,
      loc: m.location || m.region || `${cat} Group`,
      addr: m.formatted_address || m.region || "Twin Cities area",
      lat: isFinite(lat) ? lat : null,
      lng: isFinite(lng) ? lng : null,
      types: labels,
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
    const lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
    const wd = parseInt(r.weekday_tinyint, 10); // 1=Sun..7=Sat
    const day = isNaN(wd) ? 0 : (wd - 1 + 7) % 7;
    const vt = parseInt(r.venue_type, 10); // 1=in-person 2=virtual 3=hybrid
    const fmt = vt === 2 ? "online" : vt === 3 ? "hybrid" : "in-person";
    const dur = r.duration_time
      ? durMins("00:00", hhmm(r.duration_time))
      : 60;
    out.push({
      cat: "NA",
      name: r.meeting_name || "NA Meeting",
      day,
      time: hhmm(r.start_time),
      dur: dur || 60,
      fmt,
      loc: r.location_text || r.location_municipality || "NA Group",
      addr:
        [r.location_street, r.location_municipality, r.location_province]
          .filter(Boolean)
          .join(", ") || "Minnesota",
      lat: isFinite(lat) ? lat : null,
      lng: isFinite(lng) ? lng : null,
      types: [],
      url: r.virtual_meeting_link || r.conference_url || undefined,
      live: true,
      verified: true,
    });
  }
  return out;
}

module.exports = async (req, res) => {
  const sources = [];
  let meetings = [];
  // the same meeting can appear in two intergroup feeds — keep the first copy
  const seen = new Set();
  const addUnique = (list) => {
    for (const m of list) {
      const k = [m.cat, m.name, m.day, m.time, m.addr].join("|").toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      meetings.push(m);
    }
  };

  const [aa, aaMn, na, alanon] = await Promise.allSettled([
    getJSON(AA_URL),
    getJSON(AA_MN_URL),
    getJSON(NA_URL),
    getJSON(ALANON_URL),
  ]);

  if (aa.status === "fulfilled" && Array.isArray(aa.value)) {
    const m = normalizeTSML(aa.value, "AA").filter((x) => x.lat && x.lng);
    addUnique(m);
    sources.push({ name: "AA Minneapolis Intergroup", count: m.length, ok: true });
  } else {
    sources.push({ name: "AA Minneapolis Intergroup", count: 0, ok: false });
  }

  if (aaMn.status === "fulfilled" && Array.isArray(aaMn.value)) {
    const m = normalizeTSML(aaMn.value, "AA").filter(
      (x) => x.lat && x.lng && inMetro(x)
    );
    const before = meetings.length;
    addUnique(m);
    sources.push({ name: "AA Minnesota (Area 35/36)", count: meetings.length - before, ok: true });
  } else {
    sources.push({ name: "AA Minnesota (Area 35/36)", count: 0, ok: false });
  }

  if (na.status === "fulfilled" && Array.isArray(na.value)) {
    const m = normalizeNA(na.value).filter((x) => x.lat && x.lng);
    addUnique(m);
    sources.push({ name: "NA Minnesota (BMLT)", count: m.length, ok: true });
  } else {
    sources.push({ name: "NA Minnesota (BMLT)", count: 0, ok: false });
  }

  if (alanon.status === "fulfilled" && Array.isArray(alanon.value)) {
    const m = normalizeTSML(alanon.value, "Al-Anon").filter(
      (x) => x.lat && x.lng && inMetro(x)
    );
    addUnique(m);
    sources.push({ name: "Al-Anon MN South Area", count: m.length, ok: true });
  } else {
    sources.push({ name: "Al-Anon MN South Area", count: 0, ok: false });
  }

  // cache at the edge: fresh 1h, serve-stale up to 24h while revalidating
  res.setHeader(
    "Cache-Control",
    "s-maxage=3600, stale-while-revalidate=86400"
  );
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    updated: new Date().toISOString(),
    sources,
    meetings,
  });
};
