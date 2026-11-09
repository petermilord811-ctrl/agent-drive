"""Find sidebar leaf Y positions from full screenshot (dark text in left rail)."""
from PIL import Image
import numpy as np

im = Image.open(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_full_sidebar.png"
)
a = np.array(im.convert("RGB"))
# left rail content
rail = a[160:980, 400:700]
r, g, b = rail[:, :, 0], rail[:, :, 1], rail[:, :, 2]
# near-black text
text = (r < 60) & (g < 60) & (b < 60)
# row density
h = text.shape[0]
dens = text.sum(axis=1)
# find bands of text rows
bands = []
y = 0
while y < h:
    if dens[y] > 8:
        y0 = y
        while y < h and dens[y] > 3:
            y += 1
        y1 = y
        if y1 - y0 >= 6:
            bands.append((y0, y1, int(dens[y0:y1].mean())))
    y += 1

# merge nearby bands into leaf rows (gap < 8)
leaves = []
for y0, y1, d in bands:
    if not leaves or y0 - leaves[-1][1] > 10:
        leaves.append([y0, y1])
    else:
        leaves[-1][1] = y1

print("leaf count", len(leaves))
for i, (y0, y1) in enumerate(leaves):
    cy = 160 + (y0 + y1) // 2
    print(f"{i:02d} screen_y={cy} band={y0}-{y1}")
