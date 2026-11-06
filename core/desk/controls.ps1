# controls.ps1 -- the `controls` op: read a window's controls through UI Automation instead of its pixels.
# Args: {id} or {title} (as `focus`), else the foreground window; {max, depth, budget} bound the walk.
# desk.js puts $DESKUIA (the text of uia.cs) in front of this file; it is compiled here, in this op only,
# because the COM interop it needs cannot be declared by reflection emit cheaply.
#
# Answer: {ok, window:{...as in windows}, matches, count, truncated, stop:"max"|"time"|"", awareness,
#          controls:[{i, p, d, name, type, aid, class, rect, enabled, focusable, focused, isPassword}]}
# Names only, never values; a password field is flagged with no name (see uia.cs). `type` leaves here as UIA's
# numeric control type ID; desk.js's parse() names it.
#
# A SIDE EFFECT TO KNOW: a Chromium-based window (Chrome, Edge, Electron apps such as VS Code) builds its
# accessibility tree only once a UI Automation client asks -- the first read can come back thin, and the app
# may notice "an assistive technology" (VS Code can offer its screen-reader mode). Not measured here: the tests
# read only their own WinForms window.
#
# THE CLOCK. The host ends the exec at 10 s after it started cmd.exe, and an exec that is ended returns
# nothing at all -- so the walk gets what is left of `budget` (default 7 s) counted from THIS PROCESS'S start,
# after PowerShell's own start-up and the C# compile have taken theirs, and the answer is written with ~3 s
# to spare. A cut walk is still an answer (truncated:true, stop:"time").
DRun {
    $fg = $API::GetForegroundWindow()
    $n = 0
    if ($null -ne $DJ.id -or $DJ.title) {
        $f = DFind
        if ($f -is [string]) { return [ordered]@{ ok = $false; why = ($f + ' -- `windows` lists them') } }
        $h = $f.h; $n = $f.n
    } else {
        $h = $fg
        if ($h -eq [IntPtr]::Zero) { return [ordered]@{ ok = $false; why = 'no window is in the foreground (the desktop may be locked or switching)' } }
        $n = 1
    }
    $w = DWin $h $fg
    if ($API::IsIconic($h)) { return [ordered]@{ ok = $false; why = 'the window is minimized, so nothing of it is on screen -- focus it first'; window = $w } }
    if ($API::IsHungAppWindow($h)) { return [ordered]@{ ok = $false; why = 'the window is not responding'; window = $w } }
    Add-Type -TypeDefinition $DESKUIA
    $left = [int]([int]$DJ.budget - ((Get-Date) - $DSTART).TotalMilliseconds)
    $r = [DeskUia]::Walk([int64]$h, [int]$DJ.max, [int]$DJ.depth, [Math]::Max(800, $left))
    if ($r.Error -and $r.Count -eq 0) { return [ordered]@{ ok = $false; why = ('UI Automation: ' + $r.Error); window = $w } }
    # Nothing at all before the clock ran out: the app did not answer UI Automation (busy, or hung for less than
    # the 5 s after which Windows calls it "not responding"). Its walker is left blocked; this process exits.
    if ($r.Count -eq 0 -and $r.Stop -eq 'time') { return [ordered]@{ ok = $false; why = 'the window did not answer UI Automation in time (it may be busy or hung) -- try again, or look at it instead'; window = $w } }
    $o = [ordered]@{ ok = $true; window = $w; matches = $n; count = $r.Count; truncated = $r.Truncated; stop = $r.Stop; awareness = $AWARE }
    if ($r.Error) { $o.error = $r.Error }
    $o.__raw = ',"controls":' + $r.Json
    $o
}
