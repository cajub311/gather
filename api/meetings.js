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

async function getJSON(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json,*/*", Referer: url },
  });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
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

    out.push({
      cat,
      name: cleanText(m.name) || cat + " Meeting",
      day: typeof m.day === "number" ? m.day : Number(m.day) || 0,
      time: hhmm(m.time),
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
    let loc = r.location_text || r.location_municipality || "NA Group";
    if (fmt === "online") loc = r.location_text || "Online meeting";

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
  return [...byName.values()];
}

module.exports = async (req, res) => {
  const sources = [];
  let meetings = [];

  const [aa, na, aamn, alanon, dharma, refuge, buddhist] = await Promise.allSettled([
    getJSON(AA_URL),
    getJSON(NA_URL),
    fetchAAMinnesota(),
    getJSON(ALANON_URL),
    getJSON(DHARMA_URL),
    getJSON(REFUGE_URL),
    getJSON(BUDDHIST_URL),
  ]);

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

  if (refuge.status === "fulfilled" && Array.isArray(refuge.value)) {
    const list = normalizeAA(refuge.value, "Refuge").filter(
      (x) => (x.lat && x.lng && inMetro(x)) || (x.approx && looksCentralTime(x.name))
    );
    take("Refuge Recovery", refuge, list);
  } else take("Refuge Recovery", refuge, []);

  if (buddhist.status === "fulfilled" && Array.isArray(buddhist.value)) {
    const list = normalizeAA(buddhist.value, "Buddhist").filter(
      (x) => (x.lat && x.lng && inMetro(x)) || (x.approx && looksCentralTime(x.name))
    );
    take("Buddhist Recovery Network", buddhist, list);
  } else take("Buddhist Recovery Network", buddhist, []);

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
