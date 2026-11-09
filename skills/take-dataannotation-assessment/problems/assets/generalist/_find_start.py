from PIL import Image
import numpy as np

a = np.array(
    Image.open(
        r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_start.png"
    ).convert("RGB")
)
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mask = (b > 180) & (r < 120) & (g > 80) & (g < 200) & (b > g + 30)
ys, xs = np.where(mask)
# exclude top nav
m = (ys > 500) & (ys < 1000) & (xs > 200) & (xs < 900)
print("n", m.sum())
if m.sum():
    print("x", xs[m].min(), xs[m].max(), "y", ys[m].min(), ys[m].max())
    print("cx", int(xs[m].mean()), "cy", int(ys[m].mean()))
# also all blue below 400
m2 = (ys > 400) & (xs < 1000)
print("all content blue", m2.sum())
if m2.sum():
    print("x", xs[m2].min(), xs[m2].max(), "y", ys[m2].min(), ys[m2].max())
