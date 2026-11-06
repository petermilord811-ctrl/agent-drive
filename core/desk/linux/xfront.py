# xfront.py -- bringing an X11 window forward, for focus and launch.
#
# xdotool first (it sends _NET_ACTIVE_WINDOW as a pager would, which window managers honour over their
# focus-stealing prevention), else wmctrl, else the same message straight from libX11 -- so a stock desktop
# with neither tool installed still gets there. Every route is checked by reading _NET_ACTIVE_WINDOW back, and
# the one that worked is named.


def activate(wid):
    tried = []
    for name, argv in (('xdotool', ['xdotool', 'windowactivate', str(wid)]), ('wmctrl', ['wmctrl', '-i', '-a', hex(wid)])):
        if which(name):
            tried.append(name)
            run(argv, timeout=3.0)
            if wait_active(wid, 1.2):
                return name, tried
    tried.append('xlib')
    if xlib_activate(wid) and wait_active(wid, 1.2):
        return 'xlib', tried
    return '', tried


def wait_active(wid, secs):
    end = time.time() + secs
    while True:
        if active_window() == wid:
            return True
        if time.time() >= end:
            return False
        time.sleep(0.1)


# _NET_ACTIVE_WINDOW (EWMH): a ClientMessage to the root, source 2 = "a pager", time 0; XMapRaised as well, so a
# window manager without EWMH still maps (un-minimizes) and raises it. XEvent is a 24-long union, and
# XSendEvent copies all of it -- hence the padding member.
def xlib_activate(wid):
    try:
        import ctypes, ctypes.util
        X = ctypes.cdll.LoadLibrary(ctypes.util.find_library('X11') or 'libX11.so.6')
        vp, ul = ctypes.c_void_p, ctypes.c_ulong
        X.XOpenDisplay.restype, X.XOpenDisplay.argtypes = vp, [ctypes.c_char_p]
        X.XDefaultRootWindow.restype, X.XDefaultRootWindow.argtypes = ul, [vp]
        X.XInternAtom.restype, X.XInternAtom.argtypes = ul, [vp, ctypes.c_char_p, ctypes.c_int]
        X.XSendEvent.argtypes = [vp, ul, ctypes.c_int, ctypes.c_long, vp]
        X.XMapRaised.argtypes = [vp, ul]
        X.XFlush.argtypes = X.XCloseDisplay.argtypes = [vp]

        class Msg(ctypes.Structure):
            _fields_ = [('type', ctypes.c_int), ('serial', ul), ('send_event', ctypes.c_int), ('display', vp),
                        ('window', ul), ('message_type', ul), ('format', ctypes.c_int), ('l', ctypes.c_long * 5)]

        class Ev(ctypes.Union):
            _fields_ = [('xclient', Msg), ('pad', ctypes.c_long * 24)]

        d = X.XOpenDisplay(None)
        if not d:
            return False
        ev = Ev()
        ev.xclient.type, ev.xclient.send_event, ev.xclient.window, ev.xclient.format = 33, 1, wid, 32
        ev.xclient.message_type = X.XInternAtom(d, b'_NET_ACTIVE_WINDOW', 0)
        ev.xclient.l[0] = 2
        sent = X.XSendEvent(d, X.XDefaultRootWindow(d), 0, (1 << 20) | (1 << 19), ctypes.byref(ev))
        X.XMapRaised(d, wid)
        X.XFlush(d)
        X.XCloseDisplay(d)
        return bool(sent)
    except Exception:
        return False
