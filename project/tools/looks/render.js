const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const ROOT = require("path").join(__dirname, "../..");
const OUT = ROOT + "/public/looks";
const FPS = +(process.env.FPS || 15), Q = process.env.Q || "60";
const plan = JSON.parse(fs.readFileSync(process.env.PLAN, "utf8"));
const only = process.argv[2] ? process.argv[2].split(",") : null;
(async () => {
  const browser = await chromium.launch();
  for (const p of plan) {
    if (only && !only.includes(p.name)) continue;
    const [W, H] = p.vw == 190 ? [200, 210] : p.vw == 100 ? [128, 128] : [144, 144];
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${p.anim.replace("<svg ", `<svg id='s' width='${W}' height='${H}' preserveAspectRatio='none' `)}</body></html>`);
    await page.evaluate(() => document.getElementById("s").pauseAnimations());
    const dir = require("os").tmpdir() + "/look-frames/" + p.name; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const n = Math.round(p.L * FPS), T0 = p.L * 10;
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => document.getElementById("s").setCurrentTime(t), T0 + i / FPS);
      await page.screenshot({ path: `${dir}/f${String(i).padStart(4, "0")}.png`, omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
    }
    await page.close();
    const kb = execFileSync("python3", [__dirname + "/encode.py", dir, `${OUT}/${p.name}.webp`, String(FPS), Q]).toString().trim();
    console.log(p.name, "L=" + p.L, W + "x" + H, n + "f", kb + "KB");
  }
  await browser.close();
})();
