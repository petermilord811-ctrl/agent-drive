# common.ps1 -- the shared head of every Windows desk script. core/desk.js joins it with the parts an op needs
# (front.ps1 for focus/launch, screens.ps1 for windows) and the op's own file, which calls DRun last.
#
# HOW IT TRAVELS. desk.js drops every comment line and leading indentation, gzips the text and ships it inside
# one short bootstrap:
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$DA='<args>';$DR=...GZipStream...;Invoke-Expression $DR.ReadToEnd()"
# The host runs that as `cmd.exe /c <it>` (single/ScreenSender.cpp RunCommandCapture), and cmd.exe refuses a
# line over 8,191 characters -- so prose stays in the files and never travels, and each op ships only the
# parts it calls. $DA is base64 of the UTF-8 JSON args ({op, ...}): base64 has none of cmd.exe's special
# characters (% ! ^ & | < > ") and the bootstrap has no double quote inside, so a title like
# `Tom & Jerry "100%"` crosses cmd.exe and PowerShell's own command-line parser untouched. Nothing a person
# typed is ever on the command line as text.
#
# WHAT IT PRINTS: exactly ONE line, {"ok":..,"op":..,"os":"windows",...}, and nothing else. The host hands
# back stdout and stderr merged (and maybe behind a cmd.exe AutoRun banner), so desk.js's parse() looks for
# that line rather than assuming the output is it. The line is pure ASCII: a pipe's code page is the OEM
# one, which turns a Greek or Chinese title into question marks, so every character outside printable ASCII
# leaves as a \uXXXX escape and JSON.parse puts it back.
#
# THE HOST'S DEADLINE IS 10 s (RunExecJob: 10000 ms, then the whole job is terminated and nothing comes
# back). Every op answers well inside it; controls.ps1 measures its walk against this process's start time.
#
# NAMES. PowerShell variables are CASE-INSENSITIVE: a loop counter $n silently replaced a $N that held the
# native type during development. So the shared state has long global names ($API, $DBUF, ...) that no local
# reuses, and every function is D<Something> -- an alias beats a function in command resolution, and none of
# these is an alias (checked with Get-Alias).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$global:DOP = ''

# THE NATIVE CALLS, one "dll name returns params" entry each, in a code -- P IntPtr, U uint32, I int, B bool,
# S string, T StringBuilder, V void, L int64, Y byte, - none. A part adds its own with $global:DNATS += ';...'.
$global:DNATS = 'user32 GetTopWindow P P;user32 GetWindow P PU;user32 IsWindow B P;user32 IsWindowVisible B P;' +
'user32 IsIconic B P;user32 IsZoomed B P;user32 IsHungAppWindow B P;user32 GetWindowTextW I PTI;user32 GetClassNameW I PTI;' +
'user32 GetWindowThreadProcessId U PP;user32 GetWindowRect B PP;user32 GetForegroundWindow P -;user32 FindWindowExW P PPSP;' +
'user32 SetProcessDpiAwarenessContext B P;user32 SetThreadDpiAwarenessContext P P;user32 GetThreadDpiAwarenessContext P -;' +
'user32 GetAwarenessFromDpiAwarenessContext I P;user32 SetProcessDPIAware B -;shcore SetProcessDpiAwareness I I;' +
'dwmapi DwmGetWindowAttribute I PIPI'

# The answer, as one line. $o is an [ordered] dictionary; ok/op/os lead so a person reading the raw line sees
# them first. A '__raw' entry is a JSON fragment (`,"controls":[...]`) spliced in before the closing brace:
# the UI Automation walk writes its own JSON in C#, and ConvertTo-Json on a thousand elements would cost the
# time the walk needs.
function DOut($o) {
    $r = [ordered]@{ ok = [bool]$o['ok']; op = $global:DOP; os = 'windows' }
    $raw = ''
    foreach ($k in @($o.Keys)) {
        if ($k -eq '__raw') { $raw = '' + $o[$k] } elseif (-not $r.Contains($k)) { $r[$k] = $o[$k] }
    }
    $j = ConvertTo-Json -InputObject $r -Compress -Depth 12
    if ($raw) { $j = $j.Substring(0, $j.Length - 1) + $raw + '}' }
    $j = [regex]::Replace($j, '[^\x20-\x7e]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    [Console]::Out.Write($j + "`n")
    [Console]::Out.Flush()
}

# Run an op: decode the args, declare the native calls, run the body, print its answer -- or the exception
# as an answer, so a failure is still ONE parseable line. The body returns an [ordered] dictionary (PowerShell
# does not unroll a dictionary in the pipeline, so the LAST thing emitted is the answer even if a stray value
# leaked out before it). Exit 0 for ok, 1 for not -- with `exit`, which ends powershell.exe even from inside
# Invoke-Expression'd code and does not wait for a UI Automation call stuck on a background thread (measured:
# 0.3 s with a thread asleep for 30 s). NOT [Environment]::Exit: under Windows PowerShell 5.1 that alone costs
# 2.2 s (measured 2,350 ms against 150 ms for the same one-liner with `exit`), on a 10 s budget.
function DRun([scriptblock]$body) {
    $code = 1
    try {
        $global:DJ = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DA)) | ConvertFrom-Json
        $global:DOP = '' + $DJ.op
        DInit
        $res = @(& $body)
        $r = $res[$res.Count - 1]
        if ($r['ok']) { $code = 0 }
        DOut $r
    } catch {
        DOut ([ordered]@{ ok = $false; why = ('PowerShell: ' + $_.Exception.Message) })
    }
    exit $code
}

