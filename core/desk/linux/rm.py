# rm.py -- the `rm` op on Linux: remove the temp file a capture (camera, audio) left, once it has been read.
# Args: {path}. Answer: {ok, removed (false: it was already gone), full}. Anything that is not one of those files
# is refused (err "notmine"; temp.py says which they are) -- this is not a general delete. A link of that name is
# removed itself; what it points at is never touched.
P = bpath(ARGS.get('path', ''))
if not mine(text(P)):
    out({'ok': False, 'err': 'notmine', 'verb': 'remove', 'full': text(P), 'temp': TDIR})
try:
    os.unlink(P)
except FileNotFoundError:
    out({'ok': True, 'removed': False, 'full': text(P)})
except OSError as e:
    out(err(e, 'remove', P))
out({'ok': True, 'removed': True, 'full': text(P)})
