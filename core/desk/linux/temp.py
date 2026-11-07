# temp.py -- where a capture leaves its file on Linux, and the only files `rm` will remove (as temp.ps1).
#
# A photo or a recording can be bigger than one exec's answer (512 KB, as base64), so camera and audio write it
# to a file in this account's temp folder (TMPDIR, else /tmp) and answer its path; the caller reads it with `read`
# and removes it with `rm`. /tmp is everyone's: the name carries 16 random hex digits and the file is created
# O_EXCL | O_NOFOLLOW, mode 0600 -- new, not a link someone planted, and readable by this account alone.
#
# rm removes a file only if it is ONE OF THESE: a name of exactly this shape, directly in this temp folder.
import re
import tempfile

TDIR = tempfile.gettempdir()
MINE = re.compile(r'^agent-drive-(cam-[0-9a-f]{16}\.jpg|rec-[0-9a-f]{16}\.wav)$')


def newtmp(kind, ext):
    p = os.path.join(TDIR, 'agent-drive-%s-%s.%s' % (kind, base64.b16encode(os.urandom(8)).decode('ascii').lower(), ext))
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), 0o600)
    return p, fd


def mine(p):
    d, n = os.path.split(p)
    return bool(MINE.match(n)) and os.path.realpath(d) == os.path.realpath(TDIR)
