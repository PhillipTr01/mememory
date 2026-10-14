# Plan for render.js: every source (src/<name>.svg, or only the names given) -> its loop, its static part (an SVG
# without animation - it goes into looks.css) and its animated part (rendered to public/looks/<name>.webp)
# python3 tools/looks/plan.py out.json [name,name]
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from split import split
from retime import retime
here = os.path.dirname(__file__)
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
plan = []
for entry in json.load(open(os.path.join(here, "index.json"))):
    if only and entry["name"] not in only:
        continue
    svg = open(os.path.join(here, "src", entry["name"] + ".svg")).read()
    st, an, ns, na = split(retime(svg, entry["loop"]))
    w, h = (190, 200) if "viewBox='0 0 190 200'" in svg or 'viewBox="0 0 190 200"' in svg else (100, 100) if "0 0 100 100" in svg else (200, 200)
    plan.append({"name": entry["name"], "L": entry["loop"], "static": st if ns else None, "anim": an, "vw": w, "vh": h})
json.dump(plan, open(sys.argv[1], "w"))
for p in plan:
    print(p["name"], "static part:", "yes" if p["static"] else "no")
