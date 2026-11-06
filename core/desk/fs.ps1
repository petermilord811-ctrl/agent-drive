# fs.ps1 -- what stat, read, write and rm share on Windows: a path made whole, and a failure as a code.
#
# PATHS ARE LITERAL. The path arrives inside $DA (base64 of UTF-8 JSON), so nothing on the way -- cmd.exe's
# %VAR% and ^ and &, PowerShell's $ and backtick, a console code page -- ever sees it as text: a name with
# spaces, quotes, %, & or any non-ASCII character reaches .NET exactly as it was sent, and is never expanded
# (%USERPROFILE% stays those 13 characters). A relative path resolves against the host process's folder, which
# is nobody's idea of a place -- so every answer says `full`, the absolute path that was actually used.
function DFull($p) { [IO.Path]::GetFullPath(('' + $p)) }

# A FAILURE IS A CODE, {ok:false, err, verb, full, msg}, and desk.js's parse() says it in words (FILE_WHYS): the
# sentences cost no command line there -- every byte here is a byte a write chunk loses -- and Windows and Linux
# then say the same thing the same way. Win32 codes under IOException: 32/33 sharing or lock violation (another
# program has it open), 39/112 the disk is full.
function DErr($e, $verb, $p) {
    $e = DInner $e
    $w = $e.HResult -band 0xFFFF
    $c = 'other'
    if ($e -is [IO.FileNotFoundException]) { $c = 'nofile' } elseif ($e -is [IO.DirectoryNotFoundException]) { $c = 'nodir' }
    elseif ($e -is [UnauthorizedAccessException]) { $c = 'denied'; try { if ($verb -eq 'write' -and ([IO.File]::GetAttributes($p) -band 1)) { $c = 'readonly' } } catch {} }
    elseif ($e -is [IO.PathTooLongException]) { $c = 'toolong' } elseif ($e -is [ArgumentException] -or $e -is [NotSupportedException]) { $c = 'badpath' }
    elseif ($w -eq 32 -or $w -eq 33) { $c = 'inuse' } elseif ($w -eq 39 -or $w -eq 112) { $c = 'diskfull' }
    [ordered]@{ ok = $false; err = $c; verb = $verb; full = $p; msg = $e.Message }
}
