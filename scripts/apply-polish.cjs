#!/usr/bin/env node
/**
 * Apply June 10 finder/venue/help polish + PR #2 noscript onto production HTML,
 * and add Minnesota Recovery Connection to api/events.js.
 * Prefers the live site (slightly newer than PR #3) so main can match production.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const root = path.join(__dirname, "..");
const SMALL = require("./polish-replacements.json");

function fetchText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "gather-polish/1.0", Accept: "text/html" } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchText(res.headers.location, timeoutMs).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode + " " + url));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("timeout " + url));
    });
    req.on("error", reject);
  });
}

function replaceOnce(text, old, neu, label, all) {
  const n = text.split(old).length - 1;
  if (n === 0) {
    if (text.includes(neu.slice(0, Math.min(60, neu.length))) || (label === "FINDERS" && text.includes("naminnesota.org/find-a-meeting/"))) {
      console.log("skip already applied:", label);
      return text;
    }
    throw new Error("MISSING " + label);
  }
  return all ? text.split(old).join(neu) : text.replace(old, neu);
}

function polishHtml(html) {
  if (html.includes('id="btnHelp"') && html.includes("<noscript>") && html.includes("Gamezenter")) {
    console.log("index.html already polished");
    return html;
  }
  for (const r of SMALL) {
    html = replaceOnce(html, r.old, r.new, r.label, !!r.all);
  }
  html = replaceOnce(
    html,
    'const ACTIVITIES = {\n  Games:{name:"Board Games & Tabletop",color:"#c084fc"},',
    'const ACTIVITIES = {\n  Recovery:{name:"Sober & Recovery Community",color:"#4fd1c5"},\n  Games:{name:"Board Games & Tabletop",color:"#c084fc"},',
    "activities recovery"
  );
  html = replaceOnce(
    html,
    '  activities:[\n    {id:"games",label:"🎲 Board games",match:m=>m.cat==="Games"||/trivia|bingo|board game|tabletop|d&d|dungeons|game night|card game/i.test(m.name||"")},',
    '  activities:[\n    {id:"sober",label:"Sober-friendly",match:m=>m.cat==="Recovery"||/sober|recovery|alcohol[- ]free/i.test((m.name||"")+" "+((m.types||[]).join(" "))+" "+(m.source||""))},\n    {id:"games",label:"🎲 Board games",match:m=>m.cat==="Games"||/trivia|bingo|board game|tabletop|d&d|dungeons|game night|card game/i.test(m.name||"")},',
    "sober chip"
  );
  if (html.includes('!["games","dance","music","social","wellness"].includes(q.id)')) {
    html = replaceOnce(
      html,
      '!["games","dance","music","social","wellness"].includes(q.id)',
      '!["games","dance","music","social","wellness","sober"].includes(q.id)',
      "foryou allowlist"
    );
  }
  html = html.replace('let _vibeStored="all"', 'let _vibeStored="social"');
  html = replaceOnce(
    html,
    '<div class="crisis" title="Free, confidential, 24/7"><a href="tel:988">Crisis · 988</a></div>',
    '<div class="crisis" title="Free, confidential, 24/7"><a href="tel:988">Crisis · 988</a> <button type="button" id="btnHelp">Get help now</button></div>',
    "crisis header"
  );
  html = replaceOnce(html, HELP_CSS_OLD, HELP_CSS_NEW, "help css");
  html = replaceOnce(
    html,
    '<body class="mode-activities" data-design="dayboard-v4">\n<div id="app">',
    NOSCRIPT,
    "noscript"
  );
  html = replaceOnce(
    html,
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>\n',
    HELP_MODAL,
    "help modal"
  );
  const helpWire =
    '  const helpModal=document.getElementById("helpModal");\n  document.getElementById("btnHelp").onclick=()=>{helpModal.hidden=false;};\n  document.getElementById("helpClose").onclick=()=>{helpModal.hidden=true;};\n  helpModal.addEventListener("click",e=>{if(e.target===helpModal)helpModal.hidden=true;});\n';
  const shareBlock =
    '  document.getElementById("btnShare").onclick=()=>{\n    pushUrl();\n    copyText(location.href,"Link copied — share this view");\n  };\n';
  if (html.includes(shareBlock)) {
    html = replaceOnce(html, shareBlock, shareBlock + helpWire, "help js");
  } else {
    const kd = 'document.addEventListener("keydown",e=>{';
    if (!html.includes(kd)) throw new Error("MISSING keydown anchor");
    html = replaceOnce(html, kd, helpWire + '  ' + kd, "help js (pr3 fallback)");
  }
  html = replaceOnce(
    html,
    '    if(e.key==="Escape")map?.closePopup();',
    '    if(e.key==="Escape"){if(helpModal&&!helpModal.hidden){helpModal.hidden=true;return;}map?.closePopup();}',
    "escape"
  );
  for (const bad of ["Fantasy Flight", "Misty Mountain", "E Calhoun Pkwy", "Black Dog Cafe"]) {
    if (html.includes(bad)) throw new Error("still present: " + bad);
  }
  const required = [
    "btnHelp", "helpModal", "Get help now", "<noscript>", "naminnesota.org/find-a-meeting/",
    "Gamezenter", "withStableIds", "function meta(cat)", "Sober-friendly",
    'data-design="dayboard-v4"', '{id:"social",label:"For You"', 'let _vibeStored="social"',
    "Crisis · 988", "1500 6th St NE", "2040 St Clair", "227 Colfax", "Bde Maka Ska",
    "find-an-ea-meeting", "coda.org/find-a-meeting", "crlocator.com", "refugerecoverymeetings.org",
    "meetings.womenforsobriety.org", "lifering.org/meeting-menu", "Hennepin County Library — Central",
  ];
  for (const n of required) {
    if (!html.includes(n)) throw new Error("missing required " + n);
  }
  return html;
}

function polishEvents(src) {
  if (src.includes("Minnesota Recovery Connection")) {
    console.log("events.js already has MRC");
    return src;
  }
  const needle = '  { type: "tribe", name: "Minneapolis Parks", base: "https://www.minneapolisparks.org", lat: 44.9778, lng: -93.2650, addr: "Minneapolis", fallback: "Outdoors" },\n';
  const insert = '  // Recovery-community events: All Recovery meetings, sober socials, trainings\n  { type: "tribe", name: "Minnesota Recovery Connection", cat: "Recovery", base: "https://www.minnesotarecovery.org", lat: 44.9637, lng: -93.1768, addr: "800 Transfer Rd, St Paul" },\n' + needle;
  if (!src.includes(needle)) throw new Error("MISSING Minneapolis Parks source");
  return src.replace(needle, insert);
}

const HELP_CSS_OLD = "  .crisis a:hover{background:rgba(255,80,60,.14);border-color:rgba(255,180,168,.45)}\n";
const HELP_CSS_NEW = "  .crisis a:hover{background:rgba(255,80,60,.14);border-color:rgba(255,180,168,.45)}\n  .crisis{display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n  .crisis button{\n    color:#ffb4a8;background:transparent;font-size:12px;font-weight:600;\n    border:1px solid rgba(255,180,168,.28);padding:6px 12px;border-radius:var(--radius-sm);\n    white-space:nowrap;\n  }\n  .crisis button:hover{background:rgba(255,80,60,.14);border-color:rgba(255,180,168,.45)}\n  .modal-scrim{position:fixed;inset:0;z-index:2000;background:rgba(11,30,42,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px}\n  .modal-scrim[hidden]{display:none!important}\n  .modal{width:100%;max-width:520px;max-height:86vh;overflow-y:auto;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:20px;color:var(--txt)}\n  .modal h2{margin:0 0 4px;font-size:17px}\n  .modal .modal-sub{font-size:12.5px;color:var(--muted);margin:0 0 14px;line-height:1.45}\n  .modal-close{float:right;background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:4px 10px;font-size:12px;font-weight:600}\n  .modal-close:hover{color:var(--txt)}\n  .res-group{margin-bottom:14px}\n  .res-group h3{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}\n  .res-item{display:block;padding:10px 12px;margin-bottom:6px;background:var(--paper);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--txt);transition:border-color .15s}\n  .res-item:hover{border-color:var(--accent-dim)}\n  .res-item .rn{font-size:13.5px;font-weight:600}\n  .res-item .rd{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.4}\n  .res-item .rc{font-size:12px;color:var(--accent);font-weight:600;margin-top:3px}\n  .res-item.urgent{border-color:rgba(228,63,37,.35)}\n  .res-item.urgent .rc{color:var(--now)}\n";
const NOSCRIPT = "<body class=\"mode-activities\" data-design=\"dayboard-v4\">\n<noscript>\n  <div style=\"max-width:640px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;color:#eef2f6;background:#131a24;border:1px solid #263041;border-radius:12px;line-height:1.6\">\n    <h1 style=\"margin:0 0 8px;font-size:20px\">Gather</h1>\n    <p style=\"color:#8b9cb3;margin:0 0 16px\">Gather needs JavaScript to show the interactive map and meeting list. Please enable it, or use these resources right now:</p>\n    <p style=\"margin:0 0 6px\"><strong>988</strong> \u2014 Suicide &amp; Crisis Lifeline (call or text, 24/7)</p>\n    <p style=\"margin:0 0 6px\"><strong>1-800-662-4357</strong> \u2014 SAMHSA National Helpline (treatment referral)</p>\n    <p style=\"margin:0\"><strong>211</strong> \u2014 United Way (local help: housing, food, treatment)</p>\n  </div>\n</noscript>\n<div id=\"app\">";
const HELP_MODAL = "<div class=\"toast\" id=\"toast\" role=\"status\" aria-live=\"polite\"></div>\n<div class=\"modal-scrim\" id=\"helpModal\" hidden role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"helpTitle\">\n  <div class=\"modal\">\n    <button type=\"button\" class=\"modal-close\" id=\"helpClose\">Close \u2715</button>\n    <h2 id=\"helpTitle\">Get help now</h2>\n    <p class=\"modal-sub\">Free, confidential resources. If someone is in immediate danger, call 911.</p>\n    <div class=\"res-group\">\n      <h3>Right now \u2014 24/7</h3>\n      <a class=\"res-item urgent\" href=\"tel:988\">\n        <div class=\"rn\">988 Suicide &amp; Crisis Lifeline</div>\n        <div class=\"rd\">Mental health or substance use crisis. Call or text 988, or chat at 988lifeline.org.</div>\n        <div class=\"rc\">Call 988</div>\n      </a>\n      <a class=\"res-item urgent\" href=\"tel:18006624357\">\n        <div class=\"rn\">SAMHSA National Helpline</div>\n        <div class=\"rd\">Free treatment referral &amp; information for substance use and mental health, in English and Spanish.</div>\n        <div class=\"rc\">1-800-662-HELP (4357)</div>\n      </a>\n      <a class=\"res-item\" href=\"tel:211\">\n        <div class=\"rn\">211 \u2014 United Way</div>\n        <div class=\"rd\">Connects you to local help: housing, food, treatment, support programs.</div>\n        <div class=\"rc\">Call 211</div>\n      </a>\n    </div>\n    <div class=\"res-group\" id=\"resTreatment\">\n      <h3>Find treatment</h3>\n      <a class=\"res-item\" href=\"https://fasttrackermn.org/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">Fast-Tracker Minnesota</div>\n        <div class=\"rd\">Minnesota's real-time locator for substance use &amp; mental health treatment openings.</div>\n        <div class=\"rc\">fasttrackermn.org \u2197</div>\n      </a>\n      <a class=\"res-item\" href=\"https://findtreatment.gov/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">FindTreatment.gov</div>\n        <div class=\"rd\">Official national locator for licensed treatment \u2014 filter by payment, telehealth, and distance.</div>\n        <div class=\"rc\">findtreatment.gov \u2197</div>\n      </a>\n    </div>\n    <div class=\"res-group\" id=\"resCommunity\">\n      <h3>Sober community &amp; support</h3>\n      <a class=\"res-item\" href=\"https://thephoenix.org/find-a-class/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">The Phoenix</div>\n        <div class=\"rd\">Free sober active community \u2014 workouts, climbing, yoga &amp; socials. St Paul gym at 470 Cleveland Ave N.</div>\n        <div class=\"rc\">thephoenix.org \u2197</div>\n      </a>\n      <a class=\"res-item\" href=\"https://www.minnesotarecovery.org/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">Minnesota Recovery Connection</div>\n        <div class=\"rd\">Peer support, All Recovery meetings, and recovery community events across the metro.</div>\n        <div class=\"rc\">minnesotarecovery.org \u2197</div>\n      </a>\n      <a class=\"res-item\" href=\"https://mnwitw.org/mnwarmline\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">Minnesota Warmline</div>\n        <div class=\"rd\">Peer-run support line when it's not a crisis but you need to talk to someone who gets it.</div>\n        <div class=\"rc\">mnwitw.org/mnwarmline \u2197</div>\n      </a>\n    </div>\n    <div class=\"res-group\" id=\"resOnline\">\n      <h3>Can't make it in person?</h3>\n      <a class=\"res-item\" href=\"https://aa-intergroup.org/meetings/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">Online Intergroup of AA</div>\n        <div class=\"rd\">Hundreds of online AA meetings around the clock, every day.</div>\n        <div class=\"rc\">aa-intergroup.org \u2197</div>\n      </a>\n      <a class=\"res-item\" href=\"https://virtual-na.org/meetings/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">Virtual NA</div>\n        <div class=\"rd\">Online and phone NA meetings worldwide, searchable by time and language.</div>\n        <div class=\"rc\">virtual-na.org \u2197</div>\n      </a>\n      <a class=\"res-item\" href=\"https://www.intherooms.com/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">In The Rooms</div>\n        <div class=\"rd\">Free online recovery community \u2014 live video meetings across many fellowships.</div>\n        <div class=\"rc\">intherooms.com \u2197</div>\n      </a>\n      <a class=\"res-item\" href=\"https://meetings.smartrecovery.org/meetings/\" target=\"_blank\" rel=\"noopener\">\n        <div class=\"rn\">SMART Recovery Online</div>\n        <div class=\"rd\">Science-based, non-12-step meetings online every day.</div>\n        <div class=\"rc\">meetings.smartrecovery.org \u2197</div>\n      </a>\n    </div>\n  </div>\n</div>\n";

async function main() {
  const committed = fs.readFileSync(path.join(root, "index.html"), "utf8");
  let html = committed;
  let source = "committed index.html";
  try {
    if (process.env.GATHER_SKIP_LIVE) throw new Error("GATHER_SKIP_LIVE");
    const live = await fetchText("https://gather-six-iota.vercel.app/");
    if (live.includes("withStableIds") && live.includes("dayboard-v4")) {
      html = live;
      source = "https://gather-six-iota.vercel.app/";
    }
  } catch (e) {
    console.log("live fetch skipped:", e.message);
  }
  console.log("polishing HTML from", source, html.length, "bytes");
  html = polishHtml(html);
  fs.writeFileSync(path.join(root, "index.html"), html);
  const evPath = path.join(root, "api/events.js");
  const events = polishEvents(fs.readFileSync(evPath, "utf8"));
  fs.writeFileSync(evPath, events);
  console.log("wrote index.html", html.length, "api/events.js", events.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
