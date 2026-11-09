from PIL import Image
import numpy as np

a = np.array(
    Image.open(
        r"d:\5.AI\DA assessments\agent-drive\work\mcp-20261108-005437-934\step1.png"
    ).convert("RGB")
)
# look is 1280x720 scale 1.5 — convert look coords later; use full shot instead
print("look size", a.shape)
