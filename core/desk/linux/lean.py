# lean.py -- the head of the Linux desk ops that need no desktop session: stat, read, write, rm, camera. A lean
# twin of common.py's head (the same args in, the same one line of JSON out) WITHOUT its session discovery, which
# reads logind's records and up to hundreds of /proc/<pid>/environ files on every run: a file op has no use for
# the desktop, and `write` ships its data on the same command line as this script.
#
# How it travels: as common.py says --
#   python3 -c '<PY_BOOT>' <payload> <args> [<data>]
# <args> is base64 of the UTF-8 JSON args; a write's chunk rides as a third argument, base64 of the bytes (inside
# the JSON it would be base64 twice over). The answer is ONE line, ASCII with \u escapes, and nothing else.
#
# Python 3.6+ (Ubuntu 18.04), and nothing here may assume Linux beyond what it says: the tests run these same
# scripts under Windows' Python too.
import base64, json, os, sys, time

T0 = time.time()
try:
    ARGS = json.loads(base64.b64decode(sys.argv[2]).decode('utf-8'))
except Exception:
    ARGS = {}
OP = str(ARGS.get('op', ''))


def out(o):
    r = {'ok': bool(o.get('ok')), 'op': OP, 'os': 'linux'}
    for k, v in o.items():
        if k not in r:
            r[k] = v
    sys.stdout.write(json.dumps(r, ensure_ascii=True, separators=(',', ':')) + '\n')
    sys.stdout.flush()
    os._exit(0 if r['ok'] else 1)
