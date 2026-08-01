// Gather — live community events aggregator (Vercel serverless function)
// Pulls real, public event feeds server-side and normalizes them into the
// activities schema the front-end uses.
//
// Adapters:
//   tribe  -> "The Events Calendar" WordPress REST API (no auth, public)
//   meetup -> Meetup's public city page (no paid API)
//   eventbrite -> Eventbrite's public city results (no API key)
//   ics    -> Google Calendar / iCal public feeds (.ics)
//   commonground -> Common Ground's public calendar endpoint
//   rss    -> Wild Apricot community calendars
//   cabooze -> Cabooze RHP events HTML (Communion Sundays, shows)
//   firstave -> First Avenue WP event posts (also Fine Line, Turf Club, Entry)
//   opendate -> independent venue calendars powered by OpenDate
//   standing -> fixed recurring community events (Dance Church, etc.)
//
// Add a venue/org: drop it in SOURCES with its type. That's the whole job.

// Keep the honest Gather/1.0 token. Claiming to be Chrome without any of the
// headers a real Chrome sends reads as spoofing to Cloudflare bot management —
// measured: Surly 403s the Chrome UA and 200s this one, and no source prefers
// the Chrome UA. Utepils' 403 came from Vercel's IPs, not the UA; the retry in
// fetchWithRetry is what gives it a second chance.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Gather/1.0";

