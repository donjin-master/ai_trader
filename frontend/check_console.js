const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[Browser Console ${msg.type()}] ${msg.text()}`));
  page.on('pageerror', error => console.log(`[Browser Error] ${error.message}`));
  
  console.log("Navigating to dashboard...");
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle' });
  
  console.log("Navigating to journal...");
  await page.goto('http://localhost:3000/journal', { waitUntil: 'networkidle' });
  
  await browser.close();
})();
