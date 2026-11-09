from PIL import Image
import numpy as np

a = np.array(
    Image.open(
        r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_q4_live.png"
    ).convert("RGB")
)
r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
mask = (b > 150) & (b > r + 40) & (b > g + 20) & (r < 120) & (g < 160)
ys, xs = np.where(mask)
m = (xs > 700) & (xs < 1600) & (ys > 250) & (ys < 550)
ys, xs = ys[m], xs[m]
for y0 in range(int(ys.min()), int(ys.max()) + 1, 6):
    band = (ys >= y0) & (ys < y0 + 6)
    if band.sum() > 30:
        print(
            f"y={y0}-{y0+5} x={xs[band].min()}-{xs[band].max()} n={band.sum()}"
        )