// `fallback` = what an unrecognized title at this venue most likely is. Without
// it every unclassifiable row landed in "Social", which made Social 55% of the
// whole feed (Como Zoo animal programs, library classes, park events).
const SOURCES = [
  // --- The Events Calendar (Tribe) REST — confirmed live ---
  { type: "tribe", name: "Surly Brewing Co.", base: "https://surlybrewing.com", lat: 44.9696, lng: -93.2089, addr: "520 Malcolm Ave SE, Minneapolis" },
  { type: "tribe", name: "Modist Brewing", base: "https://modistbrewing.com", lat: 44.9852, lng: -93.2772, addr: "505 N 3rd St, Minneapolis" },
  { type: "tribe", name: "Indeed Brewing", base: "https://indeedbrewing.com", lat: 44.9996, lng: -93.2476, addr: "711 NE 15th Ave, Minneapolis" },
  { type: "tribe", name: "Landmark Center", base: "https://landmarkcenter.org", lat: 44.9462, lng: -93.0969, addr: "75 W 5th St, St Paul", fallback: "Art" },
  { type: "tribe", name: "56 Brewing", base: "https://56brewing.com", lat: 45.0156, lng: -93.2410, addr: "3134 California St NE, Minneapolis" },
  { type: "tribe", name: "Minneapolis Parks", base: "https://www.minneapolisparks.org", lat: 44.9778, lng: -93.2650, addr: "Minneapolis", fallback: "Outdoors" },
  { type: "tribe", name: "Como Zoo & Conservatory", base: "https://comozooconservatory.org", lat: 44.9822, lng: -93.1519, addr: "1225 Estabrook Dr, St Paul", fallback: "Family" },
  { type: "tribe", name: "Summit Brewing", base: "https://www.summitbrewing.com", lat: 44.9160, lng: -93.1360, addr: "910 Montreal Cir, St Paul" },
  { type: "tribe", name: "Utepils Brewing", base: "https://www.utepilsbrewing.com", lat: 44.9790, lng: -93.3080, addr: "225 Thomas Ave N, Minneapolis" },
  { type: "tribe", name: "White Squirrel Bar", base: "https://whitesquirrelbar.com", lat: 44.9270, lng: -93.1250, addr: "974 W 7th St, St Paul", fallback: "Music" },
  { type: "tribe", name: "Science Museum of MN", base: "https://www.smm.org", lat: 44.9425, lng: -93.0990, addr: "120 W Kellogg Blvd, St Paul", fallback: "Family" },
  { type: "tribe", name: "Malcolm Yards", base: "https://malcolmyards.market", lat: 44.9797, lng: -93.2130, addr: "501 30th Ave SE, Minneapolis" },
  { type: "tribe", name: "Dakota Jazz Club", base: "https://dakotacooks.com", lat: 44.9727, lng: -93.2760, addr: "1010 Nicollet Mall, Minneapolis", cat: "Music" },
  { type: "tribe", name: "Bell Museum", base: "https://www.bellmuseum.umn.edu", lat: 45.0000, lng: -93.1876, addr: "2088 Larpenteur Ave W, St Paul", fallback: "Family" },
  { type: "tribe", name: "American Swedish Institute", base: "https://asimn.org", lat: 44.9552, lng: -93.2659, addr: "2600 Park Ave, Minneapolis", fallback: "Art" },
  { type: "tribe", name: "DanceMN", base: "https://dancemn.org", lat: 44.9778, lng: -93.2650, addr: "Twin Cities", fallback: "Music" },
  { type: "tribe", name: "Quatrefoil Library", base: "https://qlibrary.org", lat: 44.9482, lng: -93.2575, addr: "1220 E Lake St, Minneapolis", fallback: "Books" },
  { type: "tribe", name: "The Meditation Center", base: "https://themeditationcenter.org", lat: 44.9954, lng: -93.2611, addr: "631 University Ave NE, Minneapolis", fallback: "Zen" },
  { type: "tribe", name: "Northern Clay Center", base: "https://northernclaycenter.org", lat: 44.9620, lng: -93.2336, addr: "2424 E Franklin Ave, Minneapolis", fallback: "Art" },
  { type: "tribe", name: "Minnesota Museum of American Art", base: "https://mmaa.org", lat: 44.9487, lng: -93.0895, addr: "350 Robert St N, St Paul", fallback: "Art" },
  // NE brewery with regular trivia / social nights (confirmed tribe feed)
  { type: "tribe", name: "Wooden Hill Brewing", base: "https://woodenhillbrewing.com", lat: 45.0139, lng: -93.2475, addr: "2415 Central Ave NE, Minneapolis" },

  // --- UMN public calendar (LiveWhale JSON) — lectures, arboretum, concerts ---
  { type: "livewhale", name: "UMN Events", url: "https://events.tc.umn.edu/live/json/events/max/300", lat: 44.9740, lng: -93.2277, addr: "Minneapolis", fallback: "Learn" },

  // --- Squarespace event collections (?format=json) — confirmed live ---
  { type: "squarespace", name: "Bad Weather Brewing", base: "https://www.badweatherbrewery.com/events", lat: 44.9276, lng: -93.1310, addr: "1505 7th St W, St Paul" },
  { type: "squarespace", name: "Lake Monster Brewing", base: "https://www.lakemonsterbrewing.com/events", lat: 44.9636, lng: -93.1880, addr: "550 Vandalia St, St Paul" },
  { type: "squarespace", name: "Arbeiter Brewing", base: "https://www.arbeiterbrewing.com/events", lat: 44.9487, lng: -93.2310, addr: "3038 Minnehaha Ave, Minneapolis" },
  { type: "squarespace", name: "Pryes Brewing", base: "https://www.pryesbrewing.com/events", lat: 44.9920, lng: -93.2790, addr: "1401 West River Rd N, Minneapolis" },
  { type: "squarespace", name: "The Cedar", base: "https://www.thecedar.org/events", lat: 44.9689, lng: -93.2470, addr: "416 Cedar Ave S, Minneapolis", cat: "Music" },
  { type: "squarespace", name: "Berlin", base: "https://www.berlinmpls.com/calendar", lat: 44.9822, lng: -93.2717, addr: "204 N 1st St, Minneapolis", cat: "Music" },
  { type: "squarespace", name: "Minneapolis Arts & Culture", base: "https://mplsartsandculture.org/events-2026", lat: 44.9778, lng: -93.2650, addr: "Minneapolis", fallback: "Art" },
  { type: "squarespace", name: "Germanic-American Institute", base: "https://www.gaimn.org/events", lat: 44.9419, lng: -93.1111, addr: "301 Summit Ave, St Paul", fallback: "Language" },
  { type: "squarespace", name: "Norway House", base: "https://www.norwayhouse.org/event-calendar", lat: 44.9624, lng: -93.2606, addr: "913 E Franklin Ave, Minneapolis", fallback: "Art" },
  { type: "squarespace", name: "Alliance Francaise MSP", base: "https://www.afmsp.org/events", lat: 44.9768, lng: -93.2923, addr: "227 Colfax Ave N, Minneapolis", fallback: "Language" },
  { type: "squarespace", name: "Stand With Ukraine MN", base: "https://www.standwithukrainemn.com/events", lat: 44.9880, lng: -93.2569, addr: "301 Main St NE, Minneapolis", fallback: "Social" },
  { type: "squarespace", name: "Minnesota Center for Book Arts", base: "https://mnbookarts.org/events", lat: 44.9751, lng: -93.2517, addr: "1011 Washington Ave S, Minneapolis", fallback: "Art" },

  // --- Small independent/community calendars not indexed well elsewhere ---
  { type: "rss", name: "Twin Cities Maker", url: "https://wa.tcmaker.org/widget/Calendar/RSS", loc: "Twin Cities Maker / Hack Factory", lat: 44.9551, lng: -93.2260, addr: "3119 E 26th St, Minneapolis", fallback: "Art" },
  { type: "opendate", name: "The Hook and Ladder", url: "https://r.jina.ai/http://thehookmpls.com/events/", loc: "The Hook and Ladder", lat: 44.9480, lng: -93.2344, addr: "3010 Minnehaha Ave, Minneapolis", fallback: "Music" },

  // Meditation centers publish their own calendars but rarely reach city roundups.
  { type: "commonground", name: "Common Ground Meditation", url: "https://commongroundmeditation.org/api/calendar/events?venue=cityCenter&limit=100&offset=0", base: "https://commongroundmeditation.org/calendar?venue=cityCenter", loc: "Common Ground Meditation Center", lat: 44.9558, lng: -93.2329, addr: "2700 E 26th St, Minneapolis", cat: "Zen" },
  { type: "ics", name: "Clouds in Water Zen Center", url: "https://calendar.google.com/calendar/ical/cloudsinwater.org_jaj9mpkgi0k7mif65vparvgrgc%40group.calendar.google.com/public/basic.ics", base: "https://www.cloudsinwater.org/events-1", loc: "Clouds in Water Zen Center", lat: 44.9547, lng: -93.1136, addr: "445 Farrington St, St Paul", fallback: "Zen" },
  { type: "ics", name: "Minnesota Zen Meditation Center", url: "https://calendar.google.com/calendar/ical/info.mnzencenter.org%40gmail.com/public/basic.ics", base: "https://www.mnzencenter.org/calendar.html", loc: "Minnesota Zen Meditation Center", lat: 44.9430, lng: -93.3060, addr: "3343 E Bde Maka Ska Blvd, Minneapolis", fallback: "Zen", fmt: "hybrid" },
  { type: "ics", name: "Dharma Field Zen Center", url: "https://calendar.google.com/calendar/ical/6lduu2s3udjg3qdm31a0ospudk%40group.calendar.google.com/public/basic.ics", base: "https://www.dharmafield.org/google-calendar.html", loc: "Dharma Field Zen Center", lat: 44.9132, lng: -93.3197, addr: "3118 W 49th St, Minneapolis", fallback: "Zen" },

  // --- Nightlife / dance / concerts ---
  { type: "cabooze", name: "The Cabooze", url: "https://cabooze.com/events/", lat: 44.9628, lng: -93.2465, addr: "913 Cedar Ave S, Minneapolis", cat: "Music" },
  { type: "firstave", name: "First Avenue + sister venues", listUrl: "https://first-avenue.com/shows/", cat: "Music" },
  { type: "eventbrite", name: "Can Can Wonderland", url: "https://www.eventbrite.com/d/mn--saint-paul/can-can-wonderland/", venueMatch: "can can wonderland", loc: "Can Can Wonderland", base: "https://www.cancanwonderland.com/entertainment", lat: 44.9538, lng: -93.1839, addr: "755 Prior Ave N, St Paul" },

  // Standing community hangouts (published schedules, no JSON API)
  {
    type: "standing",
    name: "Dance Church Mpls",
    title: "Dance Church",
    rule: "sundaysExceptFirst",
    time: "11:00",
    dur: 120,
    loc: "Tapestry Folkdance Center",
    addr: "3748 Minnehaha Ave, Minneapolis",
    lat: 44.9347,
    lng: -93.2246,
    cat: "Music",
    types: ["Dance", "All ages", "DJ"],
    url: "https://www.dancechurch.net/",
    desc: "DJ dance party every Sunday except the first Sunday of the month. 11am–1pm at Tapestry Folkdance Center.",
  },

  // --- Library systems (BiblioCommons JSON) ---
  { type: "biblio", name: "St Paul Library", lib: "sppl", addr: "St Paul", fallback: "Learn" },
  { type: "biblio", name: "Hennepin Co. Library", lib: "hclib", addr: "Minneapolis", fallback: "Learn" },
  { type: "biblio", name: "Ramsey Co. Library", lib: "rclreads", addr: "Ramsey County", fallback: "Learn" },

  // --- Discovery: general city scrapes ---
  { type: "meetup", name: "Meetup", url: "https://www.meetup.com/find/us--mn--minneapolis/?eventType=inPerson&source=EVENTS" },
  { type: "meetup", name: "Meetup St Paul", url: "https://www.meetup.com/find/us--mn--saint-paul/?eventType=inPerson&source=EVENTS" },
  // Keyword Meetup hunts — board games, trivia, dance, social (your scene)
  { type: "meetup", name: "Meetup Board Games", url: "https://www.meetup.com/find/?keywords=board%20games&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Games" },
  { type: "meetup", name: "Meetup Trivia", url: "https://www.meetup.com/find/?keywords=trivia&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Games" },
  { type: "meetup", name: "Meetup Dance", url: "https://www.meetup.com/find/?keywords=dance&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Music" },
  { type: "meetup", name: "Meetup Social", url: "https://www.meetup.com/find/?keywords=social&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Social" },
  { type: "meetup", name: "Meetup Language", url: "https://www.meetup.com/find/?keywords=language%20exchange&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Language" },
  { type: "meetup", name: "Meetup Hiking", url: "https://www.meetup.com/find/?keywords=hiking&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Outdoors" },
  { type: "meetup", name: "Meetup Comedy", url: "https://www.meetup.com/find/?keywords=comedy&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Music" },
  { type: "meetup", name: "Meetup D&D", url: "https://www.meetup.com/find/?keywords=dungeons%20dragons&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Games" },
  { type: "meetup", name: "Meetup Running", url: "https://www.meetup.com/find/?keywords=running&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Fitness" },
  { type: "meetup", name: "Meetup Book Clubs", url: "https://www.meetup.com/find/?keywords=book%20club&location=us--mn--minneapolis&source=EVENTS&eventType=inPerson", cat: "Books" },
  // Active board-game groups (weekly brewery / shop nights around the metro)
  { type: "meetup", name: "MN Board Games group", url: "https://www.meetup.com/minnesota-board-game-get-together/events/", cat: "Games" },

  { type: "eventbrite", name: "Eventbrite", url: "https://www.eventbrite.com/d/mn--minneapolis/events--today/" },
  { type: "eventbrite", name: "Eventbrite (page 2)", url: "https://www.eventbrite.com/d/mn--minneapolis/events--today/?page=2" },
  { type: "eventbrite", name: "Eventbrite St Paul", url: "https://www.eventbrite.com/d/mn--saint-paul/events--this-week/" },
  // Topic pages — more music/nightlife/hobby signal than generic "today"
  { type: "eventbrite", name: "Eventbrite Music", url: "https://www.eventbrite.com/d/mn--minneapolis/music--events--this-week/", cat: "Music" },
  { type: "eventbrite", name: "Eventbrite Nightlife", url: "https://www.eventbrite.com/d/mn--minneapolis/nightlife--events--this-week/", cat: "Music" },
  { type: "eventbrite", name: "Eventbrite Hobbies", url: "https://www.eventbrite.com/d/mn--minneapolis/hobbies--events--this-week/", cat: "Games" },
  { type: "eventbrite", name: "Eventbrite Food & Drink", url: "https://www.eventbrite.com/d/mn--minneapolis/food-and-drink--events--this-week/", cat: "Food" },
  { type: "eventbrite", name: "Eventbrite Music St Paul", url: "https://www.eventbrite.com/d/mn--saint-paul/music--events--this-week/", cat: "Music" },
  { type: "eventbrite", name: "Eventbrite Comedy", url: "https://www.eventbrite.com/d/mn--minneapolis/comedy--events--this-week/", cat: "Music" },
  { type: "eventbrite", name: "Eventbrite Arts", url: "https://www.eventbrite.com/d/mn--minneapolis/arts--events--this-week/", cat: "Art" },
  { type: "eventbrite", name: "Eventbrite Film", url: "https://www.eventbrite.com/d/mn--minneapolis/film-and-media--events--this-week/", cat: "Art" },
  { type: "eventbrite", name: "Eventbrite Fitness", url: "https://www.eventbrite.com/d/mn--minneapolis/sports-and-fitness--events--this-week/", cat: "Fitness" },
];

