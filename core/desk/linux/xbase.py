# xbase.py -- the X11 basics every Linux desk op shares: is there an X display to ask, and reading what xprop
# prints. The X tools are used by name, so a machine without one says which:
#   xprop + xwininfo (x11-utils: on a stock Ubuntu/Debian desktop) -- the window list, exact geometry, state
#   wmctrl                                   -- the list when x11-utils is missing; activation
#   xdotool                                  -- activation; the active window
#   xrandr (x11-xserver-utils)               -- the monitors
#
# WAYLAND: a Wayland compositor does not let one program list, move or focus another program's windows. Only
# Xwayland's windows would show through these tools -- a partial answer that reads like a whole one -- so the
# answer there is a plain "not available".


def need_x11():
    if WAYLAND:
        return {'ok': False, 'wayland': True,
                'why': 'not available on Wayland: the compositor does not let one program list, move or focus another '
                       "program's windows (only Xwayland apps would show) -- use look/shot to see the screen"}
    if not os.environ.get('DISPLAY'):
        return {'ok': False, 'why': 'no X display found (DISPLAY is not set and no running X server was found)'}
    return None


# A title as xprop prints it: `WM_NAME = "Q "quoted" back\slash"` -- MEASURED (Ubuntu 24.04): quotes and
# backslashes inside are NOT escaped, so the title is everything between the first and the LAST quote of the
# line. Under a UTF-8 locale (run() asks for C.UTF-8) other characters come out raw; without one, xprop writes
# the bytes it would not print as \ooo -- undone here only where the result cannot be literal text (a control
# byte or a high byte), because a title can contain a real backslash before three digits.
def xstr(b):
    i, j = b.find(b'"'), b.rfind(b'"')
    if i < 0 or j <= i:
        return ''
    s = re.sub(rb'\\([0-3][0-7]{2})', lambda m: bytes([int(m.group(1), 8)]) if not 0x20 <= int(m.group(1), 8) <= 0x7e else m.group(0), b[i + 1:j])
    try:
        return s.decode('utf-8')
    except UnicodeDecodeError:
        return s.decode('latin-1')


# `xprop -notype` lines: NAME = value / NAME: window id # 0x... / NAME:  not found.
def xprops(b):
    r = {}
    for line in b.split(b'\n'):
        m = re.match(rb'^([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?(?:\s*=\s?|:\s?)(.*)$', line)
        if m and not re.match(rb'\s*(not found|no such atom)', m.group(2)):
            r[m.group(1).decode()] = m.group(2)
    return r


def hexes(b):
    return [int(x, 16) for x in re.findall(rb'0x[0-9a-fA-F]+', b or b'')]


def nums(b):
    return [int(x) for x in re.findall(rb'-?\d+', b or b'')]


def comm(pid):
    return read('/proc/%d/comm' % pid, 256).strip() if pid else ''
