# front.ps1 -- bringing a window to the front on Windows, shared by focus.ps1 and launch.ps1 (desk.js ships it
# with those two only).
$global:DNATS += ';user32 IsWindowEnabled B P;user32 GetLastActivePopup P P;user32 SetForegroundWindow B P;' +
'user32 BringWindowToTop B P;user32 ShowWindowAsync B PI;user32 AttachThreadInput B UUB;user32 keybd_event V YYUP;' +
'user32 mouse_event V UUUUP;user32 SwitchToThisWindow V PB;kernel32 GetCurrentThreadId U -'

function DIsFg($h, $ms) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        if ([int64]$API::GetForegroundWindow() -eq [int64]$h) { return $true }
        if ($sw.ElapsedMilliseconds -ge $ms) { return $false }
        Start-Sleep -Milliseconds 25
    }
}

# PAST THE FOCUS-STEAL LOCK. Windows lets SetForegroundWindow work only for the process that had the last
# input, or the foreground one -- and this PowerShell, started by the host with no window, is neither. So a
# cascade, cheapest and least visible first, each step checked before the next:
#   1. SetForegroundWindow as it is (works while the foreground lock has lapsed);
#   2. after an EMPTY mouse event of our own (no move, no button), which makes this process "the one that had
#      the last input" -- PowerToys' trick, with nothing for a person to see;
#   3. AttachThreadInput to the foreground thread, so the two share input state (skipped when that thread is
#      hung: attaching to it can hang this one);
#   4. the ALT trick -- two Alt taps, so a menu bar the first opens in the old window the second closes again
#      (AutoHotkey's WinActivate does the same);
#   5. SwitchToThisWindow, the Alt+Tab path.
# A minimized window is restored first, with ShowWindowAsync: a plain ShowWindow on a hung app's window waits
# for that app. Answers the step that worked, or '' when Windows kept another window in front.
function DFocus($h) {
    if ($API::IsIconic($h)) {
        [void]$API::ShowWindowAsync($h, 9)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while ($API::IsIconic($h) -and $sw.ElapsedMilliseconds -lt 1500) { Start-Sleep -Milliseconds 25 }
    }
    if (DIsFg $h 0) { return 'already' }
    [void]$API::SetForegroundWindow($h); if (DIsFg $h 250) { return 'SetForegroundWindow' }
    $API::mouse_event(0, 0, 0, 0, [IntPtr]::Zero); [void]$API::SetForegroundWindow($h); if (DIsFg $h 250) { return 'input' }
    $fg = $API::GetForegroundWindow(); $me = $API::GetCurrentThreadId()
    if ($fg -ne [IntPtr]::Zero -and -not $API::IsHungAppWindow($fg)) {
        $ft = $API::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
        if ($ft -ne 0 -and $ft -ne $me -and $API::AttachThreadInput($me, $ft, $true)) {
            try { [void]$API::BringWindowToTop($h); [void]$API::SetForegroundWindow($h) } finally { [void]$API::AttachThreadInput($me, $ft, $false) }
            if (DIsFg $h 250) { return 'AttachThreadInput' }
        }
    }
    foreach ($i in 1, 2) { $API::keybd_event(0x12, 0, 0, [IntPtr]::Zero); $API::keybd_event(0x12, 0, 2, [IntPtr]::Zero) }
    [void]$API::SetForegroundWindow($h); if (DIsFg $h 250) { return 'alt' }
    $API::SwitchToThisWindow($h, $true); if (DIsFg $h 400) { return 'SwitchToThisWindow' }
    ''
}

# The titles a miss can choose from, so the next try is not a guess.
function DTitles {
    $r = New-Object Collections.ArrayList
    foreach ($h in (DTopWins)) { if ($r.Count -lt 20) { [void]$r.Add([ordered]@{ id = [int64]$h; title = (DText $h) }) } }
    , $r
}
