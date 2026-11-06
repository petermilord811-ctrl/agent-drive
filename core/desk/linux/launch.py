# launch.py -- the `launch` op on Linux: start an app, a document or a URL, DETACHED, as the person at the
# desktop, and say which window it opened. Args: {app, argv[], cwd?, wait, focus, dry?} (desk.js splits a
# string of args into argv without any shell -- nothing here is ever run through sh).
#
# DETACHED, AND WHY EACH PART. The host reads the exec's pipe until every writer has closed it, and at its 10 s
# deadline kills the exec's whole PROCESS GROUP (runCapture). An app that inherited the pipe would hold the
# exec open to the deadline, and the kill would take the app with it. So the app gets /dev/null for all three
# streams and a new session (start_new_session = setsid) -- out of the group, owning no pipe -- and this
# script exits while it runs on.
#
# WHAT RUNS: a URL (scheme:...) or a file that is not a program goes to the desktop's opener (xdg-open, gio,
# ...); a program is run by name or path with argv as given; a name that is only a .desktop id
# ("org.gnome.Calculator") goes to gtk-launch.
#
# AS WHOM: a root host hands the app to the person at the desktop (common.py's person(): their uid, a clean
# environment); `as` says which it was -- and says so when no such person could be found and the desktop is
# root's own.
#
# Answer: {ok, started:{file, argv, cwd, as, pid, process}, window|null, how, note?}
app = str(ARGS.get('app', ''))
argv = [str(a) for a in (ARGS.get('argv') or [])]
become, env = person()
home = (env or {}).get('HOME') or os.path.expanduser('~')
cwd = str(ARGS.get('cwd') or '') or home
if not os.path.isdir(cwd):
    cwd = '/'
path = (env or os.environ).get('PATH', os.environ.get('PATH', ''))


def opener():
    for t in (['xdg-open'], ['gio', 'open'], ['gnome-open'], ['kde-open5'], ['kde-open']):
        if shutil.which(t[0], path=path):
            return t
    return None


if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', app) and not os.path.exists(app):
    op_ = opener()
    if not op_:
        out({'ok': False, 'why': 'nothing here opens a URL (no xdg-open, gio, gnome-open or kde-open)', 'missing': ['xdg-utils']})
    cmd = op_ + [app] + argv
elif (os.path.isfile(app) and not os.access(app, os.X_OK)) or os.path.isdir(app):
    op_ = opener()
    if not op_:
        out({'ok': False, 'why': 'nothing here opens a document (no xdg-open, gio, gnome-open or kde-open)', 'missing': ['xdg-utils']})
    cmd = op_ + [app] + argv
elif ('/' in app and os.access(app, os.X_OK)) or shutil.which(app, path=path):
    cmd = [app if '/' in app else shutil.which(app, path=path)] + argv
elif shutil.which('gtk-launch', path=path) and any(os.path.exists(os.path.join(d, 'applications', app + '.desktop'))
                                                   for d in ['/usr/share', '/usr/local/share', '/var/lib/flatpak/exports/share', os.path.join(home, '.local/share')]):
    cmd = ['gtk-launch', app] + argv
else:
    out({'ok': False, 'why': 'not found: "%s" is not a program on the PATH, a path, a URL or an installed .desktop app' % app})

who = 'the signed-in user' if become else ('root (no other signed-in user was found)' if euid() == 0 else 'this account')
started = {'file': cmd[0], 'argv': cmd[1:], 'cwd': cwd, 'as': who, 'pid': None, 'process': ''}
if ARGS.get('dry'):
    out({'ok': True, 'dry': True, 'started': started})

# The new window: the top-level windows before and after (xgeo.py's clients(), one call each), and only the NEW
# ones described -- describing every window on every poll would spend the host's 10 s on windows nobody asked
# about.
xwin = need_x11() is None and which('xprop') and which('xwininfo')


def describe(wid):
    code, b = run(['xprop', '-id', str(wid), '-notype', '_NET_WM_NAME', 'WM_NAME', '_NET_WM_PID', 'WM_CLASS',
                   '_NET_FRAME_EXTENTS', '_GTK_FRAME_EXTENTS'])
    p = xprops(b)
    title = xstr(p['_NET_WM_NAME']) if '_NET_WM_NAME' in p else xstr(p.get('WM_NAME', b''))
    if code != 0 or not title:
        return None
    rect, viewable = geometry(wid, p)
    if not viewable:
        return None
    pid = (nums(p.get('_NET_WM_PID')) or [0])[0]
    cls = re.findall(rb'"((?:[^"\\]|\\.)*)"', p.get('WM_CLASS', b''))
    return {'id': wid, 'title': title, 'process': comm(pid), 'pid': pid, 'class': cls[-1].decode('utf-8', 'replace') if cls else '',
            'rect': rect, 'minimized': False, 'maximized': False, 'foreground': False, 'owner': 0}


before = set(clients()) if xwin else set()
try:
    p = subprocess.Popen(cmd, cwd=cwd, env=env, preexec_fn=become, start_new_session=True, close_fds=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except Exception as e:
    out({'ok': False, 'why': 'could not start it: %s' % e, 'started': started})
started['pid'] = p.pid
time.sleep(0.15)
started['process'] = comm(p.pid)
if p.poll() is not None and p.returncode != 0:
    out({'ok': False, 'why': 'it exited at once with code %d' % p.returncode, 'started': started})

wait = max(0, min(6000, int(ARGS.get('wait', 4000)))) / 1000.0
new = None
if xwin:
    end = time.time() + wait
    while new is None and time.time() < end:
        time.sleep(0.2)
        fresh = [w for w in (describe(i) for i in reversed(clients()) if i not in before) if w]
        mine = [w for w in fresh if w['pid'] == p.pid]
        new = (mine or fresh or [None])[0]
if new is None:
    note = 'started; no new window appeared within %d ms (it may still be loading, or it opened in a window that was already there)' % (wait * 1000)
    if not xwin:
        note = 'started; its window cannot be watched here (%s)' % ('Wayland' if WAYLAND else 'no xprop/xwininfo')
    out({'ok': True, 'started': started, 'window': None, 'how': '', 'note': note})
how = ''
if ARGS.get('focus', True):
    how, _ = activate(new['id'])
new['foreground'] = active_window() == new['id']
out({'ok': True, 'started': started, 'window': new, 'how': how})