// skip taproom logistics / non-activity filler that some venues publish as "events"
function isNoise(title) {
  const t = title || "";
  // Do NOT treat "Open Mic" / "Open Studio" as hours — only pure open/closed logistics.
  if (/^(closed|now open|patio|taproom|kitchen|we'?re open)\b|^open\s*$|^open\s+at\b|food truck|truck:|curbside|to[- ]go|growler|lean six sigma|project management techniques training|certification training/i.test(t)) return true;
  // civic process, not something to go do
  if (/\b(open house|board meeting|committee meeting|public hearing|advisory committee|commissioners|city council|budget meeting|listening session)\b/i.test(t)) return true;
  // A standing drink special ("A Modist Happy Hour", "Happy Hour: $5 before 6")
  // is a price, not a plan — but a happy hour with a billed act is a real show
  // ("The Current Happy Hour w/ Girl Tones"), so keep anything naming a guest.
  if (/happy hour/i.test(t) && !/\bw\/|\bwith\b|\bfeat\.?\b|featuring|presents/i.test(t)) return true;
  // Eventbrite is full of multi-day corporate cert bootcamps — not a Twin Cities night out
  if (/\b(salesforce|compTIA|aws certified|azure admin|pmp exam|scrum master|six sigma|docker|kubernetes|professional skills bootcamp|sql for healthcare|certification (?:training|course|bootcamp)|admin certification)\b/i.test(t)) return true;
  if (/\b(certified scrum|scrummaster|scrum product owner|\bcspo\b|\bcsm\b)\b/i.test(t)) return true;
  // "2 Days Certified … Training", "1 Day Workshop in Minneapolis"
  if (/\b\d+\s*days?\s+(?:certified|certification|training|workshop|course|bootcamp)\b/i.test(t)) return true;
  if (/\b\d+\s*day\s+(?:workshop|training|bootcamp|course)\b/i.test(t)) return true;
  // multi-week fundraisers / "July 1–31" campaigns published as midnight events
  if (/\b(domestic abuse project|fundrais(?:e|ing)\s+month|month[- ]long)\b/i.test(t)) return true;
  return false;
}

function isUnavailableTitle(title) {
  return /^\s*\(?(?:canceled|cancelled|sold out)\)?\s*[:—-]?/i.test(title || "");
}

// Venue categories that mean "this row is logistics, not an event". Only drops a
// row when EVERY category is filler — 56 Brewing publishes its food-truck
// schedule as ~50 events/month, but a fest tagged [Food Truck, Live Music] stays.
// Deliberately excludes "taproom"/"patio": Modist files real events (MNUFC watch
// party, comedy nights) under Taproom Event, and isNoise already catches the
// happy-hour/"open at 10:30" filler by title.
const FILLER_CATS = /^\s*(food truck|public meeting|kitchen|hours$|open hours)/i;
function isFillerOnly(catNames) {
  const c = (catNames || []).filter(Boolean);
  return c.length > 0 && c.every((n) => FILLER_CATS.test(n));
}

// Map a title (+ the venue's own category names) to one of the app's activity
// types. Returns null when nothing matches so the caller can fall back to the
// venue's `fallback` instead of dumping everything into "Social".
function classify(text, catNames) {
  const cats = (catNames || []).filter(Boolean).join(" ").toLowerCase();
  // A venue's own taxonomy beats guessing from the title: Surly files concerts
  // under "On Stage @" and Mpls Parks files buckthorn pulls under
  // "Environmental Volunteer Opportunities" — neither is guessable from the name.
  if (cats) {
    if (/trivia|quiz|bingo|game night/.test(cats)) return "Games";
    if (/on stage|live music|music in the park|concert|dance/.test(cats)) return "Music";
    if (/volunteer/.test(cats)) return "Volunteer";
    if (/storytime|story time|kids|children|family|youth|preschool|toddler/.test(cats)) return "Family";
    if (/movie|film|screening/.test(cats)) return "Art";
  }
  // "Classes & Workshops"-style categories deliberately do NOT short-circuit:
  // libraries file poetry readings and dance-fitness classes under them, and the
  // title is the better signal. Categories still feed the title pass below.
  const t = ((text || "") + " " + cats).toLowerCase();
  const has = (re) => re.test(t);
  if (has(/trivia|quiz night|\bbingo\b|board game|tabletop|chess|d&d|dungeons|magic the|euchre|card game|crokinole|jigsaw|puzzl|pinball|arcade|karaoke|game night|clocktower/)) return "Games";
  if (has(/music|concert|\bband\b|\bjam\b|\bdj\b|open mic|singer|songwriter|orchestra|jazz|acoustic|hip[- ]?hop|\bpunk\b|\bmetal\b|indie|bluegrass|\bchoir\b|recital|honky tonk|\bfest\b|on stage|\blive at\b|\btrio\b|quartet|quintet|\bduo\b|\bvinyl\b|communion|\bedm\b|techno|house music|dance party|dance church|rave|nightclub|live show|comedy|stand[- ]?up/)) return "Music";
  // board games / trivia often land as "Social" without this
  if (has(/trivia|quiz night|\bbingo\b|board game|tabletop|game night|mario kart|canasta|euchre|d&d|dungeons/)) return "Games";
  if (has(/meditat|mindful|sound bath|breathwork|yin yoga|restorative|reiki|sangha|zazen|dharma/)) return "Zen";
  if (has(/storytime|story time|toddler|preschool|\bkids?\b|children|\bfamily\b|all ages|\bbabies?\b|\bteens?\b|puppet|face paint|\blego\b|zookeeper|gorilla|polar bear|tiger talk|giraffe|penguin|sea lion|petting|little explorer|sea stories|dinosaur/)) return "Family";
  if (has(/\brun(?:ning|s)?\b|\b(?:5|10)k\b|marathon|fitness|workout|yoga|pilates|volleyball|pickleball|table tennis|ping pong|climb|cycling|bike ride|bike night|\bsports?\b|softball|basketball|\bswim|skate|zumba|\bbarre\b|crossfit/)) return "Fitness";
  if (has(/volunteer|food shelf|fundrais|charity|blood drive|buckthorn|invasive plant|litter pick/)) return "Volunteer";
  if (has(/book club|\bauthor\b|\bread(?:ing|s)?\b|poetry|writers|book sale|lit crawl/)) return "Books";
  if (has(/\barts?\b|craft|paint|pottery|knit|maker|\bdraw|ceramic|\bprint|gallery|exhibit|quilt|\bsew\b|collage|photograph|mural|\bmovie|\bfilm\b|screening/)) return "Art";
  // bare "trail" matched "training" (Salesforce Admin Training → Outdoors). Use trails? word.
  if (has(/hike|\btrails?\b|nature walk|birding|\bbirders?\b|kayak|paddle|canoe|garden|\bpark\b|cleanup|prairie|arboretum|pollinator|\btrek|\bflower|\bbloom|meadow/)) return "Outdoors";
  if (has(/tasting|brunch|\bdinner\b|beer release|cocktail|\bwine\b|farmers market|cooking|\bbake|\bchef\b|barbecue|\bbbq\b|ice cream|pizza night|brewer/)) return "Food";
  if (has(/language|spanish|french|german|conversation table|\besl\b|somali|hmong|\basl\b|sign language/)) return "Language";
  if (has(/\bclass\b|workshop|lecture|seminar|\bpanel\b|\btalk\b|\b101\b|intro to|how to|tech help|resume|job fair|info session|\bdemo\b|symposium|colloquium|training/)) return "Learn";
  if (has(/watch party|singles mixer|meet new|networking|happy hour|\bmixer\b|block party|\bsocial\b|meetup/)) return "Social";
  return null;
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
  middot: "·", bull: "•", deg: "°", trade: "™", reg: "®", copy: "©",
};
// Feeds hand back a grab-bag of entities — the old list-of-replacements missed
// whatever wasn't enumerated, so titles shipped literal "&#8230;" to the UI.
function decode(s) {
  if (!s) return "";
  return String(s)
    .replace(/<(?:br|p|div|li)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ").trim();
}
function codePoint(n) {
  if (!Number.isFinite(n) || n < 32 || n > 0x10ffff) return " ";
  try { return String.fromCodePoint(n); } catch { return " "; }
}

function short(s) {
  s = decode(s);
  return s.length > 180 ? s.slice(0, 177) + "…" : s;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseLocal(s) {
  // "YYYY-MM-DD HH:MM:SS" (venue-local) — keep as wall time, no TZ math
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

// 26 sources fetch in parallel, so a slow origin gets starved and trips its own
// timeout even when it answers in <1s locally (UMN's 1MB feed did exactly that).
// One retry with a longer budget recovers those instead of showing 0 events.
// Hard wall-clock ceiling per source. The function's maxDuration is 30s, and
// retries multiply: a paged venue could otherwise spend 8 pages x (try + retry)
// and hang the whole response. Whatever a source has by its deadline is what
// ships; the rest of the metro shouldn't wait on one slow origin.
const SOURCE_BUDGET_MS = 21000;
function deadline() {
  const until = Date.now() + SOURCE_BUDGET_MS;
  return { left: () => until - Date.now(), expired: () => Date.now() >= until };
}

async function fetchWithRetry(url, accept, ms, budget) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (budget && budget.expired()) break;
    if (budget) ms = Math.max(2000, Math.min(ms, budget.left()));
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: accept,
          "Accept-Language": "en-US,en;q=0.9",
          Referer: new URL(url).origin + "/",
        },
        signal: AbortSignal.timeout(attempt ? ms * 2 : ms),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      last = e;
      // a 4xx is a decision, not a hiccup — retrying just burns the time budget
      if (/HTTP 4\d\d/.test(String(e.message))) break;
      if (budget && budget.expired()) break;
    }
  }
  throw last || new Error("source timed out");
}

async function getJSON(url, ms = 10000, budget) {
  return (await fetchWithRetry(url, "application/json", ms, budget)).json();
}

async function getText(url, ms = 10000, budget) {
  return (await fetchWithRetry(url, "text/html,application/xhtml+xml", ms, budget)).text();
}

function dayKey(p) {
  return new Date(p.y, p.mo - 1, p.d).getDay();
}

async function fromTribe(src, startISO, endISO) {
  const budget = deadline();
  // The Events Calendar paginates at 50/page and several venues run 3-12x that
  // in a 45-day window (Como Zoo: 563, Mpls Parks: 282) — a single page was
  // silently dropping 80-90% of real listings.
  //
  // Pages go out concurrently, not one after another. Waiting for page 1 to
  // report total_pages costs a full round-trip before anything else starts, and
  // Como Zoo's endpoint needs ~13s PER PAGE regardless of window size — serial
  // paging there spent the entire budget on page 1. The first wave is
  // speculative (a small venue wastes 2 cheap requests); a second wave only
  // fires when page 1 says there is more and there's still time.
  const MAX_PAGES = 8, WAVE = 3;
  const pageUrl = (n) =>
    `${src.base}/wp-json/tribe/events/v1/events?per_page=50&page=${n}&start_date=${startISO}&end_date=${endISO}`;
  const fetchPages = (from, to) =>
    Promise.allSettled(
      Array.from({ length: to - from + 1 }, (_, i) => getJSON(pageUrl(from + i), 14000, budget))
    );

  const events = [];
  const wave1 = await fetchPages(1, WAVE);
  // page 1 failing is a dead source — report it as down rather than as empty
  if (wave1[0].status === "rejected") throw wave1[0].reason;
  const collect = (results) => {
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value.events)) events.push(...r.value.events);
    }
  };
  collect(wave1);
  const pages = Math.min(MAX_PAGES, wave1[0].value.total_pages || 1);
  if (pages > WAVE && !budget.expired()) collect(await fetchPages(WAVE + 1, pages));
  const out = [];
  for (const e of events) {
    const p = parseLocal(e.start_date);
    if (!p) continue;
    const title = decode(e.title);
    if (isNoise(title) || isUnavailableTitle(title)) continue;
    const v = Array.isArray(e.venue) ? (e.venue[0] || {}) : (e.venue || {});
    const lat = parseFloat(v.geo_lat), lng = parseFloat(v.geo_lng);
    const catNames = (e.categories || []).map((c) => decode(c.name)).filter(Boolean);
    if (isFillerOnly(catNames)) continue;
    out.push({
      cat: src.cat || classify(title, catNames) || src.fallback || "Social",
      name: title,
      day: dayKey(p),
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      dur: 120,
      fmt: e.is_virtual ? "online" : "in-person",
      loc: decode(v.venue || src.name),
      addr: decode(v.address ? `${v.address}, ${v.city || ""}`.replace(/, $/, "") : src.addr),
      lat: isFinite(lat) ? lat : src.lat,
      lng: isFinite(lng) ? lng : src.lng,
      approx: !(isFinite(lat) && isFinite(lng)) || undefined,
      types: [e.cost ? decode(e.cost) : "", catNames[0] || ""].filter(Boolean).slice(0, 2),
      free: isFreeCost(decode(e.cost)) || undefined,
      desc: short(e.description || "") || undefined,
      url: e.url,
      date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      image: e.image && e.image.url,
      live: true,
      verified: true,
    });
  }
  return out;
}

