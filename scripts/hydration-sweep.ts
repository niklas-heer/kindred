// Opens every main page of a running Kindred in Safari's engine (and Chrome, if asked) and reports the pages whose text the
// browser draws differently from the server: React then throws the page's text away and draws it again (error #418). The
// journeys run in Chromium, which agrees with the server on every date and name, so they cannot see this; Safari does not
// (see AGENTS.md, "Dates on a page"). Far time zones also show text that depends on what day it is.
//
//   mise run demo                                             a server to look at (http://localhost:4901), in another shell
//   node scripts/hydration-sweep.ts http://localhost:4901     WebKit at iPhone size; en, de and af; three time zones
//   node scripts/hydration-sweep.ts <origin> --engines webkit,chrome --langs en --zones Europe/Berlin --trees modern
//
// It needs Playwright's WebKit once: `npx playwright install webkit`. It only reads, and signs in nowhere: point it at a
// demo (KINDRED_DEMO=1), where every page is open. An error it lists while a page was being left (a request cut off by the
// next page) is not a finding; a `#418` is.
import { chromium, devices, webkit } from "@playwright/test";

const args = process.argv.slice(2);
const origin = args.find((a) => /^https?:\/\//.test(a));
if (!origin) {
  console.error("usage: node scripts/hydration-sweep.ts <origin> [--engines webkit,chrome] [--langs en,de,af] [--zones a,b] [--trees modern,realm]");
  process.exit(2);
}
const list = (name: string, fallback: string) => (args[args.indexOf(`--${name}`) + 1] && args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback).split(",");
const engines = list("engines", "webkit");
const langs = list("langs", "en,de,af");
const zones = list("zones", "Europe/Berlin,Pacific/Kiritimati,Pacific/Pago_Pago");
const trees = list("trees", "modern,realm");
const PAGES = ["", "today", "people", "chronicle", "almanac", "atlas", "campaign", "houses", "history", "sources", "print", "gallery", "contacts", "statistics", "research"];
const CHROME = process.env.KINDRED_E2E_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const found = new Map<string, Set<string>>();
for (const engine of engines) {
  const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: CHROME });
  for (const zone of zones) {
    for (const lang of langs) {
      const context = await browser.newContext({
        ...(engine === "webkit" ? devices["iPhone 15"] : { viewport: { width: 1280, height: 800 } }),
        locale: lang === "en" ? "en-GB" : lang,
        timezoneId: zone,
      });
      // The language a visitor without an account has chosen (src/lib/auth/session.server.ts, guestChoice).
      await context.addCookies([{ name: "kindred_locale_guest", value: lang, url: origin }]);
      const page = await context.newPage();
      let where = "";
      page.on("pageerror", (error) => {
        const what = /React error #(\d+)/.exec(String(error))?.[1] ?? String(error).slice(0, 80);
        const key = `${where} #${what}`;
        if (!found.has(key)) found.set(key, new Set());
        found.get(key)!.add(`${engine}/${zone}/${lang}`);
      });
      for (const tree of trees) {
        for (const path of PAGES) {
          where = `/${tree}/${path}`;
          try {
            await page.goto(`${origin}/${tree}/${path}`, { waitUntil: "networkidle", timeout: 30_000 });
            await page.waitForTimeout(300);
          } catch {
            // A slow page is not what this looks for.
          }
        }
      }
      await context.close();
    }
  }
  await browser.close();
}
for (const [key, who] of [...found].sort()) console.log(key, "←", [...who].join(" "));
console.log(`${found.size} page(s) with a hydration or uncaught error`);
process.exit([...found.keys()].some((key) => /#\d+$/.test(key)) ? 1 : 0);
