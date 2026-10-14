"""Still images: public/looks/<name>.still.webp - for the shop, where the looks stand still until the mouse is over an
item (looks.css: look-still, casino_looks.js). One frame of public/looks/<name>.webp (the one that shows the most of
the look) drawn on the parts that do not move (the SVG under it in its look-lite rule) - one image in place of the two.
Writes the look-still rules at the end of looks.css (between the STILL markers).

python3 tools/looks/still.py   (Playwright - NODE_PATH to its node_modules -, Pillow with WebP)
"""
import json
import os
import re
import subprocess
import tempfile

from PIL import Image, ImageStat

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
LOOKS = os.path.join(ROOT, "public", "looks")
CSS = os.path.join(ROOT, "public", "styles", "looks.css")
START = "/* STILL - written by tools/looks/still.py */"
END = "/* STILL end */"

css = open(CSS).read()
if START in css:
    css = css[: css.index(START)].rstrip() + "\n" + css[css.index(END) + len(END) :].lstrip("\n")
rules = re.findall(r'\n(\.mm-avatar\.look-lite[^{\n]*) \{\n  background: (url\("\.\./looks/(\w+)\.webp"\) center / ([^,;]+?) no-repeat[^\n]*);\n\}', css)

tmp = tempfile.mkdtemp()
jobs = []
for selector, background, name, size in rules:
    # (a rule may show more than one of them - all on the still)
    for each in re.findall(r"\.\./looks/(\w+)\.webp", background):
        im = Image.open(os.path.join(LOOKS, each + ".webp"))
        best, most = 0, -1
        for i in range(0, im.n_frames, 10):
            im.seek(i)
            cover = ImageStat.Stat(im.convert("RGBA").getchannel("A")).sum[0]
            if cover > most:
                best, most = i, cover
        im.seek(best)
        frame = os.path.join(tmp, each + ".png")
        im.convert("RGBA").save(frame)
        background = background.replace("../looks/" + each + ".webp", "file://" + frame)
        if each == name:
            w, h = im.size
    jobs.append({"name": name, "w": w, "h": h, "background": background, "out": os.path.join(tmp, name + ".still.png")})

open(os.path.join(tmp, "x.html"), "w").write('<body style="margin:0"><div id="d"></div></body>')
script = os.path.join(tmp, "draw.js")
open(script, "w").write(
    """
const { chromium } = require("playwright");
const jobs = %s;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // (a page from a file - it may show the frames, files too)
  await page.goto("file://%s/x.html");
  for (const job of jobs) {
    await page.evaluate((job) => { const d = document.getElementById("d"); d.style.cssText = "width:" + job.w + "px;height:" + job.h + "px"; d.style.background = job.background; }, job);
    await page.waitForTimeout(50);
    await page.locator("#d").screenshot({ path: job.out, omitBackground: true });
  }
  await browser.close();
})();
"""
    % (json.dumps(jobs), tmp)
)
subprocess.run(["node", script], check=True)

out = []
for (selector, background, name, size), job in zip(rules, jobs):
    Image.open(job["out"]).save(os.path.join(LOOKS, name + ".still.webp"), "WEBP", quality=80, method=6)
    out.append('%s {\n  background: url("../looks/%s.still.webp") center / %s no-repeat;\n}\n' % (selector.replace(".look-lite", ".look-lite.look-still"), name, size))
    print(name)

css = css.rstrip() + "\n\n" + START + "\n" + "\n".join(out) + END + "\n"
open(CSS, "w").write(css)
