# stat.py -- the `stat` op on Linux: is there a file or a folder at this path, and how big is it. Changes nothing.
# Args: {path}. Answer: {ok, exists, dir, size (bytes; null for a folder or nothing), full, mtime (ms since 1970;
# null for nothing)}. Nothing there is still ok -- exists:false is the answer; ok:false means it could not tell.
# A symbolic link is followed (the answer is about what it points at); a dangling one is "nothing there".
from stat import S_ISDIR

P = bpath(ARGS.get('path', ''))
try:
    st = os.stat(P)
except (FileNotFoundError, NotADirectoryError):
    out({'ok': True, 'exists': False, 'dir': False, 'size': None, 'full': text(P), 'mtime': None})
except OSError as e:
    out(err(e, 'look at', P))
d = S_ISDIR(st.st_mode)
out({'ok': True, 'exists': True, 'dir': d, 'size': None if d else st.st_size, 'full': text(P), 'mtime': int(st.st_mtime * 1000)})
