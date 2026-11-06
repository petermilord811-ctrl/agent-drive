# controls.py -- the `controls` op on Linux: a window's accessibility tree through AT-SPI (python3-gi with
# gir1.2-atspi-2.0), in the shape the Windows UI Automation walk answers. Args: {id | title, max, depth, budget};
# default target: the ACTIVE window. Works under Wayland as well as X11 (AT-SPI is a D-Bus protocol, not an
# X one) -- but a Wayland client does not know where its window is on the screen, so there the rectangles are
# relative to the window and the answer says rectsRelative:true.
#
# NAMES ONLY, NEVER VALUES: no Text or Value interface is ever asked for. A "password text" is flagged
# isPassword, keeps no name, and is never descended into. Only what is SHOWING is listed.
#
# AT-SPI lives on the person's session bus, which admits that person only: as root this re-runs itself as
# them (common.py's person(), a clean environment) and passes their answer through.
#
# Bounded by max, depth and the budget; a watchdog thread answers with what was gathered when the budget runs
# out, because one call into a hung application can block for longer than the host waits.
import threading
from collections import deque

budget = max(1000, min(8000, int(ARGS.get('budget', 7000)))) / 1000.0
deadline = T0 + budget

if euid() == 0 and S['uid'] and not ARGS.get('_as'):
    become, env = person()
    if become:
        a = dict(ARGS)
        a['_as'] = 1
        a['budget'] = int(max(1.0, deadline - time.time() - 0.5) * 1000)
        code, b = run([sys.executable, '-c', BOOT, sys.argv[1], base64.b64encode(json.dumps(a).encode('utf-8')).decode('ascii')],
                      timeout=max(1.0, deadline - time.time()), env=env, preexec=become)
        for line in reversed(b.decode('utf-8', 'replace').splitlines()):
            if line.startswith('{"ok":'):
                sys.stdout.write(line + '\n')
                sys.stdout.flush()
                os._exit(0 if line.startswith('{"ok":true') else 1)
        out({'ok': False, 'why': 'the AT-SPI reader, run as the desktop user, gave no answer'})

try:
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
except Exception as e:
    out({'ok': False, 'why': 'AT-SPI is not available here -- python3-gi and gir1.2-atspi-2.0 are needed (%s)' % e,
         'missing': ['python3-gi', 'gir1.2-atspi-2.0']})

try:
    Atspi.set_timeout(700, 2000)
except Exception:
    pass

# Each element's `type` here is AT-SPI's own role name ("push button", "password text"); desk.js's parse() turns
# it into the UI Automation control type the Windows answer uses (Button, Edit) and keeps the role as `class`,
# so one reader serves both -- and the table costs no command line.
# What is in these is in their name already, or is a value.
LEAF = set(['push button', 'toggle button', 'check box', 'radio button', 'text', 'entry', 'password text', 'label',
            'static', 'link', 'image', 'icon', 'progress bar', 'scroll bar', 'slider', 'separator'])

ST = Atspi.StateType


def has(states, s):
    try:
        return bool(states.contains(s))
    except Exception:
        return False


def frames():
    res = []
    d = Atspi.get_desktop(0)
    for i in range(d.get_child_count()):
        if time.time() > deadline:
            break
        try:
            app = d.get_child_at_index(i)
            pid = app.get_process_id()
            for j in range(app.get_child_count()):
                w = app.get_child_at_index(j)
                st = w.get_state_set()
                res.append({'acc': w, 'title': w.get_name() or '', 'pid': pid, 'active': has(st, ST.ACTIVE),
                            'showing': has(st, ST.SHOWING)})
        except Exception:
            continue
    return res


fr = frames()
target, matches, xid = None, 0, 0
if ARGS.get('id') is not None:
    xid = window_id(ARGS.get('id')) or 0
    code, b = run(['xprop', '-id', str(xid), '-notype', '_NET_WM_PID', '_NET_WM_NAME', 'WM_NAME']) if which('xprop') else (-1, b'')
    if code != 0:
        out({'ok': False, 'why': 'cannot read X window %s (it may have closed, or xprop is missing)' % ARGS.get('id')})
    p = xprops(b)
    pid = (nums(p.get('_NET_WM_PID')) or [0])[0]
    title = xstr(p['_NET_WM_NAME']) if '_NET_WM_NAME' in p else xstr(p.get('WM_NAME', b''))
    same = [f for f in fr if f['pid'] == pid]
    hit = [f for f in same if f['title'] == title] or [f for f in same if f['showing']]
    if hit:
        target, matches = hit[0], len(hit)
