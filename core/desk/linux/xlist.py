# xlist.py -- the visible X11 windows, front to back, in the shape the Windows script answers: windows, focus.


# Answers (list, None) or (None, the answer that says why not).
def list_windows():
    e = need_x11()
    if e:
        return None, e
    if which('xprop') and which('xwininfo'):
        return list_xprop(), None
    if which('wmctrl'):
        return list_wmctrl(), None
    return None, {'ok': False, 'why': 'listing windows needs xprop and xwininfo (package x11-utils) or wmctrl -- none is installed',
                  'missing': ['x11-utils', 'wmctrl']}


def list_xprop():
    rp = root_props()
    active = (hexes(rp.get('_NET_ACTIVE_WINDOW')) or [0])[0]
    cur = (nums(rp.get('_NET_CURRENT_DESKTOP')) or [None])[0]
    res = []
    for wid in reversed(clients(rp)):
        code, b = run(['xprop', '-id', str(wid), '-notype', '_NET_WM_NAME', 'WM_NAME', '_NET_WM_PID', 'WM_CLASS',
                       '_NET_WM_STATE', 'WM_TRANSIENT_FOR', '_NET_FRAME_EXTENTS', '_GTK_FRAME_EXTENTS',
                       '_NET_WM_WINDOW_TYPE', '_NET_WM_DESKTOP'])
        if code != 0:
            continue
        p = xprops(b)
        title = xstr(p['_NET_WM_NAME']) if '_NET_WM_NAME' in p else xstr(p.get('WM_NAME', b''))
        kind = p.get('_NET_WM_WINDOW_TYPE', b'')
        if not title or b'_TYPE_DOCK' in kind or b'_TYPE_DESKTOP' in kind:
            continue
        on = nums(p.get('_NET_WM_DESKTOP'))
        if cur is not None and on and on[0] != cur and on[0] not in (-1, 0xFFFFFFFF):
            continue
        state = p.get('_NET_WM_STATE', b'')
        hidden = b'_STATE_HIDDEN' in state
        rect, viewable = geometry(wid, p)
        if not hidden and (not viewable or not rect or rect[2] <= 0 or rect[3] <= 0):
            continue
        pid = (nums(p.get('_NET_WM_PID')) or [0])[0]
        cls = re.findall(rb'"((?:[^"\\]|\\.)*)"', p.get('WM_CLASS', b''))
        res.append({'id': wid, 'title': title, 'process': comm(pid), 'pid': pid,
                    'class': cls[-1].decode('utf-8', 'replace') if cls else '', 'rect': None if hidden else rect,
                    'minimized': hidden, 'maximized': b'_MAXIMIZED_VERT' in state and b'_MAXIMIZED_HORZ' in state,
                    'foreground': wid == active, 'owner': (hexes(p.get('WM_TRANSIENT_FOR')) or [0])[0]})
    return res


# wmctrl -lpGx: id desktop pid x y w h instance.Class host title -- no state (so nothing reads as minimized),
# and geometry as wmctrl measures it. Listed oldest first; reversed, it is as close to front-to-back as it gets.
def list_wmctrl():
    code, b = run(['wmctrl', '-lpGx'])
    active = active_window()
    res = []
    for line in b.decode('utf-8', 'replace').splitlines():
        m = re.match(r'^(0x[0-9a-fA-F]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+\S+\s?(.*)$', line)
        if not m or not m.group(9) or m.group(8).startswith('desktop_window'):
            continue
        wid, pid = int(m.group(1), 16), int(m.group(3))
        res.append({'id': wid, 'title': m.group(9), 'process': comm(pid), 'pid': pid, 'class': m.group(8).split('.')[-1],
                    'rect': [int(m.group(i)) for i in (4, 5, 6, 7)], 'minimized': False, 'maximized': False,
                    'foreground': wid == active, 'owner': 0})
    res.reverse()
    return res


# The window the args name: `id` wins; else a case-insensitive part of the title, exact first, frontmost next.
def find(wins):
    if ARGS.get('id') is not None:
        wid = window_id(ARGS.get('id'))
        hit = [w for w in wins if w['id'] == wid]
        if hit:
            return hit[0], 1, ''
        return None, 0, 'no visible window has id %s (it may have closed, or be on another workspace)' % ARGS.get('id')
    want = str(ARGS.get('title', '')).lower()
    hits = [w for w in wins if want in w['title'].lower()]
    if not hits:
        return None, 0, 'no visible window\'s title contains "%s"' % ARGS.get('title', '')
    exact = [w for w in hits if w['title'].lower() == want]
    return (exact or hits)[0], len(hits), ''


def titles(wins):
    return [{'id': w['id'], 'title': w['title']} for w in wins[:20]]