from PIL import Image
import numpy as np

a = np.array(
    Image.open(
        r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_v34123.png"
    ).convert("RGB")
)
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mask = (b > 150) & (b > r + 40) & (b > g + 20) & (r < 120) & (g < 160)
ys, xs = np.where(mask)
m = (xs > 500) & (xs < 1500) & (ys > 200) & (ys < 400)
print("n", m.sum())
print("x", xs[m].min(), xs[m].max(), "y", ys[m].min(), ys[m].max())
print("cx", int(xs[m].mean()), "cy", int(ys[m].mean()))
