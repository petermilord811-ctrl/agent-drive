# write.py -- the `write` op on Linux: put one chunk of a file on the machine. The bytes are the third argument
# (base64; see lean.py). Args: {path, append, at?}. Answer: {ok, size (the file's size after), wrote, full}.
#
# A FILE IN CHUNKS, as write.ps1: append:false creates the file or empties it; append:true adds to its end and
# refuses a file that is not there (err "noappend"); `at` (with append) cuts the file back to where this chunk
# starts first, so a chunk sent twice lands once, and refuses a file shorter than that (err "gap").
#
# WHOSE FILE. A host run as root would leave every new file owned by root -- in the person's home, a file they
# could read but never save over. So a file this CREATES as root is handed to whoever owns the folder it is in
# (their home, their Desktop); an existing file keeps its owner and mode (it is only truncated). New files get
# 0666 less the umask, as `cp` would.
P = bpath(ARGS.get('path', ''))
data = base64.b64decode(sys.argv[3] if len(sys.argv) > 3 else '')
if os.path.isdir(P):
    out({'ok': False, 'err': 'isdir', 'verb': 'write', 'full': text(P)})
app = bool(ARGS.get('append'))
if app and not os.path.exists(P):
    out({'ok': False, 'err': 'noappend', 'verb': 'write', 'full': text(P)})
new = not app and not os.path.exists(P)
try:
    fd = os.open(P, os.O_WRONLY | getattr(os, 'O_BINARY', 0) | (0 if app else os.O_CREAT | os.O_TRUNC), 0o666)
    if app and ARGS.get('at') is not None:
        at = int(ARGS.get('at'))
        size = os.fstat(fd).st_size
        if size < at:
            out({'ok': False, 'err': 'gap', 'verb': 'write', 'full': text(P), 'size': size, 'at': at})
        os.ftruncate(fd, at)
    os.lseek(fd, 0, 2)
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]
    size = os.fstat(fd).st_size
    os.close(fd)
except OSError as e:
    out(err(e, 'write', P))
if new and hasattr(os, 'geteuid') and os.geteuid() == 0:
    try:
        d = os.stat(os.path.dirname(P))
        if d.st_uid != 0:
            os.chown(P, d.st_uid, d.st_gid)
    except OSError:
        pass
out({'ok': True, 'size': size, 'wrote': len(data), 'full': text(P)})
