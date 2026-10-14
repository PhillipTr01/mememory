# Retime the SMIL animations of an SVG so all of them loop seamlessly in L seconds:
# every dur becomes L/n (n a whole number, as near as possible to the old speed - a slow one: L), every begin is
# taken modulo the new dur (the phase stays).
import re
def retime(svg, L):
    def fix_dur(d):
        n = max(1, round(L / d))
        return L / n
    durs = {}
    def tag(m):
        t = m.group(0)
        dm = re.search(r"dur=(['\"])([\d.]+)s\1", t)
        if not dm: return t
        d = float(dm.group(2)); nd = fix_dur(d)
        t = t.replace(dm.group(0), "dur='%gs'" % round(nd, 4))
        bm = re.search(r"begin=(['\"])(-?[\d.]+)s\1", t)
        if bm:
            b = float(bm.group(2)) * nd / d  # the same phase of its cycle
            t = t.replace(bm.group(0), "begin='%gs'" % round(b, 4))
        return t
    return re.sub(r"<animate[^>]*>|<animateTransform[^>]*>|<animateMotion[^>]*>|<set[^>]*>", tag, svg)
