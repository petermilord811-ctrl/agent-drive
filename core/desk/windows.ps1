# windows.ps1 -- the `windows` op: every top-level window a person could see, front to back, and the monitors.
# Runs after common.ps1 and screens.ps1 (desk.js joins them). Changes nothing on the machine.
#
# Answer: {ok, op:"windows", os:"windows", foreground:<id>, awareness, windows:[{id, title, process, pid, class,
#          rect:[x,y,w,h]|null, minimized, maximized, foreground, owner}], monitors:[{name, rect, work, primary, dpi}]}
# Rectangles are physical screen pixels when awareness is "per-monitor" (see DDpi); the secondary monitor of a
# side-by-side pair has negative x, and a window rect is in the same space as the monitor rects.
DRun {
    $fg = $API::GetForegroundWindow()
    $list = New-Object Collections.ArrayList
    foreach ($h in (DTopWins)) { [void]$list.Add((DWin $h $fg)) }
    [ordered]@{ ok = $true; foreground = [int64]$fg; awareness = $AWARE; windows = $list; monitors = (DMonitors) }
}
