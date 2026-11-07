# fs.py -- what stat, read, write and rm share on Linux: a path made whole, and a failure as a code.
#
# PATHS ARE LITERAL AND ARE BYTES. The path arrives inside the base64 args, so no shell ever sees it: spaces,
# quotes, $, *, ~ and any non-ASCII character reach the system calls exactly as sent, and nothing is expanded
# (~ is a file named ~). It is handed to them as UTF-8 BYTES, not as a str: under the C/POSIX locale that a root
# service often runs in, Python 3.6 encodes a str path as ASCII, and a name with an accent fails with
# UnicodeEncodeError. A relative path resolves against the host process's folder, so every answer says `full`,
# the absolute path actually used (a name that is not UTF-8 comes back with \udcXX escapes).
#
# A FAILURE IS A CODE, {ok:false, err, verb, full, msg}, said in words by desk.js's parse() -- the same codes and
# so the same sentences as fs.ps1. ENOENT is "no such folder" when the folder is what is missing.
import errno

CODES = {errno.ENOENT: 'nofile', errno.EACCES: 'denied', errno.EPERM: 'denied', errno.EISDIR: 'isdir',
         errno.ENOTDIR: 'notdir', errno.ENOSPC: 'diskfull', errno.EROFS: 'rofs', errno.ENAMETOOLONG: 'toolong',
         getattr(errno, 'ETXTBSY', -1): 'inuse', getattr(errno, 'EDQUOT', -2): 'diskfull'}


def bpath(p):
    return os.path.abspath(str(p).encode('utf-8', 'surrogateescape'))


def text(b):
    return b.decode('utf-8', 'surrogateescape')


def err(e, verb, p):
    o = {'ok': False, 'err': CODES.get(getattr(e, 'errno', None), 'other'), 'verb': verb, 'full': text(p), 'msg': str(getattr(e, 'strerror', None) or e)}
    if o['err'] == 'nofile' and not os.path.isdir(os.path.dirname(p)):
        o['err'], o['dir'] = 'nodir', text(os.path.dirname(p))
    return o
