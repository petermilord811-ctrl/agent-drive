# common.py -- the shared head of every Linux desk script (core/desk.js puts it in front of x11.py and the op's
# own file, drops the comment lines, and ships the whole as ONE base64 argument of
#   python3 -c 'import sys,base64,zlib;exec(zlib.decompress(base64.b64decode(sys.argv[1]),31))' <payload> <args>
# so the command line carries nothing a shell could split or expand, and needs no base64/gzip binaries).
# <args> is base64 of the UTF-8 JSON args, {op, ...}.
#
# The host runs it with /bin/sh -c (linux/screensender_linux.cpp runCapture: stdout+stderr merged, 10 s, then
# the whole process GROUP is killed). It prints exactly ONE line of JSON, {"ok":..,"op":..,"os":"linux",...},
# ASCII with \u escapes, and nothing else.
#
# WHO AND WHERE. A host started inside the desktop session has DISPLAY, XAUTHORITY and friends in its
# environment, and this inherits them. A host run as a root service may not, so the session is found the way
# the host finds it (findGraphicalSession): logind's record of seat0's active session, then that session's
# leader's environment, then any process of that user, then the X socket directory and the usual cookie files.
# Anything that becomes the PERSON'S program (a launched app) or talks to the person's session bus (AT-SPI)
# runs as that person, not as root -- with a clean environment, because the service's own carries
# SM_HOST_SECRET and a process of the user's could read it out of /proc.
#
# Python 3.6+ (Ubuntu 18.04): no walrus, no capture_output/text= in subprocess.
import base64, json, os, re, shutil, subprocess, sys, time

T0 = time.time()
BOOT = 'import sys,base64,zlib;exec(zlib.decompress(base64.b64decode(sys.argv[1]),31))'
try:
    ARGS = json.loads(base64.b64decode(sys.argv[2]).decode('utf-8'))
except Exception:
    ARGS = {}
OP = str(ARGS.get('op', ''))


# The answer, as one line, and the end of the process. os._exit, not sys.exit: an AT-SPI call into a hung app
# may still be sitting on a thread, and it must not hold the process past the host's deadline.
def out(o):
    r = {'ok': bool(o.get('ok')), 'op': OP, 'os': 'linux'}
    for k, v in o.items():
        if k not in r:
            r[k] = v
    sys.stdout.write(json.dumps(r, ensure_ascii=True, separators=(',', ':')) + '\n')
    sys.stdout.flush()
    os._exit(0 if r['ok'] else 1)


def read(p, n=65536):
    try:
        with open(p, 'rb') as f:
            return f.read(n).decode('utf-8', 'replace')
    except Exception:
        return ''


def kv(text, key):
    for line in text.splitlines():
        if line.startswith(key + '='):
            return line[len(key) + 1:].strip()
    return ''


def procenv(pid):
    env = {}
    for item in read('/proc/%s/environ' % pid, 1 << 20).split('\0'):
        k, sep, v = item.partition('=')
        if sep and k not in env:
            env[k] = v
    return env


def euid():
    return os.geteuid() if hasattr(os, 'geteuid') else -1


ENVKEYS = (('display', 'DISPLAY'), ('xauth', 'XAUTHORITY'), ('wayland', 'WAYLAND_DISPLAY'),
           ('type', 'XDG_SESSION_TYPE'), ('desktop', 'XDG_CURRENT_DESKTOP'))


