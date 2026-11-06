# windows.py -- the `windows` op on Linux/X11: the visible windows, front to back, and the monitors, in the shape
# the Windows script answers (ids are X window ids, as numbers). Changes nothing.


# The monitors, from xrandr --listmonitors: " 0: +*DP-1 2560/597x1440/336+0+0  DP-1" (the * marks the primary).
# The work area is the window manager's _NET_WORKAREA (one for the whole screen) cut to each monitor. dpi is
# null: X11 has no per-monitor scale to report the way Windows does.
def monitors():
    wa = nums(root_props().get('_NET_WORKAREA'))[:4]
    res = []
    if which('xrandr'):
        code, b = run(['xrandr', '--listmonitors'])
        for m in re.finditer(rb'^\s*\d+:\s+\+?(\*?)(\S+)\s+(\d+)/\d+x(\d+)/\d+\+(-?\d+)\+(-?\d+)', b, re.M):
            r = [int(m.group(5)), int(m.group(6)), int(m.group(3)), int(m.group(4))]
            res.append({'name': m.group(2).decode('utf-8', 'replace'), 'rect': r, 'work': cut(r, wa),
                        'primary': m.group(1) == b'*', 'dpi': None})
    if not res and which('xwininfo'):
        code, b = run(['xwininfo', '-root'])
        w, h = re.search(rb'\n\s*Width:\s*(\d+)', b), re.search(rb'\n\s*Height:\s*(\d+)', b)
        if w and h:
            r = [0, 0, int(w.group(1)), int(h.group(1))]
            res.append({'name': os.environ.get('DISPLAY', ''), 'rect': r, 'work': cut(r, wa), 'primary': True, 'dpi': None})
    if res and not any(m['primary'] for m in res):
        res[0]['primary'] = True
    return res


def cut(r, wa):
    if len(wa) < 4:
        return list(r)
    x0, y0, x1, y1 = max(r[0], wa[0]), max(r[1], wa[1]), min(r[0] + r[2], wa[0] + wa[2]), min(r[1] + r[3], wa[1] + wa[3])
    return [x0, y0, x1 - x0, y1 - y0] if x1 > x0 and y1 > y0 else list(r)


wins, fail = list_windows()
if fail:
    out(fail)
out({'ok': True, 'foreground': active_window(), 'awareness': 'x11', 'windows': wins, 'monitors': monitors()})
