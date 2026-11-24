#!/usr/bin/env node
/**
 * Gather 2 smoke test: drives the new app at / (the old dayboard is checked by smoke.mjs at /classic.html).
 * Run: PW_BIN=... GATHER_URL=http://localhost:8841 node test/smoke-app.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.GATHER_URL || "https://gather-six-iota.vercel.app";
const browser = await chromium.launch(process.env.PW_BIN ? { executablePath: process.env.PW_BIN } : {});
const results = [];
const check = (name, ok, extra = "") => results.push({ name, ok: !!ok, extra });
const ready = (p) => p.waitForFunction(() => document.querySelectorAll("#top5 .card").length > 0, null, { timeout: 90000 });

try {
  // --- phone, first visit ---
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await ready(p);
  check("For You shows a top 5", (await p.locator("#top5 .card").count()) === 5);
  check("feed has events", (await p.locator("#feed .card").count()) >= 5);
  check("group strip has groups", (await p.locator("#groupStrip .gcard").count()) >= 3);
  check("no sideways scroll on a phone", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check("at least 3 top picks have photos", (await p.locator("#top5 .ph:not(.none)").count()) >= 3);
  const kinds = await p.evaluate(() => new Set(pickTop(pool()).top.map((e) => e.cat)).size);
  check("top 5 is varied (3+ kinds)", kinds >= 3, `kinds=${kinds}`);

  // endless feed
  const before = await p.locator("#feed .card").count();
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(600);
  check("feed keeps loading as you scroll", (await p.locator("#feed .card").count()) > before);

  // event sheet: going + save + hide
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.locator("#top5 .card").first().click();
  await p.waitForSelector("#sheet.on");
  await p.locator('#sheet [data-a="going"]').click();
  check("I'm going sticks", await p.evaluate(() => JSON.parse(localStorage.getItem("g2-going") || "[]").length === 1));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await p.locator('.bnav [data-tab="plans"]').click();
  check("Plans lists the event", (await p.locator("#pGoing .card").count()) === 1);

  // follow a group
  await p.locator('.bnav [data-tab="groups"]').click();
  check("Groups tab lists groups", (await p.locator("#glist .gcard").count()) >= 10);
  const firstFollow = p.locator("#glist .follow").first();
  await firstFollow.click();
  check("Follow sticks", (await firstFollow.getAttribute("aria-pressed")) === "true");
  await p.locator('.bnav [data-tab="you"]').click();
  check("For You shows Your groups", (await p.locator("#gsecTitle").innerText()) === "Your groups");

  // explore search
  await p.locator('.bnav [data-tab="explore"]').click();
  await p.fill("#q", "board game");
  await p.waitForTimeout(400);
  check("search finds board games", (await p.locator("#xlist .card").count()) > 0);
  check("recovery link present", (await p.locator('a[href="/classic.html?mode=support"]').count()) > 0);

  // hide + undo
  await p.locator('.bnav [data-tab="you"]').click();
  const firstTitle = await p.locator("#top5 .title").first().innerText();
  await p.locator("#top5 .card").first().click();
  await p.waitForSelector("#sheet.on");
  await p.locator('#sheet [data-a="h-series"]').click();
  await p.waitForTimeout(400);
  check("Hide removes it from For You", !(await p.locator("#top5 .title").allInnerTexts()).includes(firstTitle));

  // interests change the picks, and survive reload
  await p.locator('.bnav [data-tab="plans"]').click();
  const t0 = await p.evaluate(() => pickTop(pool()).top.map((e) => e.id).join());
  for (const l of ["Make friends", "Games & D&D", "Fantasy & books", "AI & tech", "Big ideas"]) await p.locator("#intChips .chip", { hasText: l }).click();
  await p.waitForTimeout(400);
  const t1 = await p.evaluate(() => pickTop(pool()).top.map((e) => e.id).join());
  check("interests change the top 5", t0 !== t1);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => typeof MY_INT !== "undefined");
  check("interests survive reload", await p.evaluate(() => MY_INT.size === 3));
  check("no JS errors", errs.length === 0, errs.join(" | "));
  await ctx.close();

  // --- feeds down: app says so and offers retry ---
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  await p2.route("**/api/events*", (r) => r.fulfill({ status: 500, body: "{}" }));
  await p2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(1500);
  check("feeds down shows Try again", (await p2.locator("#top5 button", { hasText: "Try again" }).count()) === 1);
  await c2.close();

  // --- desktop ---
  const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p3 = await c3.newPage();
  await p3.goto(BASE + "/?tab=groups", { waitUntil: "domcontentloaded" });
  await p3.waitForFunction(() => document.querySelectorAll("#glist .gcard").length > 0, null, { timeout: 90000 });
  check("?tab=groups opens Groups", await p3.evaluate(() => !document.querySelector("#tab-groups").hidden));
  check("desktop top tabs visible", await p3.locator(".tabs").isVisible());
  await c3.close();
} finally {
  await browser.close();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.extra ? " — " + r.extra : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\nSUMMARY ${results.length - failed}/${results.length} pass`);
process.exit(failed ? 1 : 0);
