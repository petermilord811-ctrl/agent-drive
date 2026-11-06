# focus.ps1 -- the `focus` op: restore a window if it is minimized and bring it to the front.
# Args: {id} (an HWND from `windows`) or {title} (case-insensitive part of the title); {dry:true} finds the
# window and says what it would do, and touches nothing -- which is how the tests check the matching on a
# real desktop without taking the person's focus away.
#
# Answer: {ok, how, matches, popup, window:{...as in windows}}; how = the step of front.ps1's cascade that worked
# ("already", "SetForegroundWindow", "input", "AttachThreadInput", "alt", "SwitchToThisWindow").
# A miss says why: no such window (with the titles there are), not responding, or Windows kept another window
# in front -- in which case the honest next step is a click on the window, not a sixth trick.
DRun {
    $f = DFind
    if ($f -is [string]) { return [ordered]@{ ok = $false; why = $f; windows = (DTitles) } }
    $h = $f.h
    # A window DISABLED behind its own modal dialog is not where input goes: activating it leaves the dialog
    # waiting behind. Windows itself sends the activation to the last active popup (the taskbar does the same),
    # so this does too, and says so.
    $popup = $false
    if (-not $API::IsWindowEnabled($h)) {
        $pp = $API::GetLastActivePopup($h)
        if ($pp -ne [IntPtr]::Zero -and $pp -ne $h -and $API::IsWindowVisible($pp)) { $h = $pp; $popup = $true }
    }
    if ($DJ.dry) { return [ordered]@{ ok = $true; dry = $true; matches = $f.n; popup = $popup; window = (DWin $h ($API::GetForegroundWindow())) } }
    if ($API::IsHungAppWindow($h)) { return [ordered]@{ ok = $false; why = 'the window is not responding'; window = (DWin $h ($API::GetForegroundWindow())) } }
    $how = DFocus $h
    $fg = $API::GetForegroundWindow()
    $w = DWin $h $fg
    if (-not $how) {
        $now = $null; if ($fg -ne [IntPtr]::Zero) { $now = DWin $fg $fg }
        return [ordered]@{ ok = $false; why = 'Windows kept another window in front (focus-steal protection) -- click the window to bring it forward'; window = $w; foreground = $now }
    }
    [ordered]@{ ok = $true; how = $how; matches = $f.n; popup = $popup; window = $w }
}
