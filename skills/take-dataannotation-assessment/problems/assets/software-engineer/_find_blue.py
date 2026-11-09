from PIL import Image
import numpy as np

im = Image.open(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_verify_screen.png"
)
a = np.array(im.convert("RGB"))
print("size", im.size)
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mask = (b > 150) & (b > r + 40) & (b > g + 20) & (r < 120) & (g < 160)
ys, xs = np.where(mask)
print("blue count", len(xs))
if len(xs):
    print("x range", xs.min(), xs.max(), "y range", ys.min(), ys.max())
    for y0 in range(int(ys.min()), int(ys.max()) + 1, 5):
        m = (ys >= y0) & (ys < y0 + 5)
        if m.sum() > 20:
            print(f"band y={y0}-{y0+4}: x={xs[m].min()}-{xs[m].max()} n={m.sum()}")
    m2 = (xs > 500) & (xs < 1500) & (ys > 200) & (ys < 500)
    print("content blue", m2.sum())
    if m2.sum():
        print("cx", int(xs[m2].mean()), "cy", int(ys[m2].mean()))
        print("x", xs[m2].min(), xs[m2].max(), "y", ys[m2].min(), ys[m2].max())
