# read.ps1 -- the `read` op on Windows: one chunk of a file, as base64. Changes nothing.
# Args: {path, off, n} (desk.js fills in off 0 and n, and caps n so the answer stays inside the host's 512 KB of
# output). Answer: {ok, total (the file's size now), off, n (bytes in this chunk), full, b64}. The caller asks again
# from off + n until it reaches total; off at or past the end is an empty chunk, not an error.
#
# SHARED READ: the file is opened letting others keep reading, writing and even deleting it (FileShare ReadWrite,
# Delete), so a log an app is still writing can be fetched. A program that opened its file with no sharing at all
# still refuses -- that is the "open in another program" answer.
DRun {
    $p = '' + $DJ.path
    try {
        $p = DFull $p
        if ([IO.Directory]::Exists($p)) { return [ordered]@{ ok = $false; err = 'isdir'; verb = 'read'; full = $p } }
        $f = [IO.File]::Open($p, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
        try {
            $total = $f.Length
            $off = [Math]::Min([int64]$DJ.off, $total)
            $buf = New-Object byte[] ([int][Math]::Min([int64]$DJ.n, $total - $off))
            [void]$f.Seek($off, [IO.SeekOrigin]::Begin)
            $got = 0
            while ($got -lt $buf.Length) {
                $k = $f.Read($buf, $got, $buf.Length - $got)
                if ($k -le 0) { break }
                $got += $k
            }
        } finally { $f.Dispose() }
        $o = [ordered]@{ ok = $true; total = $total; off = $off; n = $got; full = $p }
        $o.__raw = ',"b64":"' + [Convert]::ToBase64String($buf, 0, $got) + '"'
        $o
    } catch { DErr $_.Exception 'read' $p }
}