function parseICS(text, src) {
  const out = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const b of blocks) {
    const get = (k) => {
      const m = b.match(new RegExp(`${k}[^:]*:(.*)`));
      return m ? m[1].trim() : "";
    };
    const dt = get("DTSTART");
    const m = dt.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) continue;
    let p = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 12), mi: +(m[5] || 0) };
    // Google mixes local TZID values with UTC values ending in Z. Convert UTC
    // to Chicago wall time or an evening sit can land on the wrong day.
    if (m[4] && /Z$/i.test(dt)) p = chicagoParts(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi));
    const title = decode(get("SUMMARY"));
    if (!title || isNoise(title) || isUnavailableTitle(title) || /CANCELLED/i.test(get("STATUS"))) continue;
    const desc = decode(get("DESCRIPTION"));
    const loc = decode(get("LOCATION"));
    const hasOnline = /zoom|online/i.test(`${desc} ${loc}`);
    out.push({
      cat: src.cat || classify(title, [get("CATEGORIES")]) || src.fallback || "Social",
      name: title,
      day: dayKey(p),
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      dur: 120,
      fmt: hasOnline ? (src.lat ? "hybrid" : "online") : (src.fmt || "in-person"),
      loc: loc || src.loc || src.name,
      addr: loc || src.addr,
      lat: src.lat, lng: src.lng,
      types: [],
      url: get("URL") || src.base || undefined,
      date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    });
  }
  return out;
}

async function fromCommonGround(src) {
  const groups = await getJSON(src.url, 12000);
  const out = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const e of group.events || []) {
      const title = decode(e.title || (e.eventTemplate && e.eventTemplate.title));
      if (!title || e.cancelled || e.hidden || isNoise(title) || isUnavailableTitle(title)) continue;
      const p = parseLocal(`${group.date || e.startDate} ${e.startTime || "12:00"}`);
      if (!p) continue;
      const realms = e.realm || (e.eventTemplate && e.eventTemplate.realm) || [];
      const online = realms.includes("online"), inPerson = realms.includes("in-person");
      const end = String(e.endTime || "").split(":").map(Number);
      const start = String(e.startTime || "12:00").split(":").map(Number);
      const dur = end.length === 2 ? Math.max(30, (end[0] * 60 + end[1]) - (start[0] * 60 + start[1])) : 60;
      out.push({
        ...eventRow(src, {
          title,
          p,
          time: e.startTime || "12:00",
          url: src.base,
          types: ["Meditation", "Donation optional"],
          cat: "Zen",
          loc: src.loc,
          addr: src.addr,
          lat: src.lat,
          lng: src.lng,
        }),
        dur,
        fmt: online && inPerson ? "hybrid" : online ? "online" : "in-person",
        free: true,
      });
    }
  }
  return out;
}

// Squarespace stores event start as an absolute epoch (ms). Convert to the
// venue's wall-clock time in America/Chicago so day/time are correct.
function chicagoParts(ms) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  let h = +o.hour; if (h === 24) h = 0;
  return { y: +o.year, mo: +o.month, d: +o.day, h, mi: +o.minute };
}

