from PIL import Image

im = Image.open(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_sidebar.png"
)
# left sidebar of assessment content
crop = im.crop((380, 160, 720, 980))
out = r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_sidebar_crop.png"
crop.save(out)
print("saved", crop.size)
