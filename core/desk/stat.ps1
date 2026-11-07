# stat.ps1 -- the `stat` op on Windows: is there a file or a folder at this path, and how big is it. Changes nothing.
# Args: {path}. Answer: {ok, exists, dir, size (bytes; null for a folder or nothing), full, mtime (ms since 1970,
# UTC; null for nothing)}. Nothing there is still ok -- exists:false is the answer; ok:false means it could not
# tell (no permission, not a usable path).
DRun {
    $p = '' + $DJ.path
    try {
        $p = DFull $p
        try { $a = [IO.File]::GetAttributes($p) }
        catch {
            $e = DInner $_.Exception
            if ($e -is [IO.FileNotFoundException] -or $e -is [IO.DirectoryNotFoundException]) { return [ordered]@{ ok = $true; exists = $false; dir = $false; size = $null; full = $p; mtime = $null } }
            throw
        }
        $dir = ($a -band [IO.FileAttributes]::Directory) -ne 0
        if ($dir) { $i = New-Object IO.DirectoryInfo $p; $n = $null } else { $i = New-Object IO.FileInfo $p; $n = $i.Length }
        [ordered]@{ ok = $true; exists = $true; dir = $dir; size = $n; full = $p; mtime = [int64]($i.LastWriteTimeUtc - [datetime]'1970-01-01').TotalMilliseconds }
    } catch { DErr $_.Exception 'look at' $p }
}