async function fromSquarespace(src) {
  const budget = deadline();
  const now = new Date();
  const months = [];
  for (let i = 0; i < 3; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${String(dt.getMonth() + 1).padStart(2, "0")}-${dt.getFullYear()}`);
  }
  const origin = new URL(src.base).origin;
  const out = [], seen = new Set();
  for (const m of months) {
    let j;
    if (budget.expired()) break;
    try { j = await getJSON(`${src.base}?format=json&month=${m}`, 10000, budget); } catch { continue; }
    const items = [...(j.upcoming || []), ...(j.items || [])];
    for (const e of items) {
      if (!e.startDate) continue;
      const title = decode(e.title);
      if (!title || isNoise(title) || isUnavailableTitle(title)) continue;
      const p = chicagoParts(e.startDate);
      const date = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
      const k = title + "|" + date;
      if (seen.has(k)) continue;
      seen.add(k);
      const loc = e.location || {};
      const lat = parseFloat(loc.mapLat), lng = parseFloat(loc.mapLng);
      const place = `${title} ${loc.addressTitle || ""} ${loc.addressLine1 || ""}`;
      const online = /(?:^|\b)(online|virtual|zoom)(?:\b|$)/i.test(place);
      out.push({
        cat: src.cat || classify(title, [...(e.tags || []), ...(e.categories || [])]) || src.fallback || "Social",
        name: title,
        day: dayKey(p),
        time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
        dur: 120,
        fmt: online ? "online" : "in-person",
        loc: decode(loc.addressTitle || src.name),
        addr: decode([loc.addressLine1, loc.addressLine2].filter(Boolean).join(", ")) || src.addr,
        lat: isFinite(lat) && lat ? lat : src.lat,
        lng: isFinite(lng) && lng ? lng : src.lng,
        types: [],
        desc: short(e.excerpt || "") || undefined,
        url: e.fullUrl ? origin + e.fullUrl : src.base,
        date,
        dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
        source: src.name,
        live: true,
        verified: true,
      });
    }
  }
  return out;
}

// Wild Apricot exposes small clubs and maker spaces as standard RSS. Its
// pubDate is the event start (not the post date), including the start time.
async function fromRSS(src) {
  const xml = await getText(src.url);
  const out = [];
  for (const item of xml.split(/<item>/i).slice(1)) {
    const field = (name) => {
      const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
      return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
    };
    const ms = Date.parse(field("pubDate"));
    if (!Number.isFinite(ms)) continue;
    let title = decode(decode(field("title")))
      .replace(/\s*\([A-Za-z]{3},?\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\)\s*$/, "")
      .trim();
    if (!title || isUnavailableTitle(title) || /\breserved\b/i.test(title)) continue;
    const p = chicagoParts(ms);
    out.push(eventRow(src, {
      title,
      p,
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      url: decode(field("link")) || src.url,
      types: [],
      desc: short(decode(field("description"))),
      cat: classify(title, [decode(field("description"))]) || src.fallback,
    }));
  }
  return out;
}

// OpenDate event cards are serialized into the venue's Astro HTML. Reading
// those cards keeps the link, exact local time, stage and poster without a key.
async function fromOpenDate(src) {
  const html = (await getText(src.url)).replace(/&quot;/g, '"');
  const re = /"venuePermalink":\[0,"([^"]+)"\],"title":\[0,"([^"]+)"\],"date":\[0,"([^"]+)"\],"time":\[0,"([^"]*)"\],"image":\[0,"([^"]*)"\][\s\S]{0,400}?"stage":\[0,"([^"]*)"\]/g;
  const out = [], seen = new Set();
  let m;
  while ((m = re.exec(html))) {
    const [url, rawTitle, iso, , image, stage] = m.slice(1);
    const title = decode(rawTitle);
    if (!title || isNoise(title) || isUnavailableTitle(title) || seen.has(url)) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    seen.add(url);
    const p = chicagoParts(ms);
    out.push({
      ...eventRow(src, {
        title,
        p,
        time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
        url,
        types: [decode(stage)].filter(Boolean),
      }),
      image: decode(image) || undefined,
    });
  }
  if (out.length) return out;

  // Some OpenDate venues put Cloudflare in front of their custom domain.
  // The reader returns one Markdown line per official event; use the official
  // URL slug for the date (the rendered label can shift evening shows to UTC).
  const monthNo = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  for (const line of html.split("\n")) {
    const link = line.match(/\]\((https:\/\/thehookmpls\.com\/shows\/[^)]+)\)\s*$/i);
    const titleM = line.match(/!\[Image \d+:\s*([^\]]+)\]/i);
    const imageM = line.match(/!\[Image \d+:[^\]]+\]\((https:\/\/s3[^)]+)\)/i);
    const timeM = line.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+Details\]/i);
    if (!link || !titleM || !timeM) continue;
    const dateM = link[1].match(/-(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})-\d+$/i);
    if (!dateM) continue;
    const title = decode(titleM[1]);
    if (!title || /private event/i.test(title) || isUnavailableTitle(title)) continue;
    const time = parseShowClock(timeM[1]);
    const [h, mi] = time.split(":").map(Number);
    const p = { y: +dateM[3], mo: monthNo[dateM[1].toLowerCase()], d: +dateM[2], h, mi };
    out.push({
      ...eventRow(src, { title, p, time, url: link[1], types: [] }),
      image: imageM ? imageM[1] : undefined,
    });
  }
  return out;
}

// BiblioCommons (library events). Entities carry the real data; items is the
// ordered id list. Branch + place entities both have geocoded centrePoints.
async function fromBiblio(src) {
  const budget = deadline();
  const start = chicagoDateKey(new Date());
  const end = chicagoDateKey(new Date(Date.now() + 45 * 864e5));
  const out = [];
  for (let page = 1; page <= 2; page++) {
    let j;
    try {
      j = await getJSON(`https://gateway.bibliocommons.com/v2/libraries/${src.lib}/events?startDate=${start}&endDate=${end}&limit=100&page=${page}`, 10000, budget);
    } catch { break; }
    const ids = (j.events && j.events.items) || [];
    const ents = j.entities || {};
    const evs = ents.events || {}, locs = ents.locations || {}, places = ents.places || {};
    const typesEnt = ents.eventTypes || {}, auds = ents.eventAudiences || {}, imgs = ents.images || {};
    for (const id of ids) {
      const e = (evs[id] || {}).definition;
      if (!e || e.isCancelled) continue;
      const m = String(e.start || "").match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) continue;
      const p = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
      const title = decode(e.title);
      if (!title || isNoise(title)) continue;
      const locEnt = locs[e.branchLocationId] || places[e.nonBranchLocationId];
      const cp = locEnt && locEnt.mapLocation && locEnt.mapLocation.centrePoint;
      if (!cp || !cp.lat || !cp.lng) continue;
      if (cp.lat < 44.6 || cp.lat > 45.35 || cp.lng < -93.8 || cp.lng > -92.75) continue; // metro only
      const a = locEnt.address || {};
      const typeNames = (e.typeIds || []).map((t) => (typesEnt[t] || {}).name).filter(Boolean);
      const audNames = (e.audienceIds || []).map((t) => (auds[t] || {}).name).filter(Boolean);
      const img = imgs[e.featuredImageId];
      out.push({
        cat: classify(title, [...typeNames, ...audNames]) || src.fallback || "Social",
        name: title,
        day: dayKey(p),
        time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
        dur: duration(e.start, e.end),
        fmt: "in-person",
        loc: decode(locEnt.name || src.name),
        addr: decode([a.number && a.street ? `${a.number} ${a.street}` : a.street, a.city].filter(Boolean).join(", ")) || src.addr,
        lat: cp.lat, lng: cp.lng,
        types: ["Free", audNames[0] || typeNames[0] || ""].filter(Boolean).slice(0, 2),
        free: true,
        desc: short(e.description || "") || undefined,
        url: `https://${src.lib}.bibliocommons.com/events/${id}`,
        image: img && img.url,
        date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
        dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
        source: src.name,
        live: true,
        verified: true,
      });
    }
    const pg = j.events && j.events.pagination;
    if (!pg || page >= pg.pages) break;
  }
  return out;
}