# DECLARED BY REFLECTION EMIT. Add-Type with C# source shells out to csc.exe (0.3-1.3 s, and temp files);
# DefinePInvokeMethod is ~70 ms and touches no disk. Only controls compiles C#, for COM interop.
# SetImplementationFlags(PreserveSig) is NOT optional: without it the emitted method reads its own return value
# as an HRESULT and every call silently answers nothing (tools/taskman/taskman.ps1 found that out).
# Out-parameters go through a scratch buffer ($DBUF) read with Marshal -- no structs to declare.
function DInit {
    $ab = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName 'DeskNat'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
    $tb = $ab.DefineDynamicModule('DeskNat').DefineType('DeskNat', [Reflection.TypeAttributes]'Public,Abstract,Sealed')
    $ty = @{ P = [IntPtr]; U = [uint32]; I = [int]; B = [bool]; S = [string]; T = [Text.StringBuilder]; V = [void]; L = [int64]; Y = [byte] }
    foreach ($e in $global:DNATS.Split(';')) {
        $d = $e.Split(' ')
        $ps = [type[]]@(); if ($d[3] -ne '-') { $ps = [type[]]@($d[3].ToCharArray() | ForEach-Object { $ty['' + $_] }) }
        $m = $tb.DefinePInvokeMethod($d[1], $d[0] + '.dll', [Reflection.MethodAttributes]'Public,Static,PinvokeImpl', [Reflection.CallingConventions]::Standard, $ty[$d[2]], $ps, [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
        $m.SetImplementationFlags($m.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
    }
    $global:API = $tb.CreateType()
    $global:MR = [Runtime.InteropServices.Marshal]
    $global:DBUF = $MR::AllocHGlobal(64)
    $global:DSB = New-Object Text.StringBuilder 1024
    $global:DPROC = $null
    $global:DSTART = [Diagnostics.Process]::GetCurrentProcess().StartTime
    $global:AWARE = DDpi
}

# PHYSICAL PIXELS. A process that is not DPI-aware is lied to: on a 150% monitor GetWindowRect, the monitor
# bounds and UI Automation's rectangles all come back in 96-dpi units, and a click at them lands short -- the
# failure vision/look.js exists to prevent for screenshots. powershell.exe starts UNAWARE (measured: 0), so the
# strongest setting this Windows has is asked for: per-monitor v2 (Win10 1703+) for the process, else for this
# thread (-4 v2 from 1703, -3 v1 from 1607), else per-monitor (8.1), else system-aware (Vista; right only when
# every monitor shares one scale). What was granted is read back and reported as `awareness`.
function DAware { try { $API::GetAwarenessFromDpiAwarenessContext($API::GetThreadDpiAwarenessContext()) } catch { -1 } }
function DDpi {
    try { [void]$API::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}
    if ((DAware) -lt 2) { try { [void]$API::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch {} }
    if ((DAware) -lt 2) { try { [void]$API::SetThreadDpiAwarenessContext([IntPtr](-3)) } catch {} }
    $a = DAware
    if ($a -eq 2) { return 'per-monitor' }
    if ($a -le 0) {
        try { if ($API::SetProcessDpiAwareness(2) -eq 0) { return 'per-monitor' } } catch {}
        try { if ($API::SetProcessDPIAware()) { return 'system' } } catch {}
    }
    if ((DAware) -eq 1) { return 'system' }
    'unaware'
}

# GetWindowText, never GetWindowTextLength first: for ANOTHER process's window GetWindowText reads the caption
# without sending WM_GETTEXT, so a hung app cannot hang this. (This process owns no windows.)
function DText($h) { [void]$DSB.Clear(); [void]$API::GetWindowTextW($h, $DSB, 1024); $DSB.ToString() }
function DClass($h) { [void]$DSB.Clear(); [void]$API::GetClassNameW($h, $DSB, 256); $DSB.ToString() }

# The VISIBLE frame, from DWM. GetWindowRect includes the invisible 7-8 px resize borders on Windows 10/11 and
# runs past the monitor's edge for a maximized window (-8,-8 on a 1920 screen); DWMWA_EXTENDED_FRAME_BOUNDS (9)
# is where the window is drawn. It is in physical pixels whatever the caller's awareness.
function DRect($h) {
    if ($API::DwmGetWindowAttribute($h, 9, $DBUF, 16) -ne 0) { if (-not $API::GetWindowRect($h, $DBUF)) { return $null } }
    $l = $MR::ReadInt32($DBUF, 0); $t = $MR::ReadInt32($DBUF, 4); $r = $MR::ReadInt32($DBUF, 8); $b = $MR::ReadInt32($DBUF, 12)
    , @($l, $t, ($r - $l), ($b - $t))
}

# DWMWA_CLOAKED (14): "visible" but not drawn -- a suspended Store app, a window on another virtual desktop,
# the shell's hidden hosts. A person cannot see it, so it is not listed.
function DCloaked($h) { ($API::DwmGetWindowAttribute($h, 14, $DBUF, 4) -eq 0) -and ($MR::ReadInt32($DBUF, 0) -ne 0) }

# Every top-level window a person could see, FRONT TO BACK. GetTopWindow + GW_HWNDNEXT walks the Z order with
# no callback (EnumWindows would need a delegate, which reflection emit cannot hand over cheaply); the
# documented risk of that walk is a loop when windows die mid-walk, hence the cap. Visible, not cloaked,
# titled, and with an area (or minimized) -- the Alt+Tab idea, kept loose enough to include owned dialogs
# ("Save As"), which are exactly what an agent needs to notice. ([IntPtr]::Zero is TRUE in a PowerShell
# condition -- every handle test here compares.)
function DTopWins {
    $r = New-Object Collections.ArrayList
    $h = $API::GetTopWindow([IntPtr]::Zero); $cnt = 0
    while ($h -ne [IntPtr]::Zero -and $cnt -lt 4000) {
        $cnt++
        if ($API::IsWindowVisible($h) -and (DText $h) -and -not (DCloaked $h)) {
            if ($API::IsIconic($h)) { [void]$r.Add($h) }
            else { $rc = DRect $h; if ($null -ne $rc -and $rc[2] -gt 0 -and $rc[3] -gt 0) { [void]$r.Add($h) } }
        }
        $h = $API::GetWindow($h, 2)
    }
    , $r
}

# Process names from ONE snapshot: GetProcessById per window re-reads the whole process table every time.
function DProc($id) {
    if ($null -eq $global:DPROC) { $global:DPROC = @{}; foreach ($p in [Diagnostics.Process]::GetProcesses()) { $global:DPROC[$p.Id] = $p.ProcessName } }
    $nm = $global:DPROC[[int]$id]
    if ($nm) { $nm } else { '' }
}

# One window as the answer shows it. A Store app's frame belongs to ApplicationFrameHost, which says nothing
# about which app it is; the app's own process owns the Windows.UI.Core.CoreWindow child, so that pid is
# reported. A minimized window has no useful rectangle (it sits at -32000), so rect is null there. `id` is the
# HWND as a number: handles are 32-bit significant even in 64-bit Windows, and a number is what focus and
# controls take back.
function DWin($h, $fg) {
    [void]$API::GetWindowThreadProcessId($h, $DBUF); $wp = $MR::ReadInt32($DBUF, 0)
    $pn = DProc $wp
    if ($pn -eq 'ApplicationFrameHost') {
        $c = $API::FindWindowExW($h, [IntPtr]::Zero, 'Windows.UI.Core.CoreWindow', [IntPtr]::Zero)
        if ($c -ne [IntPtr]::Zero) { [void]$API::GetWindowThreadProcessId($c, $DBUF); $p2 = $MR::ReadInt32($DBUF, 0); if ($p2) { $wp = $p2; $pn = DProc $wp } }
    }
    $min = [bool]$API::IsIconic($h)
    $rc = $null; if (-not $min) { $rc = DRect $h }
    [ordered]@{ id = [int64]$h; title = (DText $h); 'process' = $pn; pid = $wp; 'class' = (DClass $h); rect = $rc
        minimized = $min; maximized = [bool]$API::IsZoomed($h); foreground = ([int64]$h -eq [int64]$fg); owner = [int64]$API::GetWindow($h, 4) }
}

# The window the args name: `id` (an HWND) wins; otherwise `title`, a case-insensitive substring, where an exact
# title beats a partial one and the frontmost beats the rest. Answers @{h; n = how many matched} or a sentence
# saying why there is none.
function DFind {
    if ($null -ne $DJ.id) {
        $h = [IntPtr][int64]$DJ.id
        if (-not $API::IsWindow($h)) { return "no window has id $($DJ.id) (it may have closed)" }
        return @{ h = $h; n = 1 }
    }
    $want = '' + $DJ.title
    $first = $null; $exact = $null; $cnt = 0
    foreach ($h in (DTopWins)) {
        $t = DText $h
        if ($t.IndexOf($want, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $cnt++
            if ($null -eq $first) { $first = $h }
            if ($null -eq $exact -and [string]::Equals($t, $want, [StringComparison]::OrdinalIgnoreCase)) { $exact = $h }
        }
    }
    if ($cnt -eq 0) { return "no visible window's title contains `"$want`"" }
    if ($null -ne $exact) { return @{ h = $exact; n = $cnt } }
    @{ h = $first; n = $cnt }
}
