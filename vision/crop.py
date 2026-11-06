"""crop.py <src.png> <dst.png> <x0,y0,x1,y1> <scale>
@tool crop and enlarge part of a screenshot so a model can read small print (Python + Pillow)
@run  python -I vision/crop.py shot.png crop.png 460,215,965,720 2.3

Crop a rectangle out of a screenshot and upscale it (LANCZOS) so a vision model can read small
detail — a sudoku grid, an omnibox, a toolbar — with certainty. Needs Pillow (`pip install Pillow`).

  python -I crop.py view.png board.png 460,275,965,780 2.4     # the 9x9 grid, ~2.4x
  python -I crop.py view.png omni.png  0,45,1100,130 1.8        # the address bar + suggestions
  python -I crop.py view.png result.jpg 440,200,1480,860 0.8    # a task's RESULT for chat: a .jpg, scaled down

A chat picture (chat-img, or `file` on the finishing status) must stay under ~45 KB: name it .jpg and it is
saved as JPEG and shrunk until it fits (quality first, down to 50, then size). The byte size is printed.

Run with python -I so a planted module next to an untrusted image can't be imported. The multi-line
`python -c` form breaks the pyenv-win batch shim — always use a script file like this one.
"""
import os
import sys
from PIL import Image

src, dst, box, scale = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
x0, y0, x1, y1 = [int(v) for v in box.split(',')]
im = Image.open(src).crop((x0, y0, x1, y1))
im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
CHAT_CAP = 44000   # bytes: a chat picture rides as a data: URL capped at 60000 chars (base64 adds 1/3)
if dst.lower().endswith(('.jpg', '.jpeg')):
    im = im.convert('RGB')   # JPEG has no alpha; a screenshot is often RGBA
    q = 80
    while True:
        im.save(dst, quality=q)
        if os.path.getsize(dst) <= CHAT_CAP or im.width < 200:
            break
        if q > 50:
            q -= 15
        else:
            im = im.resize((int(im.width * 0.85), int(im.height * 0.85)), Image.LANCZOS)
else:
    im.save(dst)
print('saved', im.size, os.path.getsize(dst), 'bytes')
