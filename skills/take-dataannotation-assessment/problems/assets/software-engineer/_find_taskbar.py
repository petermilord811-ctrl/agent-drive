from PIL import Image
import numpy as np

im = Image.open(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_taskbar.png"
)
# Crop taskbar bottom
tb = im.crop((0, 1000, 900, 1080))
tb.save(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_taskbar_crop.png"
)
print("saved crop", tb.size)
# Also crop browser tabs
tabs = im.crop((0, 0, 1920, 80))
tabs.save(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\software-engineer\_tabs_crop.png"
)
print("saved tabs")
