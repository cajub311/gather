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
  console.log(
    JSON.stringify(
      {
        ok: true,
        events: en,
        meetings: mn,
        eventSourcesOk: (e.sources || []).filter((s) => s.ok).length,
        eventSourcesFail: failed,
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
