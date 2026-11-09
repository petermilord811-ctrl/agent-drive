from PIL import Image
import numpy as np

a = np.array(
    Image.open(
        r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_role.png"
    ).convert("RGB")
)
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mask = (b > 180) & (r < 100) & (g > 100) & (g < 200) & (b > g)
ys, xs = np.where(mask)
m = (xs > 1100) & (ys > 400) & (ys < 900)
print("n", m.sum())
if m.sum():
    print("x", xs[m].min(), xs[m].max(), "y", ys[m].min(), ys[m].max())
    print("cx", int(xs[m].mean()), "cy", int(ys[m].mean()))
