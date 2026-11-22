#!/usr/bin/env node
// Gather MCP server (stdio, no dependencies): lets any AI app ask "what's going on?".
// Tool: whats_on. Reads GATHER_URL (default the live site).
import { createInterface } from "node:readline";
const BASE = process.env.GATHER_URL || "https://gather-six-iota.vercel.app";
const TOOL = {
  name: "whats_on",
  description: "What's going on in the Twin Cities (St. Paul focus): events, city council meetings and hearings, trivia, board games, talks, classes, music. Times are Central.",
  inputSchema: { type: "object", properties: {
    when: { type: "string", description: "now | tonight | today | tomorrow | weekend | week | YYYY-MM-DD (default tonight)" },
    q: { type: "string", description: "words that must appear, e.g. trivia, council, meditation" },
    cat: { type: "string", description: "comma list: Civic,Games,Zen,Music,Learn,Social,Art,Food,Fitness,Outdoors,Books,Volunteer,Language,Sports,Family" },
    miles: { type: "number", description: "max miles from downtown St. Paul (1-50, default 25)" },
    skip: { type: "string", description: "comma list of topics to hide, e.g. lgbtq,bipoc,women,men,seniors,youth or any word" },
    limit: { type: "number", description: "max results (default 15)" },
  } },
};
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const ok = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  if (m.method === "initialize") return ok({ protocolVersion: m.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "gather", version: "1.0.0" } });
  if (m.method === "tools/list") return ok({ tools: [TOOL] });
  if (m.method === "tools/call") {
    try {
      const u = new URL("/api/agent", BASE);
      for (const [k, v] of Object.entries(m.params?.arguments || {})) if (v !== "" && v != null) u.searchParams.set(k, v);
      const t = await (await fetch(u)).text();
      return ok({ content: [{ type: "text", text: t }] });
    } catch (e) { return ok({ isError: true, content: [{ type: "text", text: "Gather error: " + e.message }] }); }
  }
  if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "unknown method" } });
});
