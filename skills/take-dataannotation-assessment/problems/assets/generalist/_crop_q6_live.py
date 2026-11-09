from PIL import Image

im = Image.open(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\q6_live_top.png"
)
# content area for dual response cards
im.crop((700, 200, 1850, 320)).save(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_q6l_prompt.png"
)
im.crop((700, 300, 1260, 920)).save(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_q6l_A.png"
)
im.crop((1260, 300, 1850, 920)).save(
    r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist\_q6l_B.png"
)
print("ok", im.size)