def session():
    s = {'uid': None}
    for k, e in ENVKEYS:
        s[k] = os.environ.get(e, '')
    want = os.environ.get('SM_SESSION_UID', '')
    if want.isdigit():
        s['uid'] = int(want)
    sid = kv(read('/run/systemd/seats/seat0'), 'ACTIVE')
    rec = read('/run/systemd/sessions/' + sid) if sid else ''
    if rec:
        u = kv(rec, 'UID')
        if s['uid'] is None and u.isdigit():
            s['uid'] = int(u)
        s['type'] = s['type'] or kv(rec, 'TYPE')
        s['display'] = s['display'] or kv(rec, 'DISPLAY')
        leader = kv(rec, 'LEADER')
        if leader.isdigit():
            env = procenv(leader)
            for k, e in ENVKEYS:
                s[k] = s[k] or env.get(e, '')
    try:
        pids = [p for p in os.listdir('/proc') if p.isdigit()]
    except Exception:
        pids = []
    if not s['display']:
        try:
            xs = sorted(n for n in os.listdir('/tmp/.X11-unix') if re.match(r'^X\d+$', n))
            if xs:
                s['display'] = ':' + xs[0][1:]
        except Exception:
            pass
    # ROOT WITH NOBODY NAMED (no SM_SESSION_UID, no logind -- a container, a VNC desktop): the person at this
    # display is whoever runs programs on it, which is how the host decides it too (desktopOwner). Ordinary
    # accounts only (uid 1000 and up): a display manager's own processes are not a person. Without one, the
    # desktop is root's own.
    if s['uid'] is None and euid() == 0 and s['display']:
        for p in pids[:4000]:
            try:
                u = os.stat('/proc/' + p).st_uid
            except Exception:
                continue
            if u >= 1000 and u != 65534:
                env = procenv(p)
                if env.get('DISPLAY') == s['display']:
                    s['uid'] = u
                    break
    if s['uid'] is None:
        s['uid'] = os.getuid() if hasattr(os, 'getuid') else None
    # Still missing what the session's own processes would know: ask them (bounded -- a busy box has thousands
    # of processes, and /proc/<pid>/environ of another user is readable only as root anyway). A program of the
    # session's own user finds ~/.Xauthority by itself, so a missing XAUTHORITY matters only to root.
    if s['uid'] is not None and (not s['display'] or (not s['xauth'] and euid() == 0)):
        looked = 0
        for p in pids:
            try:
                if os.stat('/proc/' + p).st_uid != s['uid']:
                    continue
            except Exception:
                continue
            looked += 1
            if looked > 400:
                break
            env = procenv(p)
            for k, e in ENVKEYS:
                s[k] = s[k] or env.get(e, '')
            if s['display'] and s['xauth'] and s['desktop']:
                break
    if not s['xauth'] and s['uid'] is not None:
        home = ''
        try:
            import pwd
            home = pwd.getpwuid(s['uid']).pw_dir
        except Exception:
            pass
        for c in ('/run/user/%d/gdm/Xauthority' % s['uid'], os.path.join(home, '.Xauthority') if home else ''):
            if c and os.access(c, os.R_OK):
                s['xauth'] = c
                break
    # What was found becomes this process's environment (never overriding what it had), so every tool
    # started from here -- xprop, xwininfo, xdotool -- reaches the same display.
    for k, e in ENVKEYS:
        if s[k] and not os.environ.get(e):
            os.environ[e] = s[k]
    return s


S = session()
WAYLAND = S['type'] == 'wayland' or (bool(S['wayland']) and S['type'] != 'x11')


# The environment and the identity a program for the PERSON runs with: when this is root and the desktop
# belongs to someone else, a fresh environment of only what a desktop program needs, and a preexec that
# becomes them; otherwise this process's own environment without the host's SM_* settings.
def person():
    if euid() == 0 and S['uid']:
        try:
            import pwd
            pw = pwd.getpwuid(S['uid'])
        except Exception:
            return None, None
        env = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': pw.pw_dir,
               'USER': pw.pw_name, 'LOGNAME': pw.pw_name, 'SHELL': pw.pw_shell or '/bin/sh',
               'LANG': os.environ.get('LANG') or 'C.UTF-8',
               'XDG_RUNTIME_DIR': '/run/user/%d' % S['uid'],
               'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/%d/bus' % S['uid']}
        for k, e in ENVKEYS:
            if S[k]:
                env[e] = S[k]

        def become():
            os.setgid(pw.pw_gid)
            os.initgroups(pw.pw_name, pw.pw_gid)
            os.setuid(S['uid'])
        return become, env
    env = dict((k, v) for k, v in os.environ.items() if not k.startswith('SM_'))
    return None, env


def which(tool):
    return shutil.which(tool)


# Run a tool, bounded: (exit code, stdout bytes); -1 when it could not run or ran out of time. The X tools get
# a UTF-8 locale (C.UTF-8 is built into glibc 2.35+, and Debian/Ubuntu ship it before that), so xprop writes a
# title's characters as they are instead of as octal escapes -- the TOOLS only: a launched app keeps the
# person's own locale (launch.py builds its own environment).
def run(argv, timeout=4.0, env=None, preexec=None):
    if env is None:
        env = dict(os.environ, LC_ALL='C.UTF-8')
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                           timeout=timeout, env=env, preexec_fn=preexec)
        return p.returncode, p.stdout
    except Exception:
        return -1, b''


def window_id(v):
    try:
        if isinstance(v, int):
            return v
        s = str(v).strip().lower()
        return int(s, 16) if s.startswith('0x') else int(s)
    except Exception:
        return None
