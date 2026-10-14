# Animated looks: pre-rendered

The animated looks of the shop (frames, animations, backgrounds - `public/styles/looks.css`) were animated SVGs
(SMIL). A browser redraws such an image on the main thread every frame for every avatar that shows it - a few of
them made the casino pages lag. Now every animated layer is two images:

- `public/looks/<name>.webp` - the moving parts, pre-rendered (an animated WebP: 12 frames a second, a seamless
  loop of 6 or 8 s - every animation in it retimed to repeat exactly within the loop). The browser plays it without
  work on the main thread.
- the parts that do not move - still an SVG (a data URI in looks.css, under the WebP), drawn once.

The sources stay here: `src/<name>.svg` (the original animated SVG), `index.json` (the rule of looks.css it belongs
to, its loop).

## Changing one

1. Edit `src/<name>.svg` (animate it as before - SMIL).
2. `python3 tools/looks/plan.py /tmp/plan.json <name>` - its loop, the static and the animated part.
3. `PLAN=/tmp/plan.json FPS=12 Q=55 node tools/looks/render.js` (Playwright, Pillow with WebP) -
   `public/looks/<name>.webp`.
4. In looks.css: put the new static part (in `/tmp/plan.json`, `static` - `#` as `%23`, `%` as `%25`, `"` as `'`)
   in place of the old one under `url("../looks/<name>.webp")`.

A new look: give it a new name (any - the files are named by it) and an entry in `index.json`.
