# media.py -- running a capture tool on Linux (camera, audio): its stdout IS the picture or the sound, read
# against a deadline. The host kills the whole exec at 10 s and then returns nothing, so no tool here is trusted
# to stop by itself: what it has said by `until` is what there is. The tool never writes a file of its own -- this
# script writes the one file (temp.py), so a tool running as another user (audio runs as the person at the desk)
# needs no way into this account's temp folder.
import select
import shutil
import subprocess


def tool(names, path=None):
    for n in names:
        if shutil.which(n, path=path):
            return n
    return ''


# (stdout bytes, stderr text, exit code -- None when it was stopped here). want: stop once that many bytes have
# come (0: read until it exits). stderr is read alongside, so a tool that complains a lot never blocks on it.
def grab(argv, want, until, env=None, preexec=None):
    try:
        p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=env, preexec_fn=preexec)
    except OSError as e:
        return b'', str(e), -1
    buf, err = bytearray(), bytearray()
    fds = {p.stdout.fileno(): buf, p.stderr.fileno(): err}
    while fds and (not want or len(buf) < want):
        left = until - time.time()
        if left <= 0:
            break
        ready = select.select(list(fds), [], [], min(left, 0.2))[0]
        for f in ready:
            b = os.read(f, 65536)
            if b:
                fds[f].extend(b)
            else:
                del fds[f]
    if not fds:
        try:
            p.wait(max(0.2, min(2.0, until - time.time())))
        except subprocess.TimeoutExpired:
            pass
    code = p.poll()
    if code is None:
        p.terminate()
        try:
            p.wait(1)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
    return bytes(buf[:want] if want else buf), err.decode('utf-8', 'replace').strip(), code
