# write.ps1 -- the `write` op on Windows: put one chunk of a file on the machine. The bytes are $DB (base64; see
# lean.ps1). Args: {path, append, at?}. Answer: {ok, size (the file's size after), wrote (bytes this time), full}.
#
# A FILE IN CHUNKS: the first creates the file or empties an existing one (append:false); each later one adds to
# its end (append:true) and refuses a file that is not there (err "noappend") -- an append to nothing would leave
# a file with its beginning missing. `at`, with append, is where this chunk starts: the file is cut back to `at`
# first, so a chunk sent twice (a retry after an answer that was lost) lands once; a file SHORTER than `at` means
# a chunk before this one never arrived, and that is refused (err "gap").
#
# SHARING: the file is held FileShare Read while it is written -- a reader may look, nobody else may write.
DRun {
    $p = '' + $DJ.path
    try {
        $p = DFull $p
        $d = [Convert]::FromBase64String($DB)
        if ([IO.Directory]::Exists($p)) { return [ordered]@{ ok = $false; err = 'isdir'; verb = 'write'; full = $p } }
        $m = [IO.FileMode]::Create
        if ($DJ.append) {
            if (-not [IO.File]::Exists($p)) { return [ordered]@{ ok = $false; err = 'noappend'; verb = 'write'; full = $p } }
            $m = [IO.FileMode]::Open
        }
        $f = [IO.File]::Open($p, $m, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        try {
            if ($DJ.append -and $null -ne $DJ.at) {
                if ($f.Length -lt $DJ.at) { return [ordered]@{ ok = $false; err = 'gap'; verb = 'write'; full = $p; size = $f.Length; at = $DJ.at } }
                $f.SetLength($DJ.at)
            }
            [void]$f.Seek(0, [IO.SeekOrigin]::End)
            $f.Write($d, 0, $d.Length)
            $n = $f.Length
        } finally { $f.Dispose() }
        [ordered]@{ ok = $true; size = $n; wrote = $d.Length; full = $p }
    } catch { DErr $_.Exception 'write' $p }
}
