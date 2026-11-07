# rm.ps1 -- the `rm` op on Windows: remove the temp file a capture (camera, audio) left, once it has been read.
# Args: {path}. Answer: {ok, removed (false: it was already gone), full}. Anything that is not one of those files
# is refused (err "notmine"; temp.ps1 says which they are) -- this is not a general delete.
DRun {
    $p = '' + $DJ.path
    try {
        $p = DFull $p
        if (-not (DMine $p)) { return [ordered]@{ ok = $false; err = 'notmine'; verb = 'remove'; full = $p; temp = $DTDIR } }
        if (-not [IO.File]::Exists($p)) { return [ordered]@{ ok = $true; removed = $false; full = $p } }
        [IO.File]::Delete($p)
        [ordered]@{ ok = $true; removed = $true; full = $p }
    } catch { DErr $_.Exception 'remove' $p }
}
