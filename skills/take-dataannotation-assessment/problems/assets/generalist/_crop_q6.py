from PIL import Image

base = r"d:\5.AI\DA assessments\agent-drive\skills\take-dataannotation-assessment\problems\assets\generalist"

for name in ["q6.png", "q6_pd.png", "q6_top.png"]:
    im = Image.open(f"{base}\\{name}")
    w, h = im.size
    print(name, w, h)
    # content card roughly right of sidebar
    if w >= 1800:
        # full screen
        prompt = im.crop((700, 160, 1850, 280))
        left = im.crop((700, 250, 1250, 900))
        right = im.crop((1250, 250, 1850, 900))
    else:
        # already content-ish
        prompt = im.crop((0, 0, w, min(200, h)))
        left = im.crop((0, 80, w // 2, h))
        right = im.crop((w // 2, 80, w, h))
    stem = name.replace(".png", "")
    prompt.save(f"{base}\\_{stem}_prompt.png")
    left.save(f"{base}\\_{stem}_A.png")
    right.save(f"{base}\\_{stem}_B.png")
    print(" wrote", stem)
