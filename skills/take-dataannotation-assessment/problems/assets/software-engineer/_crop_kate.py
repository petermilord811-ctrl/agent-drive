from PIL import Image

im = Image.open(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_url_kate.png"
)
# Try a few crops of the Kate content area
for name, box in [
    ("a", (500, 250, 1400, 700)),
    ("b", (520, 280, 1380, 550)),
    ("c", (540, 300, 1360, 480)),
]:
    crop = im.crop(box)
    out = rf"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_url_kate_{name}.png"
    crop.save(out)
    print(name, crop.size)
