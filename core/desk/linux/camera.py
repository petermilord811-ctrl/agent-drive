# camera.py -- the `camera` op on Linux: one photo from a webcam (V4L2), as a JPEG in this account's temp folder
# (temp.py). Args: {device?, dry?} -- device: part of a camera's name, or its /dev/video* path (the first camera
# otherwise); dry: list the cameras and the tools, turn nothing on. Answer: {ok, path, mime, bytes, device,
# cameras, tool} -- read the file with `read`, then remove it with `rm`. Asking the person first is the caller's
# part, every time.
#
# WHICH NODES ARE CAMERAS: a UVC webcam shows up as TWO /dev/video* nodes, the picture and a metadata stream that
# cannot be read as one; sysfs numbers a device's nodes (`index`), and the picture is index 0. The name is the
# camera's own ("Integrated Camera: Integrated C").
#
# THE TOOLS, in order: fswebcam (made for exactly this), then ffmpeg (v4l2 in, one JPEG out) -- whichever is
# installed; neither is, and it says so by name. Both are told to let the first frames go by (fswebcam -S, ffmpeg
# -ss): a webcam starts dark while its exposure settles, and the first frame is often black.
import glob


def rd(p):
    try:
        with open(p, 'rb') as f:
            return f.read(4096).decode('utf-8', 'replace').strip()
    except Exception:
        return ''


def vnum(p):
    return int(re.sub(r'\D', '', os.path.basename(p)) or 0)


def cameras():
    nodes = sorted(glob.glob('/sys/class/video4linux/video*'), key=vnum)
    found = []
    for d in nodes:
        dev = '/dev/' + os.path.basename(d)
        if rd(d + '/index') in ('', '0') and os.path.exists(dev):
            found.append({'name': rd(d + '/name') or os.path.basename(d), 'path': dev})
    if not nodes:
        found = [{'name': os.path.basename(v), 'path': v} for v in sorted(glob.glob('/dev/video*'), key=vnum)]
    return found


cams = cameras()
names = [c['name'] for c in cams]
have = [t for t in ('fswebcam', 'ffmpeg') if tool([t])]
want = str(ARGS.get('device') or '')
if want.startswith('/') and os.path.exists(want):
    pick = ([c for c in cams if c['path'] == want] or [{'name': os.path.basename(want), 'path': want}])[0]
else:
    pick = ([c for c in cams if want.lower() in c['name'].lower()] or [None])[0]
if not cams and not (want.startswith('/') and os.path.exists(want)):
    o = {'ok': False, 'why': 'no camera: this machine has no video device (/dev/video*)', 'cameras': []}
    if not have:
        o['why'] += ', and neither fswebcam nor ffmpeg is installed to use one'
        o['missing'] = ['fswebcam', 'ffmpeg']
    out(o)
if pick is None:
    out({'ok': False, 'why': 'no camera\'s name contains "%s"' % want, 'cameras': names})
if not have:
    out({'ok': False, 'why': 'neither fswebcam nor ffmpeg is installed, and one of them takes the photo (e.g. sudo apt install fswebcam)',
         'missing': ['fswebcam', 'ffmpeg'], 'device': pick['name'], 'cameras': names})
if ARGS.get('dry'):
    out({'ok': True, 'dry': True, 'device': pick['name'], 'path': pick['path'], 'cameras': names, 'tools': have})

dev, until, errs, jpg = pick['path'], T0 + 8.5, [], b''
for t in have:
    if t == 'fswebcam':
        argv = ['fswebcam', '-q', '--no-banner', '-d', dev, '-r', '1280x720', '-S', '15', '--jpeg', '90', '-']
    else:
        argv = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'v4l2', '-i', dev, '-ss', '0.6',
                '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1']
    jpg, err, code = grab(argv, 0, until)
    if jpg[:2] == b'\xff\xd8':
        used = t
        break
    errs.append('%s: %s' % (t, err.splitlines()[-1] if err else 'no picture (exit %s)' % code))
else:
    busy = any('busy' in e.lower() for e in errs)
    out({'ok': False, 'why': ('the camera is busy -- another program is using it (' if busy else 'could not take the photo with %s (' % pick['name']) +
         '; '.join(errs) + ')', 'device': pick['name'], 'cameras': names})
p, fd = newtmp('cam', 'jpg')
with os.fdopen(fd, 'wb') as f:
    f.write(jpg)
out({'ok': True, 'path': p, 'mime': 'image/jpeg', 'bytes': len(jpg), 'device': pick['name'], 'cameras': names, 'tool': used})
