# Split an animated SVG into a static part (no animation - the browser rasterizes it once) and an animated part
# (only what moves). The animated part is drawn on top of the static part.
import re
import xml.etree.ElementTree as ET
SVGNS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVGNS)
ANIM = {"animate", "animateTransform", "animateMotion", "set", "animateColor"}
DEFS = {"defs", "style", "filter", "mask", "clipPath", "linearGradient", "radialGradient", "pattern", "symbol", "title"}
local = lambda tag: tag.split("}")[-1]
REF = re.compile(r"url\(#([\w-]+)\)")

def refs(el):
    out = set()
    for v in el.attrib.values(): out |= set(REF.findall(v))
    return out

def split(svg):
    root = ET.fromstring(svg)
    # ids of definitions that animate (or use something that animates)
    defs = {e.get("id"): e for e in root.iter() if e.get("id")}
    anim_ids = {i for i, e in defs.items() if any(local(c.tag) in ANIM for c in e.iter())}
    changed = True
    while changed:
        changed = False
        for i, e in defs.items():
            if i in anim_ids: continue
            if any(refs(c) & anim_ids for c in e.iter()): anim_ids.add(i); changed = True
    def moving(el):  # the element itself animates, or paints with something animated
        return any(local(c.tag) in ANIM for c in el) or local(el.tag) in ANIM or bool(refs(el) & anim_ids)
    def subtree_moves(el): return any(moving(c) for c in el.iter())
    def build(keep_anim):
        r = ET.fromstring(svg)
        def prune(parent, in_defs):
            for child in list(parent):
                t = local(child.tag)
                if in_defs or t in DEFS:
                    if not keep_anim:  # the static copy: no animation anywhere, also not in the definitions
                        for p in list(child.iter()):
                            for c in list(p):
                                if local(c.tag) in ANIM: p.remove(c)
                        if local(child.tag) in ANIM: parent.remove(child)
                    continue
                if moving(child):
                    if not keep_anim: parent.remove(child)
                    continue
                if subtree_moves(child):
                    prune(child, False)
                    continue
                if keep_anim: parent.remove(child)
        prune(r, False)
        return r
    st, an = build(False), build(True)
    def drawn(r):
        n = 0
        def walk(e, d):
            nonlocal n
            for c in e:
                t = local(c.tag)
                if t in DEFS: continue
                if t in ANIM: continue
                if t != "g": n += 1
                walk(c, d)
        walk(r, 0)
        return n
    tostr = lambda r: ET.tostring(r, encoding="unicode").replace("ns0:", "").replace(":ns0", "")
    return tostr(st), tostr(an), drawn(st), drawn(an)
