import sys, glob, os
from PIL import Image
d, out, fps, q = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
fr = [Image.open(f).convert("RGBA") for f in sorted(glob.glob(d + "/*.png"))]
fr[0].save(out, save_all=True, append_images=fr[1:], duration=round(1000 / fps), loop=0, quality=q, method=4, minimize_size=True, allow_mixed=True)
print(os.path.getsize(out) // 1024)
