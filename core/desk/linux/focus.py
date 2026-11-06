# focus.py -- the `focus` op on Linux/X11: un-minimize a window and bring it to the front; {dry:true} only says
# which window it would be. Answer: {ok, how:"xdotool"|"wmctrl"|"xlib", matches, window} -- or why not.
wins, fail = list_windows()
if fail:
    out(fail)
w, n, why = find(wins)
if not w:
    out({'ok': False, 'why': why, 'windows': titles(wins)})
if ARGS.get('dry'):
    out({'ok': True, 'dry': True, 'matches': n, 'popup': False, 'window': w})
how, tried = activate(w['id'])
after, _ = list_windows()
now = [x for x in (after or []) if x['id'] == w['id']]
if not how:
    out({'ok': False, 'why': 'the window manager kept another window in front (tried %s) -- click the window instead' % ', '.join(tried),
         'window': now[0] if now else w})
out({'ok': True, 'how': how, 'matches': n, 'popup': False, 'window': now[0] if now else w})
