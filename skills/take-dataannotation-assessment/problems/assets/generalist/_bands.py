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
m = (ys > 500) & (ys < 850) & (xs > 200) & (xs < 700)
ys, xs = ys[m], xs[m]
for y0 in range(int(ys.min()), int(ys.max()) + 1, 8):
    band = (ys >= y0) & (ys < y0 + 8)
    if band.sum() > 100:
        print(
            f"y={y0}-{y0+7} x={xs[band].min()}-{xs[band].max()} n={band.sum()}"
        )
