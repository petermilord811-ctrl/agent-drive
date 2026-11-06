# audio.py -- the `audio` op on Linux: a few seconds of what the machine is PLAYING -- the MONITOR of the default
# output in PulseAudio, or PipeWire through pipewire-pulse -- never a microphone. As a WAV in this account's temp
# folder (temp.py). Args: {seconds, dry?} -- dry: find the tool and the source, record nothing. Answer: {ok, path,
# mime, seconds, rate, channels, bytes, peak (0..1, the loudest sample), device, tool} -- read the file with
# `read`, then remove it with `rm`. Asking the person first is the caller's part, every time.
#
# AS THE PERSON. The sound server belongs to the desktop's user (its socket is in their /run/user/<uid>), and a
# root host is not a client it knows -- so the tools run as them, with their runtime folder (common.py's person()).
# Their output comes back on a pipe and THIS process writes the file, so they never need a way into it.
#
# THE TOOLS, in order: parec (pulseaudio-utils; pipewire-pulse speaks the same protocol), then ffmpeg's pulse
# input. The source is "<default sink>.monitor", the default sink asked of pactl -- `get-default-sink`, or the
# "Default Sink:" line of `pactl info` on servers older than PulseAudio 15 -- and @DEFAULT_MONITOR@ without pactl.
# Mono, 16-bit, 48 kHz: 96 KB a second.
#
# THE CLOCK, as audio.ps1: the clip is cut to end well inside the host's 10 s (asked, note say so), and a monitor
# that delivers less than asked is padded with silence and says that too. MEASURED (Ubuntu 24.04 under WSL, parec
# from WSLg's RDPSink.monitor): a 7 s clip came back whole 7.9 s after /bin/sh started.
import array
import wave

RATE = 48000
asked = float(ARGS.get('seconds', 5))
become, env = person()
env = dict(env or os.environ, LC_ALL='C.UTF-8')
path = env.get('PATH') or os.environ.get('PATH', '')
rec = tool(['parec', 'parecord'], path) or tool(['ffmpeg'], path)
if not rec:
    out({'ok': False, 'why': 'nothing here can record what is playing: neither parec/parecord (pulseaudio-utils) nor ffmpeg is installed',
         'missing': ['pulseaudio-utils', 'ffmpeg']})
mon = ''
if tool(['pactl'], path):
    code, b = run(['pactl', 'get-default-sink'], 3.0, env, become)
    sink = b.decode('utf-8', 'replace').strip() if code == 0 else ''
    if not sink:
        code, b = run(['pactl', 'info'], 3.0, env, become)
        m = re.search(rb'^Default Sink:\s*(\S+)', b, re.M)
        sink = m.group(1).decode('utf-8', 'replace') if m else ''
    if sink:
        mon = sink + '.monitor'
mon = mon or '@DEFAULT_MONITOR@'
if ARGS.get('dry'):
    out({'ok': True, 'dry': True, 'device': mon, 'tool': rec})

ms = int(min(asked * 1000, (8.9 - (time.time() - T0)) * 1000 - 600))
if ms < 500:
    out({'ok': False, 'why': "no time left to record: finding the desktop's sound server took %.1f s of the host's 10 s -- try again" % (time.time() - T0)})
want = RATE * 2 * ms // 1000
if rec == 'ffmpeg':
    argv = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'pulse', '-i', mon, '-t', '%.3f' % (ms / 1000.0),
            '-ac', '1', '-ar', str(RATE), '-f', 's16le', 'pipe:1']
else:
    argv = [rec, '--raw', '--device=' + mon, '--format=s16le', '--rate=%d' % RATE, '--channels=1', '--latency-msec=50']
raw, err, code = grab(argv, want, min(T0 + 9.3, time.time() + ms / 1000.0 + 1.0), env, become)
if not raw:
    out({'ok': False, 'why': 'could not record from %s with %s: %s' % (mon, rec, err.splitlines()[-1] if err else 'no sound came (exit %s)' % code),
         'device': mon, 'tool': rec})
o = {}
if len(raw) < want:
    o['note'] = 'the sound server delivered %.2f s; the rest is silence' % (len(raw) / 2.0 / RATE)
    raw = raw[:len(raw) // 2 * 2] + bytes(want - len(raw) // 2 * 2)
pk = array.array('h')
pk.frombytes(raw)
peak = max([abs(x) for x in pk] or [0]) / 32768.0
p, fd = newtmp('rec', 'wav')
with os.fdopen(fd, 'wb') as f:
    w = wave.open(f, 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(raw)
    w.close()
o.update({'ok': True, 'path': p, 'mime': 'audio/wav', 'seconds': round(len(raw) / 2.0 / RATE, 3), 'rate': RATE, 'channels': 1,
          'bytes': os.path.getsize(p), 'peak': round(min(1.0, peak), 4), 'device': mon, 'tool': rec})
if ms < asked * 1000:
    o['asked'] = asked
    o['note'] = '; '.join([x for x in [o.get('note'), "cut to %.2f s to finish inside the host's 10 s" % (ms / 1000.0)] if x])
if peak == 0:
    o['note'] = '; '.join([x for x in [o.get('note'), 'silent: nothing was playing on ' + mon] if x])
out(o)
