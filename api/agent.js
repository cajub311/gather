// Gather for AI assistants: plain-text answer to "what's going on?".
//   /api/agent?when=tonight&miles=15&q=trivia&cat=Games,Civic&skip=lgbtq,bipoc&limit=15
//   add &format=json for data. when = now|today|tonight|tomorrow|weekend|week|YYYY-MM-DD
// Reads the same feed the Gather page uses (api/events), so there is one source of truth.
const HOME = [44.9537, -93.09]; // downtown St. Paul
const TOPICS = {
  lgbtq: /\b(lgbtq?\w*|queer|gay|lesbian|transgender|nonbinary|two[- ]spirit)\b/i,
  bipoc: /\b(bipoc|people of colou?r|indigenous|native american|latinx|latine|aapi)\b/i,
  women: /\b(women|womxn|female|ladies)\b/i,
  men: /\b(men's|mens)\b/i,
  seniors: /\b(seniors?|elders?|50\+|55\+)\b/i,
  youth: /\b(teens?|teenagers?|youth|kids?|children)\b/i,
};
const miles = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 3959 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
const hm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit" }).format(d);
const clock = (t) => { const [h, m] = (t || "00:00").split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const now = new Date(), today = ymd(now), plus = (n) => ymd(new Date(now.getTime() + n * 864e5));
  const when = String(q.when || "tonight").toLowerCase();
  let from = today, to = today, minTime = "";
  if (when === "now") minTime = hm(now);
  else if (when === "tonight") minTime = "17:00";
  else if (when === "tomorrow") from = to = plus(1);
  else if (when === "weekend") { const dow = new Date(today + "T12:00:00").getDay(); const sat = (6 - dow + 7) % 7; from = dow === 0 ? today : plus(sat); to = plus(dow === 0 ? 0 : sat + 1); }
  else if (when === "week") to = plus(7);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(when)) from = to = when;
  const mi = Math.min(50, Math.max(1, +q.miles || 25));
  const lat = +q.lat || HOME[0], lng = +q.lng || HOME[1];
  const limit = Math.min(60, Math.max(1, +q.limit || 15));
  const cats = String(q.cat || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const skip = String(q.skip || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const words = String(q.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  try {
    const host = req.headers.host;
    const base = /localhost|127\.0\.0\.1/.test(host) ? `http://${host}` : `https://${host}`;
    const feed = await (await fetch(`${base}/api/events`)).json();
    let list = (feed.events || []).filter((e) => {
      if (e.date < from || e.date > to) return false;
      if (minTime && e.date === today && (e.time || "") < minTime) return false;
      if (e.fmt !== "online" && Number.isFinite(e.lat) && miles(lat, lng, e.lat, e.lng) > mi) return false;
      if (cats.length && !cats.includes(String(e.cat).toLowerCase())) return false;
      const text = `${e.name} ${(e.types || []).join(" ")} ${String(e.desc || "").slice(0, 160)}`.toLowerCase();
      if (words.length && !words.every((w) => text.includes(w))) return false;
      if (skip.some((s) => (TOPICS[s] || new RegExp("\\b" + s.replace(/[^a-z0-9]/g, "") + "\\b", "i")).test(text))) return false;
      return true;
    });
    list.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")) || (b.pop || 0) - (a.pop || 0));
    const total = list.length;
    list = list.slice(0, limit);
    const out = list.map((e) => ({
      when: `${e.dateLabel || e.date} ${clock(e.time)}`, name: e.name, category: e.cat, place: e.loc, address: e.addr,
      miles: Number.isFinite(e.lat) ? +miles(lat, lng, e.lat, e.lng).toFixed(1) : null,
      free: (e.types || []).includes("Free"), online: e.fmt === "online", tba: !!e.tba, url: e.url,
      about: String(e.desc || "").slice(0, 140),
    }));
    if (q.format === "json") return res.status(200).json({ when, from, to, total, shown: out.length, events: out });
    const lines = [`Gather — ${when} (${from === to ? from : from + " to " + to}), within ${mi} mi of ${q.lat ? "you" : "downtown St. Paul"}: ${total} match${total === 1 ? "" : "es"}${total > out.length ? `, showing ${out.length}` : ""}.`];
    out.forEach((e, i) => lines.push(`${i + 1}. ${e.when} — ${e.name} [${e.category}] @ ${e.place || "TBA"}${e.miles != null ? ` (${e.miles} mi)` : ""}${e.free ? " · free" : ""}${e.online ? " · online" : ""}\n   ${e.about}${e.about ? "\n   " : ""}${e.url || ""}`));
    if (!out.length) lines.push("Nothing matched. Try a wider miles=, when=week, or drop q=/cat=.");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(lines.join("\n"));
  } catch (err) {
    res.status(502).send("Gather couldn't load events right now: " + err.message);
  }
};
