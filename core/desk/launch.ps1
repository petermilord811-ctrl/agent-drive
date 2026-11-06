# launch.ps1 -- the `launch` op: start an app, a document or a URL, detached, AS THE PERSON AT THE DESKTOP, and
# say which window it opened. Args: {app, argline?, cwd?, wait?, focus?, dry?}. desk.js turns the caller's
# `args` into `argline` (a string is passed as it is; an array is quoted the way CommandLineToArgvW reads it).
#
# WHY NOT cmd's `start "" ...`: cmd.exe's start shows a GUI error box ("Windows cannot find ...") on the
# person's screen for a name it cannot find, expands %VARS% inside the quotes and cannot carry a double quote
# at all. Start-Process is the same ShellExecuteEx underneath -- so "notepad", "chrome" (App Paths),
# "https://..." (the default browser), "ms-settings:" and "C:\x\report.docx" all work -- but it fails in
# words, here, instead of in a dialog there.
#
# WHY Start-Process AND NOT [Diagnostics.Process]::Start(ProcessStartInfo), which does the same: MEASURED, the
# script written with ProcessStartInfo took 1.6-3.6 s to START on this Windows 11 (Defender on), against
# 0.3-0.4 s with Start-Process -- and taking out almost any one of a dozen unrelated lines made it fast again,
# which is the signature of the antimalware scan (AMSI) scoring the Invoke-Expression'd text as a whole, not
# of anything the script does. On a 10 s budget that is a third of it, so the cmdlet it is.
#
# AS WHOM. The Windows host's agent runs as LocalSystem INSIDE the interactive session (ScreenSender.cpp,
# LaunchSessionAgent), and an exec runs as the agent. An app started from there would run as SYSTEM on the
# person's desktop: SYSTEM's profile (no browser profile, no documents, no settings) and a SYSTEM-level program
# handed to whoever sits at the machine -- Notepad's Open dialog alone runs anything as SYSTEM. The host avoids
# exactly that for dropped files (WTSQueryUserToken); so does this. As SYSTEM, a hidden PowerShell is started
# as the signed-in user (WTSQueryUserToken + CreateProcessAsUserW on winsta0\default, the user's own
# environment block) and IT does the Start-Process, handing back the new pid as its exit code. With nobody
# signed in there is no one to start it as, and it is refused rather than started as SYSTEM. A host that runs
# as an ordinary user starts it directly.
#
# DETACHED: the host's exec job has no kill-on-close ("an operator's 'start notepad' must outlive the exec",
# ScreenSender.cpp), and this script exits long before the 10 s deadline that would end the job.
#
# THE WINDOW. A launch is only useful once you know where the app is, so the visible windows are noted before
# and watched after (up to `wait` ms): the first NEW one -- the started process's own if it has one, else any
# (Win11 Notepad, Store apps and a browser hand off to another process) -- is reported and, unless
# focus:false, brought to the front with front.ps1's cascade (a process started by a background process opens
# BEHIND the window the person is using). None in time is still a success: a URL can become a tab in a
# browser that is already open.
#
# Answer: {ok, started:{file, arguments, cwd, as, pid, process}, window:{...}|null, how, note?}
$global:DNATS += ';wtsapi32 WTSQueryUserToken B UP;userenv CreateEnvironmentBlock B PPB;userenv DestroyEnvironmentBlock B P;' +
'advapi32 CreateProcessAsUserW B PPTPPBUPSPP;kernel32 WaitForSingleObject U PU;kernel32 GetExitCodeProcess B PP;kernel32 CloseHandle B P'

function DQ($s) { "'" + ('' + $s).Replace("'", "''") + "'" }

# What the user-side PowerShell runs: Start-Process, and the new pid as its exit code (0: started, no process of
# its own -- a URL handed to a browser already open; -1: it could not be started). Every value is a
# single-quoted literal, so nothing in a name or an argument is expanded on the way.
function DUserScript($app, $argline, $wd) {
    $s = '$ErrorActionPreference=''Stop'';try{$a=@{FilePath=' + (DQ $app) + ';PassThru=$true;WorkingDirectory=' + $(if ($wd) { DQ $wd } else { '$env:USERPROFILE' }) + '};'
    if ($argline) { $s += '$a.ArgumentList=' + (DQ $argline) + ';' }
    $s + '$p=Start-Process @a;if($p){exit $p.Id};exit 0}catch{exit -1}'
}

