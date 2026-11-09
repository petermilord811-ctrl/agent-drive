from PIL import Image
import numpy as np

im = Image.open(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_url_kate.png"
)
a = np.array(im.convert("RGB"))
# Find near-white content area (Kate editor pane)
white = (a[:, :, 0] > 245) & (a[:, :, 1] > 245) & (a[:, :, 2] > 245)
ys, xs = np.where(white)
# focus on center
m = (xs > 500) & (xs < 1400) & (ys > 250) & (ys < 700)
xs, ys = xs[m], ys[m]
print("white", len(xs), "x", xs.min(), xs.max(), "y", ys.min(), ys.max())

# Find dark text pixels in that box
box = a[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
r, g, b = box[:, :, 0], box[:, :, 1], box[:, :, 2]
text = (r < 80) & (g < 80) & (b < 80)
tys, txs = np.where(text)
print("text", len(txs), "local y", tys.min(), tys.max())

# Cluster text into horizontal bands (wrapped lines)
bands = []
y = int(tys.min())
ymax = int(tys.max())
while y <= ymax:
    band = (tys >= y) & (tys < y + 28)
    if band.sum() > 50:
        y0, y1 = int(tys[band].min()), int(tys[band].max())
        x0, x1 = int(txs[band].min()), int(txs[band].max())
        bands.append((y0, y1, x0, x1))
        y = y1 + 5
    else:
        y += 1

print("bands", bands)
ox, oy = int(xs.min()), int(ys.min())
for i, (y0, y1, x0, x1) in enumerate(bands):
    # pad
    pad = 4
    crop = im.crop(
        (
            ox + x0 - pad,
            oy + y0 - pad,
            ox + x1 + pad + 1,
            oy + y1 + pad + 1,
        )
    )
    # upscale 3x for readability
    crop = crop.resize((crop.width * 3, crop.height * 3), Image.NEAREST)
    out = rf"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_url_line{i}.png"
    crop.save(out)
    print("wrote", out, crop.size)
