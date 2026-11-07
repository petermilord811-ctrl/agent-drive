# read.py -- the `read` op on Linux: one chunk of a file, as base64. Changes nothing.
# Args: {path, off, n} (desk.js fills in off 0 and n, and caps n so the answer stays inside the host's 512 KB of
# output). Answer: {ok, total (the file's size now), off, n (bytes in this chunk), full, b64}. The caller asks again
# from off + n until it reaches total; off at or past the end is an empty chunk, not an error.
#
# ONLY REGULAR FILES: a FIFO with no writer would hold the read until the host's 10 s kill (and then nothing comes
# back), and /dev/zero has no end -- so the file is opened non-blocking and anything that is not a regular file is
# refused (err "special").
from stat import S_ISREG

P = bpath(ARGS.get('path', ''))
if os.path.isdir(P):
    out({'ok': False, 'err': 'isdir', 'verb': 'read', 'full': text(P)})
try:
    fd = os.open(P, os.O_RDONLY | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_BINARY', 0))
    st = os.fstat(fd)
    if not S_ISREG(st.st_mode):
        out({'ok': False, 'err': 'special', 'verb': 'read', 'full': text(P)})
    total = st.st_size
    off = min(max(0, int(ARGS.get('off', 0))), total)
    want = min(max(0, int(ARGS.get('n', 0))), total - off)
    os.lseek(fd, off, 0)
    parts, got = [], 0
    while got < want:
        b = os.read(fd, want - got)
        if not b:
            break
        parts.append(b)
        got += len(b)
except OSError as e:
    out(err(e, 'read', P))
out({'ok': True, 'total': total, 'off': off, 'n': got, 'full': text(P), 'b64': base64.b64encode(b''.join(parts)).decode('ascii')})
