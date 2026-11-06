# audio.ps1 -- the `audio` op on Windows: a few seconds of what the machine is PLAYING (loopback of the default
# output device -- never a microphone), as a WAV in this account's temp folder (see temp.ps1). Args: {seconds,
# dry?} -- dry: compile the recorder and open the device's loopback stream, keep nothing. Answer: {ok, path, mime,
# seconds, rate, channels, bytes, peak (0..1, the loudest sample), device} -- read the file with `read`, then
# remove it with `rm`. Asking the person first is the caller's part, every time.
#
# ONE COMMAND, NOT A STAGE AND A RECORD. Plain PowerShell cannot record loopback, so the recorder is C# (loop.cs,
# shipped in $DESKLOOP the way controls ships uia.cs) compiled here with Add-Type. Packed, it fits the command
# line beside this script; and compiling took ~0.2 s (MEASURED, Windows 11, Defender on), so the compile and the
# recording share one exec -- no recorder DLL is left on the machine between steps, and none is ever loaded from
# a temp folder other accounts can write to. desk.js puts $DESKLOOP just BEFORE this file, not at the top of the
# script: there, the antimalware scan took 1.7-3.6 s of every start; here, the whole dry run takes 0.5 s.
#
# THE CLOCK. The host ends an exec 10 s after it started cmd.exe and then returns NOTHING. So the clip is cut to
# end ~8.6 s after this process started, after PowerShell's start-up and the compile have taken theirs; a clip cut
# short says so (asked, note). The recorder pads silence by time, so `seconds` is the clip's real length. MEASURED:
# the longest clip desk.js asks for, 7 s, came back whole 7.6 s after cmd.exe started.
DRun {
    $t0 = [Diagnostics.Process]::GetCurrentProcess().StartTime
    try { Add-Type -TypeDefinition $DESKLOOP }
    catch { return [ordered]@{ ok = $false; why = 'the recorder did not compile on this machine (Add-Type): ' + (DInner $_.Exception).Message } }
    $asked = [double]$DJ.seconds
    $left = 8600 - ((Get-Date) - $t0).TotalMilliseconds
    $ms = [int][Math]::Min($asked * 1000, $left - 300)
    if (-not $DJ.dry -and $ms -lt 500) { return [ordered]@{ ok = $false; why = ('no time left to record: starting PowerShell and compiling the recorder took ' + [int](8600 - $left) + " ms of the host's 10 s -- try again") } }
    $p = DTemp 'rec' 'wav'
    try { $r = [DeskLoop]::Record($p, $ms, [bool]$DJ.dry) }
    catch {
        try { [IO.File]::Delete($p) } catch {}
        return [ordered]@{ ok = $false; why = ('could not record what is playing: ' + (DInner $_.Exception).Message) }
    }
    $src = [ordered]@{ rate = $r.Rate; channels = $r.Channels; format = $r.Format }
    if ($DJ.dry) { return [ordered]@{ ok = $true; dry = $true; device = $r.Device; source = $src } }
    $o = [ordered]@{ ok = $true; path = $p; mime = 'audio/wav'; seconds = [Math]::Round($r.Frames / $r.Rate, 3); rate = $r.Rate; channels = 1
        bytes = (New-Object IO.FileInfo $p).Length; peak = [Math]::Round($r.Peak, 4); device = $r.Device; source = $src }
    if ($ms -lt $asked * 1000) { $o.asked = $asked; $o.note = "cut to $([Math]::Round($ms / 1000, 2)) s to finish inside the host's 10 s" }
    if ($r.Peak -eq 0) { $o.note = (@($o.note, ('silent: nothing was playing on ' + $r.Device)) | Where-Object { $_ }) -join '; ' }
    $o
}