// LiveWhale (UMN). Keeps only timed, in-person, located, non-canceled events —
// the raw feed is mostly all-day deadlines and webinars. No coordinates in the
// feed, so events are approx (list-only, no map pin) with the address shown.
async function fromLiveWhale(src) {
  const rows = await getJSON(src.url, 20000);
  const out = [];
  for (const e of (Array.isArray(rows) ? rows : [])) {
    if (e.is_all_day || e.is_canceled || e.is_online || !e.location) continue;
    const m = String(e.date_iso || "").match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) continue;
    const p = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
    const title = decode(e.title);
    if (!title || isNoise(title)) continue;
    out.push({
      cat: classify(title + " " + decode(e.description || "").slice(0, 120), [e.group_title]) || src.fallback || "Social",
      name: title,
      day: dayKey(p),
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      dur: duration(e.date_iso, e.date2_iso),
      fmt: "in-person",
      loc: decode(e.group_title || src.name),
      addr: decode(e.location),
      lat: src.lat, lng: src.lng, approx: true,
      types: e.cost ? [decode(e.cost).slice(0, 18)] : [],
      free: isFreeCost(decode(e.cost)) || undefined,
      desc: short(e.description || "") || undefined,
      url: e.url,
      date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    });
  }
  return out;
}

function cityPoint(city) {
  const c = String(city || "").toLowerCase();
  if (c.includes("st. paul") || c.includes("saint paul")) return { lat: 44.9537, lng: -93.0900 };
  if (c.includes("bloomington")) return { lat: 44.8408, lng: -93.2983 };
  if (c.includes("edina")) return { lat: 44.8897, lng: -93.3499 };
  if (c.includes("shoreview")) return { lat: 45.0791, lng: -93.1472 };
  if (c.includes("roseville")) return { lat: 45.0061, lng: -93.1566 };
  if (c.includes("richfield")) return { lat: 44.8833, lng: -93.2830 };
  if (c.includes("minnetonka")) return { lat: 44.9211, lng: -93.4687 };
  if (c.includes("eagan")) return { lat: 44.8041, lng: -93.1669 };
  if (c.includes("maplewood")) return { lat: 44.9530, lng: -93.0160 };
  if (c.includes("new brighton") || c.includes("arden hills")) return { lat: 45.0655, lng: -93.2019 };
  if (c.includes("hopkins")) return { lat: 44.9264, lng: -93.4055 };
  if (c.includes("st. louis park") || c.includes("saint louis park")) return { lat: 44.9483, lng: -93.3480 };
  if (c.includes("crystal") || c.includes("robbinsdale") || c.includes("brooklyn center")) return { lat: 45.0522, lng: -93.3100 };
  if (c.includes("woodbury")) return { lat: 44.9239, lng: -92.9594 };
  return { lat: 44.9778, lng: -93.2650 };
}

function duration(start, end) {
  const mins = (Date.parse(end) - Date.parse(start)) / 60000;
  return Number.isFinite(mins) && mins > 0 && mins < 1440 ? Math.round(mins) : 120;
}

