# xgeo.py -- the root window's EWMH state (the client list, the active window, the workarea) and where a
# window is on the screen: shared by windows, focus and launch (controls reads AT-SPI's own extents instead).


def root_props():
    if not which('xprop'):
        return {}
    code, b = run(['xprop', '-root', '-notype', '_NET_CLIENT_LIST_STACKING', '_NET_CLIENT_LIST', '_NET_ACTIVE_WINDOW',
                   '_NET_CURRENT_DESKTOP', '_NET_WORKAREA'])
    return xprops(b) if code == 0 else {}


# The top-level windows, BOTTOM TO TOP: the window manager's stacking list; with no EWMH window manager (a bare
# X server, a kiosk) the app windows ARE the root's children, which XQueryTree lists in the same order.
def clients(rp=None):
    rp = root_props() if rp is None else rp
    ids = hexes(rp.get('_NET_CLIENT_LIST_STACKING')) or hexes(rp.get('_NET_CLIENT_LIST'))
    if not ids and which('xwininfo'):
        code, b = run(['xwininfo', '-root', '-children'])
        ids = [int(m, 16) for m in re.findall(rb'^\s+(0x[0-9a-fA-F]+) ', b, re.M)] if code == 0 else []
    return ids


def active_window():
    p = root_props()
    if '_NET_ACTIVE_WINDOW' in p:
        return (hexes(p['_NET_ACTIVE_WINDOW']) or [0])[0]
    if which('xdotool'):
        code, b = run(['xdotool', 'getactivewindow'])
        if code == 0 and nums(b):
            return nums(b)[0]
    return 0


# Where a window is: xwininfo's ABSOLUTE upper-left (wmctrl -G adds the frame offset twice on some window
# managers), then corrected to what a person sees -- the window manager's frame added (_NET_FRAME_EXTENTS: left,
# right, top, bottom), a client-side-decorated (GTK) window's invisible shadow taken off (_GTK_FRAME_EXTENTS).
def geometry(wid, p):
    code, b = run(['xwininfo', '-id', str(wid)])
    if code != 0:
        return None, False
    g = []
    for pat in (rb'Absolute upper-left X:\s*(-?\d+)', rb'Absolute upper-left Y:\s*(-?\d+)', rb'\n\s*Width:\s*(\d+)', rb'\n\s*Height:\s*(\d+)'):
        m = re.search(pat, b)
        if not m:
            return None, False
        g.append(int(m.group(1)))
    x, y, w, h = g
    fe = nums(p.get('_NET_FRAME_EXTENTS'))
    if len(fe) == 4:
        x, y, w, h = x - fe[0], y - fe[2], w + fe[0] + fe[1], h + fe[2] + fe[3]
    ge = nums(p.get('_GTK_FRAME_EXTENTS'))
    if len(ge) == 4:
        x, y, w, h = x + ge[0], y + ge[2], w - ge[0] - ge[1], h - ge[2] - ge[3]
    return [x, y, w, h], b'IsViewable' in b
