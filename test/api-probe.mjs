#!/usr/bin/env node
/** API-only probe against shipped Gather endpoints. */
const BASE = process.env.GATHER_URL || "https://gather-six-iota.vercel.app";

async function main() {
  const eRes = await fetch(`${BASE}/api/events`);
  const mRes = await fetch(`${BASE}/api/meetings`);
  if (!eRes.ok) throw new Error(`events HTTP ${eRes.status}`);
  if (!mRes.ok) throw new Error(`meetings HTTP ${mRes.status}`);
  const e = await eRes.json();
  const m = await mRes.json();
  const en = (e.events || []).length;
  const mn = (m.meetings || []).length;
  if (en < 100) throw new Error(`events too few: ${en}`);
  if (mn < 100) throw new Error(`meetings too few: ${mn}`);
  const failed = (e.sources || []).filter((s) => !s.ok).map((s) => s.name);

  // Checked first: we run ~16 pages off one Eventbrite host and 19 off Meetup.
  // When a host decides we're asking too often it 429s ALL of them at once,
  // quietly removing a third of the feed. Diagnose that before the per-source
  // checks below, which would otherwise blame one arbitrary victim.
  const rateLimited = (e.sources || []).filter((s) => /429/.test(s.error || "")).map((s) => s.name);
  if (rateLimited.length > 3) {
    throw new Error(`${rateLimited.length} sources rate-limited (HTTP 429) — back off request volume, do not just retry: ${rateLimited.join(", ")}`);
  }

  const deepNames = [
    "American Swedish Institute", "DanceMN", "Quatrefoil Library",
    "Minneapolis Arts & Culture", "Germanic-American Institute", "Norway House",
    "Alliance Francaise MSP", "Stand With Ukraine MN", "Twin Cities Maker",
    "The Hook and Ladder", "Can Can Wonderland",
  ];
  const deepSources = (e.sources || []).filter((s) => deepNames.includes(s.name));
  const missing = deepNames.filter((name) => !deepSources.some((s) => s.name === name));
  const unhealthy = deepSources.filter((s) => !s.ok).map((s) => s.name);
  const deepEvents = (e.events || []).filter((event) => deepNames.includes(event.source)).length;
  if (missing.length || unhealthy.length) throw new Error(`deep sources missing/down: ${[...missing, ...unhealthy].join(", ")}`);
  if (deepEvents < 100) throw new Error(`deep events too few: ${deepEvents}`);
  const expandedNames = [
    "Common Ground Meditation", "Clouds in Water Zen Center",
    "Minnesota Zen Meditation Center", "Dharma Field Zen Center",
    "The Meditation Center", "Northern Clay Center",
    "Minnesota Museum of American Art", "Minnesota Center for Book Arts",
  ];
  const expandedSources = (e.sources || []).filter((s) => expandedNames.includes(s.name));
  const expandedMissing = expandedNames.filter((name) => !expandedSources.some((s) => s.name === name && s.ok));
  const expandedEvents = (e.events || []).filter((event) => expandedNames.includes(event.source)).length;
  if (expandedMissing.length) throw new Error(`new sources missing/down: ${expandedMissing.join(", ")}`);
  if (expandedEvents < 50) throw new Error(`new-source events too few: ${expandedEvents}`);
  // A source that returns nothing is usually a wrong `type:` — the adapter asks
  // for a feed, gets a web page, and reports success with 0 rows forever. That
  // is how 11 sources that could never work sat in SOURCES unnoticed. Empty is
  // legitimate sometimes (a venue with no events booked), so this warns loudly
  // rather than failing — but a pile of them means someone added a bad batch.
  const empty = (e.sources || []).filter((s) => s.ok && s.count === 0).map((s) => s.name);
  if (empty.length) console.warn(`WARN ${empty.length} source(s) returned 0 events: ${empty.join(", ")}`);
  if (empty.length > 6) throw new Error(`too many empty sources (${empty.length}) — likely a bad batch: ${empty.join(", ")}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        events: en,
        meetings: mn,
        emptySources: empty,
        eventSourcesOk: (e.sources || []).filter((s) => s.ok).length,
        eventSourcesFail: failed,
        deepSources: deepSources.length,
        deepEvents,
        expandedSources: expandedSources.length,
        expandedEvents,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
