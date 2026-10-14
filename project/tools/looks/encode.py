import sys, glob, os
from PIL import Image
d, out, fps, q = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
fr = [Image.open(f).convert("RGBA") for f in sorted(glob.glob(d + "/*.png"))]
# (whole milliseconds that add up to the exact rate - 60 fps: 17, 17, 16, ...)
durations = [round((i + 1) * 1000 / fps) - round(i * 1000 / fps) for i in range(len(fr))]
fr[0].save(out, save_all=True, append_images=fr[1:], duration=durations, loop=0, quality=q, method=4, minimize_size=True, allow_mixed=True)
print(os.path.getsize(out) // 1024)
