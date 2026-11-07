# lean.ps1 -- the head of the Windows desk ops that touch files and devices rather than windows: stat, read,
# write, rm, camera, audio. desk.js joins it with the parts an op needs and the op's own file, which calls DRun.
#
# A LEAN TWIN OF common.ps1's DOut AND DRun: the same one line of ASCII JSON, the same exit codes, the same
# travel (the args in $DA as base64 of UTF-8 JSON) -- without the native calls. Those cost ~70 ms of reflection
# emit and ~1.4 KB of packed command line, and none of these ops calls a window API; for `write` the line IS
# the payload (every byte of script is a byte of file that does not fit), so they ship only this.
#
# THE DATA OF A WRITE rides beside the args, in $DB: base64 of the chunk itself. Inside the JSON args it would
# be base64 twice over (16/9 the size).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$global:DOP = ''

# The answer, as one line (see common.ps1's DOut): ok/op/os first; a '__raw' entry is a JSON fragment spliced in
# before the closing brace -- a read's base64, which ConvertTo-Json would otherwise copy and escape-check for
# nothing. Every character outside printable ASCII leaves as \uXXXX: a pipe's code page would mangle it.
function DOut($o) {
    $r = [ordered]@{ ok = [bool]$o['ok']; op = $global:DOP; os = 'windows' }
    $raw = ''
    foreach ($k in @($o.Keys)) {
        if ($k -eq '__raw') { $raw = '' + $o[$k] } elseif (-not $r.Contains($k)) { $r[$k] = $o[$k] }
    }
    $j = ConvertTo-Json -InputObject $r -Compress -Depth 6
    if ($raw) { $j = $j.Substring(0, $j.Length - 1) + $raw + '}' }
    $j = [regex]::Replace($j, '[^\x20-\x7e]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    [Console]::Out.Write($j + "`n")
    [Console]::Out.Flush()
}

# The exception under PowerShell's wrappers: a .NET method that throws reaches a catch as "Exception calling
# "Open" with "4" argument(s): ..." around the real one, whose type says what happened.
function DInner($e) {
    while ($e.InnerException -and ($e -is [Management.Automation.RuntimeException] -or $e -is [Reflection.TargetInvocationException] -or $e -is [AggregateException])) { $e = $e.InnerException }
    $e
}

# Run an op (see common.ps1's DRun): decode the args, run the body, print the LAST thing it emitted as the
# answer -- or the exception as one -- and exit 0 for ok, 1 for not.
function DRun([scriptblock]$body) {
    $code = 1
    try {
        $global:DJ = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DA)) | ConvertFrom-Json
        $global:DOP = '' + $DJ.op
        $res = @(& $body)
        $r = $res[$res.Count - 1]
        if ($r['ok']) { $code = 0 }
        DOut $r
    } catch {
        DOut ([ordered]@{ ok = $false; why = ('PowerShell: ' + (DInner $_.Exception).Message) })
    }
    exit $code
}