# Run a PowerShell script, hidden, as the token's user on the interactive desktop; wait for it (6 s at most)
# and answer its exit code -- or $null when it could not be started. STARTUPINFOW is laid out by hand: cb at 0,
# lpDesktop two pointers in, 68 bytes on x86 and 104 on x64; CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT.
function DAsUser($tok, $script) {
    $cl = New-Object Text.StringBuilder ('powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script)))
    $n = [IntPtr]::Size; $si = $MR::AllocHGlobal(128); $pi = $MR::AllocHGlobal(32); $eb = [IntPtr]::Zero
    for ($i = 0; $i -lt 128; $i += 4) { $MR::WriteInt32($si, $i, 0) }
    $MR::WriteInt32($si, 0, 68 + 9 * ($n - 4))
    $MR::WriteIntPtr($si, 2 * $n, $MR::StringToHGlobalUni('winsta0\default'))
    if ($API::CreateEnvironmentBlock($DBUF, $tok, $false)) { $eb = $MR::ReadIntPtr($DBUF, 0) }
    $ok = $API::CreateProcessAsUserW($tok, [IntPtr]::Zero, $cl, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0x08000400, $eb, [Environment]::SystemDirectory, $si, $pi)
    if ($eb -ne [IntPtr]::Zero) { [void]$API::DestroyEnvironmentBlock($eb) }
    if (-not $ok) { return $null }
    $hp = $MR::ReadIntPtr($pi, 0)
    [void]$API::WaitForSingleObject($hp, 6000)
    [void]$API::GetExitCodeProcess($hp, $DBUF)
    [void]$API::CloseHandle($hp); [void]$API::CloseHandle($MR::ReadIntPtr($pi, $n))
    $MR::ReadInt32($DBUF, 0)
}

DRun {
    $app = '' + $DJ.app
    $argline = '' + $DJ.argline
    $sys = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq 'S-1-5-18'
    # The working folder: what was asked, else the person's own profile (what Explorer gives a program it
    # starts) -- never the host's install folder, which is this process's, nor SYSTEM's profile.
    $wd = '' + $DJ.cwd
    if ($wd -and -not (Test-Path -LiteralPath $wd -PathType Container)) { $wd = '' }
    if (-not $wd -and -not $sys) { $wd = $env:USERPROFILE }
    $started = [ordered]@{ file = $app; arguments = $argline; cwd = $wd; as = $(if ($sys) { 'the signed-in user' } else { 'this account' }); pid = $null; 'process' = '' }
    if ($DJ.dry) { return [ordered]@{ ok = $true; dry = $true; started = $started } }

    $before = @{}
    foreach ($h in (DTopWins)) { $before[[int64]$h] = 1 }
    if ($sys) {
        if (-not $API::WTSQueryUserToken([uint32][Diagnostics.Process]::GetCurrentProcess().SessionId, $DBUF)) {
            return [ordered]@{ ok = $false; why = 'nobody is signed in to this session, and an app started from here would run as SYSTEM -- not started'; started = $started }
        }
        $tok = $MR::ReadIntPtr($DBUF, 0)
        $code = DAsUser $tok (DUserScript $app $argline $wd)
        [void]$API::CloseHandle($tok)
        if ($null -eq $code) { return [ordered]@{ ok = $false; why = 'could not start a process as the signed-in user (CreateProcessAsUser failed)'; started = $started } }
        if ($code -eq -1) { return [ordered]@{ ok = $false; why = 'Windows could not start it as the signed-in user (not found, or no app for it)'; started = $started } }
        if ($code -gt 0 -and $code -ne 259) { $started.pid = $code; $started['process'] = DProc $code }
    } else {
        $sp = @{ FilePath = $app; PassThru = $true }
        if ($argline) { $sp.ArgumentList = $argline }
        if ($wd) { $sp.WorkingDirectory = $wd }
        $p = Start-Process @sp
        if ($null -ne $p) { try { $started.pid = $p.Id; $started['process'] = $p.ProcessName } catch {} }
    }

    $wait = [int]$DJ.wait
    $sw = [Diagnostics.Stopwatch]::StartNew(); $new = $null
    while ($null -eq $new -and $sw.ElapsedMilliseconds -lt $wait) {
        Start-Sleep -Milliseconds 150
        $mine = $null; $any = $null
        foreach ($h in (DTopWins)) {
            if ($before.ContainsKey([int64]$h)) { continue }
            if ($null -eq $any) { $any = $h }
            [void]$API::GetWindowThreadProcessId($h, $DBUF)
            if ($null -ne $started.pid -and $MR::ReadInt32($DBUF, 0) -eq $started.pid) { $mine = $h; break }
        }
        if ($null -ne $mine) { $new = $mine } elseif ($null -ne $any) { $new = $any }
    }
    if ($null -eq $new) {
        return [ordered]@{ ok = $true; started = $started; window = $null; how = ''
            note = "started; no new window appeared within $wait ms (it may still be loading, or it opened in a window that was already there)" }
    }
    $global:DPROC = $null
    $how = ''
    if ($DJ.focus) { if (-not $API::IsHungAppWindow($new)) { $how = DFocus $new } }
    [ordered]@{ ok = $true; started = $started; window = (DWin $new ($API::GetForegroundWindow())); how = $how }
}
