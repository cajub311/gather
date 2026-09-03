# Gather

Live app: https://gather-six-iota.vercel.app

Twin Cities support meetings and community activities on one map.

Sample listings show until `/api/meetings` and `/api/events` load. `main` should match production.

Vercel deploys the static tree plus `api/`. HTML polish and design-guard are `npm test` only. Do not run them as the Vercel `buildCommand` — that failed three preview deploys on 2026-08-28 when the guard required production HTML that was not in git yet.