elif ARGS.get('title'):
    want = str(ARGS.get('title')).lower()
    hit = [f for f in fr if want in f['title'].lower()]
    hit.sort(key=lambda f: (f['title'].lower() != want, not f['active'], not f['showing']))
    if hit:
        target, matches = hit[0], len(hit)
else:
    hit = [f for f in fr if f['active']]
    if hit:
        target, matches = hit[0], 1
if not target:
    why = 'no window matches' if (ARGS.get('id') is not None or ARGS.get('title')) else 'no active window found through AT-SPI'
    out({'ok': False, 'why': why + ' (an app that does not speak AT-SPI -- or has accessibility off -- is invisible to it)',
         'windows': [{'title': f['title'], 'pid': f['pid']} for f in fr if f['showing']][:20]})

MAX = max(1, min(1000, int(ARGS.get('max', 200))))
DEPTH = max(1, min(30, int(ARGS.get('depth', 8))))
items = []
state = {'stop': '', 'done': False}
lock = threading.Lock()


def window_info():
    acc = target['acc']
    rect = None
    try:
        e = acc.get_extents(Atspi.CoordType.SCREEN)
        rect = [e.x, e.y, e.width, e.height] if e.width > 0 and e.height > 0 else None
    except Exception:
        pass
    return {'id': xid, 'title': target['title'], 'process': comm(target['pid']), 'pid': target['pid'], 'class': '',
            'rect': rect, 'minimized': False, 'maximized': False, 'foreground': target['active'], 'owner': 0}


def answer(stop):
    with lock:
        if state['done']:
            return
        state['done'] = True
        got = list(items)
    o = {'ok': True, 'window': window_info(), 'matches': matches, 'count': len(got), 'truncated': bool(stop),
         'stop': stop, 'awareness': 'atspi', 'controls': got}
    if WAYLAND:
        o['rectsRelative'] = True
    out(o)


def watchdog():
    answer('time')


timer = threading.Timer(max(0.2, deadline - time.time()), watchdog)
timer.daemon = True
timer.start()

q = deque([(target['acc'], -1, 0)])
stop = ''
while q:
    if len(items) >= MAX:
        stop = 'max'
        break
    if time.time() > deadline:
        stop = 'time'
        break
    acc, parent, d = q.popleft()
    try:
        st = acc.get_state_set()
        if d > 0 and not has(st, ST.SHOWING):
            continue
        role = acc.get_role_name() or ''
        pw = role == 'password text' or acc.get_role() == Atspi.Role.PASSWORD_TEXT
        name = '' if pw else (acc.get_name() or '')
        rect = None
        try:
            e = acc.get_extents(Atspi.CoordType.SCREEN)
            if e.width > 0 and e.height > 0:
                rect = [e.x, e.y, e.width, e.height]
        except Exception:
            pass
        aid = ''
        try:
            aid = acc.get_accessible_id() or ''
        except Exception:
            pass
        it = {'i': len(items), 'p': parent, 'd': d, 'name': name[:300] + ('...' if len(name) > 300 else ''),
              'type': role, 'aid': aid[:200], 'class': role, 'rect': rect, 'enabled': has(st, ST.ENABLED) or has(st, ST.SENSITIVE), 'focusable': has(st, ST.FOCUSABLE),
              'focused': has(st, ST.FOCUSED), 'isPassword': pw}
    except Exception:
        continue
    with lock:
        if state['done']:
            break
        items.append(it)
    if pw or d >= DEPTH or role in LEAF:
        continue
    try:
        n = acc.get_child_count()
    except Exception:
        continue
    for k in range(min(n, 2000)):
        try:
            c = acc.get_child_at_index(k)
        except Exception:
            continue
        if c is not None:
            q.append((c, it['i'], d + 1))
answer(stop)
