# temp.ps1 -- where a capture leaves its file on Windows, and the only files `rm` will remove.
#
# A photo or a recording can be bigger than one exec's answer (512 KB, as base64), so camera and audio write it
# to a file in THIS ACCOUNT's temp folder and answer its path; the caller reads it with `read` and removes it
# with `rm`. The name carries 16 random hex digits (a GUID's): the host's agent runs as SYSTEM, whose temp folder
# (C:\Windows\Temp) every local account may create files in, and a name nobody can predict is a name nobody can
# have planted a link at. The file is created new (CreateNew) or not at all.
#
# rm removes a file only if it is ONE OF THESE: a name of exactly this shape, directly in this account's temp
# folder -- never a path the caller merely says is a capture. (desk.js checks the name before it builds; this
# checks the folder too, which only the host knows.)
$global:DTDIR = [IO.Path]::GetTempPath()
function DTemp($kind, $ext) { [IO.Path]::Combine($DTDIR, 'agent-drive-' + $kind + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 16) + '.' + $ext) }
function DMine($p) {
    ([IO.Path]::GetFileName($p) -cmatch '^agent-drive-(cam-[0-9a-f]{16}\.jpg|rec-[0-9a-f]{16}\.wav)$') -and
    [string]::Equals([IO.Path]::GetDirectoryName($p).TrimEnd('\'), [IO.Path]::GetFullPath($DTDIR).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}
