// Day 4 checklist verification: load all pages at mobile + desktop widths,
// capture console errors, screenshot each page.
import { chromium } from "playwright";

const pages = ["/", "/journal", "/brain", "/performance", "/settings", "/dna", "/lab"];
const widths = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

const browser = await chromium.launch();
let failures = 0;

for (const vp of widths) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const page = await context.newPage();
  for (const path of pages) {
    const errors = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto(`http://localhost:3000${path}`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const slug = path === "/" ? "live" : path.slice(1);
    await page.screenshot({ path: `screenshots/dash-${slug}-${vp.name}.png`, fullPage: false });

    const relevant = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to fetch key levels")
    );
    if (relevant.length) {
      failures += 1;
      console.log(`FAIL ${path} @${vp.name}: ${relevant.join(" | ").slice(0, 300)}`);
    } else {
      console.log(`OK   ${path} @${vp.name}`);
    }
  }
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "ALL PAGES CLEAN" : `${failures} page(s) with console errors`);
process.exit(failures === 0 ? 0 : 1);