async function fromMeetup(src) {
  const html = await getText(src.url);
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("Meetup data not found");
  const data = JSON.parse(match[1]);
  const found = [], seen = new Set();
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (value.eventUrl && value.dateTime && value.title && !seen.has(value.eventUrl)) {
      seen.add(value.eventUrl);
      found.push(value);
    }
    Object.values(value).forEach(walk);
  }
  walk(data.props && data.props.pageProps);
  return found.map((e) => {
    const p = chicagoParts(Date.parse(e.dateTime));
    const venue = e.venue || {};
    const point = cityPoint(venue.city);
    const address = [venue.address, venue.city, venue.state].filter(Boolean).join(", ");
    const going = e.going && Number(e.going.totalCount);
    const guessed = classify(`${e.title} ${(e.group && e.group.name) || ""}`);
    return {
      // Keyword Meetup scrapes pass cat so "board games" doesn't land in Social
      cat: src.cat || guessed || "Social",
      name: decode(e.title),
      day: dayKey(p),
      time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`,
      dur: duration(e.dateTime, e.endTime),
      fmt: e.isOnline || e.eventType === "ONLINE" ? "online" : e.eventType === "HYBRID" ? "hybrid" : "in-person",
      loc: decode(venue.name || (e.group && e.group.name) || "Meetup"),
      addr: decode(address || "Twin Cities"),
      lat: point.lat,
      lng: point.lng,
      approx: true,
      types: [going ? `${going} going` : "", e.group && e.group.name].filter(Boolean).slice(0, 2),
      url: e.eventUrl,
      image: e.displayPhoto && e.displayPhoto.highResUrl,
      date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    };
  });
}

async function fromEventbrite(src) {
  const html = await getText(src.url);
  const match = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?})\s*;\s*window\.__REACT_QUERY_STATE__/i);
  if (!match) throw new Error("Eventbrite data not found");
  const data = JSON.parse(match[1]);
  const rows = data.search_data && data.search_data.events && data.search_data.events.results;
  if (!Array.isArray(rows)) throw new Error("Eventbrite results not found");
  const out = [];
  for (const e of rows) {
    if (e.is_cancelled || isNoise(e.name)) continue;
    const a = (e.primary_venue && e.primary_venue.address) || {};
    const p = parseLocal(`${e.start_date} ${e.start_time}`);
    if (!p) continue;
    const tags = (e.tags || []).map((t) => decode(t.display_name)).filter(Boolean);
    const venueName = decode(e.primary_venue && e.primary_venue.name || a.city || "Twin Cities");
    const address = decode(a.localized_address_display || [a.address_1, a.city, a.region].filter(Boolean).join(", "));
    if (src.venueMatch && !`${venueName} ${address}`.toLowerCase().includes(src.venueMatch.toLowerCase())) continue;
    const onlinePlace = /(?:^|\b)(online|virtual|zoom)(?:\b|$)/i.test(`${venueName} ${address}`);
    out.push({
      cat: classify(e.name, tags) || classify(`${e.name} ${tags.join(" ")}`) || src.cat || "Social",
      name: decode(e.name),
      day: dayKey(p),
      time: e.start_time,
      dur: 120,
      fmt: e.is_online_event || onlinePlace ? "online" : "in-person",
      loc: venueName,
      addr: address,
      lat: parseFloat(a.latitude),
      lng: parseFloat(a.longitude),
      types: tags.slice(0, 2),
      desc: short(e.summary || "") || undefined,
      url: e.url,
      image: e.image && e.image.image_sizes && (e.image.image_sizes.medium || e.image.url),
      date: e.start_date,
      dateLabel: `${DOW[dayKey(p)]}, ${MON[p.mo - 1]} ${p.d}`,
      source: src.name,
      live: true,
      verified: true,
    });
  }
  return out;
}

function chicagoDateKey(date) {
  const p = chicagoParts(date.getTime());
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "Sat, Aug 01" / "Sun, Aug 2" (Cabooze list) → wall-clock parts in Chicago year
function parseCaboozeDate(s, nowParts) {
  const m = String(s || "").match(/([A-Za-z]{3}),\s*([A-Za-z]{3})\s+(\d{1,2})/);
  if (!m) return null;
  const mo = MON3[m[2].toLowerCase()];
  if (!mo) return null;
  const d = +m[3];
  let y = nowParts.y;
  // Dec/Jan wrap: if listing month is far behind "now", it's next year
  if (mo < nowParts.mo - 1) y += 1;
  return { y, mo, d, h: 12, mi: 0 };
}

// "5 pm", "9:30 pm", "Doors: 10 pm // Show: 11 pm" → 24h HH:MM (prefer Show time)
function parseShowClock(s) {
  const str = String(s || "");
  const show = str.match(/Show:\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  const m = show || str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return "20:00";
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  const ap = m[3].toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function eventRow(src, { title, p, time, url, types, desc, cat, loc, addr, lat, lng }) {
  const day = dayKey(p);
  return {
    cat: cat || src.cat || classify(title) || src.fallback || "Music",
    name: title,
    day,
    time: time || "20:00",
    dur: src.dur || 180,
    fmt: "in-person",
    loc: loc || src.loc || src.name,
    addr: addr || src.addr,
    lat: lat != null ? lat : src.lat,
    lng: lng != null ? lng : src.lng,
    types: types || [],
    desc: desc || undefined,
    url: url || src.url,
    date: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
    dateLabel: `${DOW[day]}, ${MON[p.mo - 1]} ${p.d}`,
    source: src.name,
    live: true,
    verified: true,
  };
}

// Cabooze RHP events grid HTML (Communion Sundays, concerts, patio shows)
async function fromCabooze(src) {
  const budget = deadline();
  const nowP = chicagoParts(Date.now());
  const pages = [src.url];
  // page 2 if present
  pages.push(src.url.replace(/\/?$/, "/page/2/"));
  const out = [];
  const seen = new Set();
  for (const pageUrl of pages) {
    if (budget.expired()) break;
    let html;
    try {
      html = await getText(pageUrl, 12000, budget);
    } catch {
      continue;
    }
    const re =
      /id="eventDate"[^>]*>\s*([^<]+)<\/div>[\s\S]{0,3000}?href="(https:\/\/cabooze\.com\/event\/[^"]+)"[^>]*title="([^"]+)"[\s\S]{0,2500}?(?:Show|Doors):\s*([^<\n]+)/gi;
    let m;
    while ((m = re.exec(html))) {
      const dateStr = m[1].trim();
      const url = m[2];
      const title = decode(m[3]);
      const clockRaw = m[4].replace(/\s+/g, " ").trim();
      if (!title || isNoise(title)) continue;
      const p = parseCaboozeDate(dateStr, nowP);
      if (!p) continue;
      const time = parseShowClock(clockRaw);
      const [hh, mm] = time.split(":").map(Number);
      p.h = hh;
      p.mi = mm;
      const k = title.toLowerCase() + "|" + p.y + p.mo + p.d + "|" + time;
      if (seen.has(k)) continue;
      seen.add(k);
      const types = [];
      if (/communion/i.test(title)) types.push("EDM", "21+");
      else if (/reggae|massive monday/i.test(title)) types.push("Reggae");
      else types.push("Live music", "21+");
      out.push(
        eventRow(src, {
          title,
          p,
          time,
          url,
          types,
          cat: "Music",
          loc: "The Cabooze",
          addr: src.addr,
          lat: src.lat,
          lng: src.lng,
        })
      );
    }

    // RHP collapses weekly series into one card. Expand its own performance
    // list so Massive Mondays / Taco Tunesday do not disappear after week one.
    for (const block of html.split(/<div class="rhp-event-series /i).slice(1)) {
      const head = block.match(/href="(https:\/\/cabooze\.com\/events\/category\/series\/[^"]+)"[^>]*title="([^"]+)"/i);
      if (!head) continue;
      const url = head[1];
      const title = decode(head[2]);
      const dates = /rhp-event-series-date[^>]*>\s*([A-Za-z]{3})\s+(\d{1,2})\s*<\/div>[\s\S]{0,500}?rhp-event-series-time[^>]*>\s*([^<]+)<\/div>/gi;
      let d;
      while ((d = dates.exec(block))) {
        const p = parseCaboozeDate(`Mon, ${d[1]} ${d[2]}`, nowP);
        if (!p) continue;
        const time = parseShowClock(d[3]);
        const [hh, mm] = time.split(":").map(Number);
        p.h = hh;
        p.mi = mm;
        const k = title.toLowerCase() + "|" + p.y + p.mo + p.d + "|" + time;
        if (seen.has(k)) continue;
        seen.add(k);
        const row = eventRow(src, {
          title,
          p,
          time,
          url,
          types: /reggae|massive monday/i.test(title) ? ["Reggae", "Weekly"] : ["Live music", "Weekly"],
          cat: "Music",
          loc: "The Cabooze",
          addr: src.addr,
          lat: src.lat,
          lng: src.lng,
        });
        if (/taco tunesday/i.test(title)) row.free = true;
        out.push(row);
      }
    }
  }
  return out;
}

// First Avenue family venues (Mainroom, Entry, Fine Line, Turf Club, Palace, Fitz)
const FIRSTAVE_VENUE_MAP = {
  "turf-club": { loc: "Turf Club", addr: "1601 University Ave W, St Paul", lat: 44.9556, lng: -93.1670 },
  "fine-line": { loc: "Fine Line", addr: "318 1st Ave N, Minneapolis", lat: 44.9836, lng: -93.2725 },
  "7th-st-entry": { loc: "7th St Entry", addr: "701 1st Ave N, Minneapolis", lat: 44.9784, lng: -93.2760 },
  "palace-theatre": { loc: "Palace Theatre", addr: "17 W 7th Pl, St Paul", lat: 44.9450, lng: -93.0980 },
  "the-fitzgerald-theater": { loc: "Fitzgerald Theater", addr: "10 E Exchange St, St Paul", lat: 44.9478, lng: -93.0965 },
  "first-avenue": { loc: "First Avenue", addr: "701 1st Ave N, Minneapolis", lat: 44.9784, lng: -93.2760 },
  "mpls-cpac": { loc: "MPLS CPAC", addr: "Minneapolis", lat: 44.9778, lng: -93.2650 },
};

function parseTitleDate(title) {
  // "Zoso 10/8/26" / "Michael Che 8/29/26 (late)"
  const m = String(title || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  return { y, mo: +m[1], d: +m[2], h: 20, mi: 0 };
}

// slug "2026-09-sapphic-factory-queer-joy-party" + title date "9/12/26"
function parseFirstAveDate(slug, title) {
  const fromTitle = parseTitleDate(title);
  if (fromTitle) return fromTitle;
  const m = String(slug || "").match(/^(\d{4})-(\d{2})-/);
  if (!m) return null;
  // month from slug only — day unknown; skip (title date is reliable when present)
  return null;
}

async function fromFirstAve(src) {
  const budget = deadline();
  // /shows/ cards: poster link + month/day + venue-* class + artist name
  const pageUrl = src.listUrl || "https://first-avenue.com/shows/";
  const html = await getText(pageUrl, 15000, budget);
  const out = [];
  const seen = new Set();

  // Each show card is anchored by /event/{slug}/ then nearby .month / .day / venue class
  const linkRe = /href="(https:\/\/first-avenue\.com\/event\/([^"\/]+))\/?"/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const url = m[1].replace(/\/$/, "") + "/";
    const slug = decodeURIComponent(m[2]);
    if (seen.has(url)) continue;

    // Card body is after the poster link (venue + date + title live nearby either side)
    const around = html.slice(Math.max(0, m.index - 200), m.index + 1800);

    const monthM = around.match(/class="month"\s*>\s*([A-Za-z]{3,9})\s*</i);
    const dayM = around.match(/class="day"\s*>\s*(\d{1,2})\s*</i);
    const venueM = around.match(/venue-([a-z0-9-]+)/i);
    const venueKey = venueM && FIRSTAVE_VENUE_MAP[venueM[1].toLowerCase()]
      ? venueM[1].toLowerCase()
      : "first-avenue";
    const venue = FIRSTAVE_VENUE_MAP[venueKey] || FIRSTAVE_VENUE_MAP["first-avenue"];

    // Artist title: prefer visible name link text, not "Buy Tickets"
    let title = "";
    const titleCandidates = [...around.matchAll(/href="https:\/\/first-avenue\.com\/event\/[^"]+"[^>]*>\s*([^<]{2,100})\s*</gi)]
      .map((x) => decode(x[1]).trim())
      .filter((t) => t && !/buy tickets|view details|read more|^\s*$/i.test(t));
    title = titleCandidates.sort((a, b) => b.length - a.length)[0] || "";
    if (!title || title.length < 3) {
      title = slug
        .replace(/^\d{4}-\d{2}-/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    if (isNoise(title)) continue;

    const slugY = slug.match(/^(\d{4})-(\d{2})-/);
    let y = slugY ? +slugY[1] : chicagoParts(Date.now()).y;
    let mo = slugY ? +slugY[2] : null;
    let d = dayM ? +dayM[1] : null;
    if (monthM) {
      const mo2 = MON3[monthM[1].slice(0, 3).toLowerCase()];
      if (mo2) mo = mo2;
    }
    // title date wins when present (handles multi-night + late/early)
    const fromTitle = parseTitleDate(title);
    if (fromTitle) {
      y = fromTitle.y;
      mo = fromTitle.mo;
      d = fromTitle.d;
    }
    if (!mo || !d) continue;

    let time = "20:00";
    if (/\blate\b/i.test(title + " " + slug)) time = "22:00";
    else if (/\bearly\b/i.test(title + " " + slug)) time = "19:00";
    const [hh, mm] = time.split(":").map(Number);
    const p = { y, mo, d, h: hh, mi: mm };

    const cleanName = title
      .replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*/g, " ")
      .replace(/\s*\((early|late)\)\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const k = cleanName.toLowerCase() + "|" + y + mo + d + "|" + venue.loc + "|" + time;
    if (seen.has(k)) continue;
    seen.add(k);
    seen.add(url);

    out.push(
      eventRow(src, {
        title: cleanName || title,
        p,
        time,
        url,
        types: ["Live music", venue.loc],
        cat: "Music",
        loc: venue.loc,
        addr: venue.addr,
        lat: venue.lat,
        lng: venue.lng,
      })
    );
  }
  return out;
}

// Fixed recurring community events with a public published schedule (no API)
function fromStanding(src) {
  const out = [];
  const now = new Date();
  const today = chicagoParts(now.getTime());
  // generate next ~45 days of occurrences
  for (let i = 0; i < 50; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const p = chicagoParts(dt.getTime());
    // skip past days
    const dateStr = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    const todayStr = `${today.y}-${String(today.mo).padStart(2, "0")}-${String(today.d).padStart(2, "0")}`;
    if (dateStr < todayStr) continue;

    let ok = false;
    if (src.rule === "sundaysExceptFirst") {
      // JS: 0 = Sunday. First Sunday of month = day 1–7.
      const jsDay = new Date(p.y, p.mo - 1, p.d).getDay();
      ok = jsDay === 0 && p.d > 7;
    } else if (src.rule === "everySunday") {
      ok = new Date(p.y, p.mo - 1, p.d).getDay() === 0;
    }
    if (!ok) continue;

    const [hh, mm] = (src.time || "11:00").split(":").map(Number);
    p.h = hh;
    p.mi = mm;
    out.push(
      eventRow(src, {
        title: src.title || src.name,
        p,
        time: src.time || "11:00",
        url: src.url,
        types: src.types || [],
        cat: src.cat || "Music",
        loc: src.loc,
        addr: src.addr,
        lat: src.lat,
        lng: src.lng,
        desc: src.desc,
      })
    );
  }
  return out;
}

// Weather is the deciding factor for an outdoor plan in Minnesota. api.weather.gov
// is free and keyless; its hourly forecast runs ~6.5 days, which covers the
// default views. One fetch for the metro (events here are within ~15 miles, well
// inside a single NWS grid cell's usefulness) — per-event lookups would be
// hundreds of requests for no real accuracy gain.
// Only trust "free" when the source says so. Eventbrite's search payload carries
// no price at all, so the front-end chip means "stated free by the venue/library",
// not "we checked" — better a smaller honest set than a chip that lies.
function isFreeCost(cost) {
  const c = String(cost || "").trim();
  if (!c) return false;
  return /^(free|no charge|no cost|donation|\$?0(\.00)?)$/i.test(c);
}

const OUTDOOR_CATS = new Set(["Outdoors", "Fitness", "Volunteer", "Family"]);

async function addWeather(events) {
  let periods;
  try {
    const pt = await getJSON("https://api.weather.gov/points/44.9778,-93.2650", 6000);
    const url = pt.properties && pt.properties.forecastHourly;
    if (!url) return;
    const fc = await getJSON(url, 8000);
    periods = fc.properties && fc.properties.periods;
    if (!Array.isArray(periods)) return;
  } catch {
    return; // forecast is a bonus, never a reason to fail the response
  }

  // index by local "YYYY-MM-DDTHH" so lookup is a plain string match
  const byHour = new Map();
  for (const p of periods) {
    const m = String(p.startTime || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2})/);
    if (m) byHour.set(m[1] + "T" + m[2], p);
  }

  for (const e of events) {
    if (!OUTDOOR_CATS.has(e.cat) || e.fmt === "online") continue;
    const p = byHour.get(e.date + "T" + e.time.slice(0, 2));
    if (!p) continue;
    const pop = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
    e.wx = {
      temp: p.temperature,
      unit: p.temperatureUnit || "F",
      summary: p.shortForecast || "",
      pop: Number.isFinite(pop) ? pop : null,
    };
  }
}

module.exports = async (req, res) => {
  const now = new Date();
  const end = new Date(now.getTime() + 45 * 864e5); // next 45 days
  const startISO = chicagoDateKey(now) + " 00:00:00";
  const endISO = chicagoDateKey(end) + " 23:59:59";
  const endStr = chicagoDateKey(end);
  const todayStr = chicagoDateKey(now);

  const sources = [];
  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      let list;
      if (src.type === "ics") list = parseICS(await getText(src.url), src);
      else if (src.type === "commonground") list = await fromCommonGround(src);
      else if (src.type === "biblio") list = await fromBiblio(src);
      else if (src.type === "livewhale") list = await fromLiveWhale(src);
      else if (src.type === "squarespace") list = await fromSquarespace(src);
      else if (src.type === "rss") list = await fromRSS(src);
      else if (src.type === "opendate") list = await fromOpenDate(src);
      else if (src.type === "meetup") list = await fromMeetup(src);
      else if (src.type === "eventbrite") list = await fromEventbrite(src);
      else if (src.type === "cabooze") list = await fromCabooze(src);
      else if (src.type === "firstave") list = await fromFirstAve(src);
      else if (src.type === "standing") list = fromStanding(src);
      else list = await fromTribe(src, startISO, endISO);
      return { src, list };
    })
  );

  let events = [];
  results.forEach((r, i) => {
    const src = SOURCES[i];
    if (r.status === "fulfilled") {
      const list = r.value.list.filter((e) => e.date >= todayStr && e.date <= endStr && e.lat && e.lng);
      events = events.concat(list);
      sources.push({ name: src.name, count: list.length, ok: true });
    } else {
      sources.push({ name: src.name, count: 0, ok: false, error: String(r.reason && r.reason.message || r.reason || "Unavailable") });
    }
  });

  // A venue's own calendar beats aggregators: drop Meetup/Eventbrite rows at
  // venues we already pull directly — organizers leave stale times on
  // aggregators (found live: Eventbrite said 6 PM, Malcolm Yards said 10 AM).
  const venueKey = (s) => String(s || "").toLowerCase().replace(/\bmn\b/g, "minnesota")
    .replace(/\b(the|at|market|taproom|co|company|of)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const directKeys = SOURCES
    .filter((s) => s.base || s.type === "cabooze" || s.type === "firstave" || s.type === "standing")
    .map((s) => venueKey(s.loc || s.name))
    .filter((k) => k.length > 4);
  // also protect sister-venue names pulled under First Avenue
  for (const v of Object.values(FIRSTAVE_VENUE_MAP)) {
    const k = venueKey(v.loc);
    if (k.length > 4) directKeys.push(k);
  }
  directKeys.push(venueKey("The Cabooze"), venueKey("Tapestry Folkdance Center"));
  events = events.filter((e) => {
    if (!/^(meetup|eventbrite)/i.test(e.source)) return true;
    const k = venueKey(e.loc);
    if (k.length < 6) return true;
    return !directKeys.some((d) => k.includes(d) || d.includes(k));
  });

  // de-dupe (same title+date+venue) and sort by soonest
  const seen = new Set();
  events = events
    .filter((e) => {
      const k = e.name.toLowerCase().replace(/\W+/g, " ").trim() + "|" + e.date + "|" + e.time;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // Drop-in programs run on repeat all day (Como Zoo lists "Zookeeper Talk" up
  // to 6x daily), which buried every other venue in a day's list. Keep the first
  // few showings so the day is still browsable and the program is still findable.
  const perDay = new Map();
  events = events.filter((e) => {
    const k = e.source + "|" + e.name.toLowerCase().replace(/\W+/g, " ").trim() + "|" + e.date;
    const n = (perDay.get(k) || 0) + 1;
    perDay.set(k, n);
    return n <= 3;
  });

  // Midnight "all day" fundraisers / multi-week campaigns aren't something to go do at 12:00 AM
  events = events.filter((e) => e.time !== "00:00" && e.time !== "0:00");

  // Flag standing programs so the front-end can offer "hide daily repeats" —
  // Como Zoo's 9 recurring animal talks otherwise are most of Kids & family.
  const runCount = new Map();
  const seriesKey = (e) => e.source + "|" + e.name.toLowerCase().replace(/\W+/g, " ").trim();
  for (const e of events) runCount.set(seriesKey(e), (runCount.get(seriesKey(e)) || 0) + 1);
  for (const e of events) if (runCount.get(seriesKey(e)) >= 8) e.series = true;

  await addWeather(events);

  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=21600");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({ updated: new Date().toISOString(), sources, events });
};
