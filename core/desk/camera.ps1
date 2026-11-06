# camera.ps1 -- the `camera` op on Windows: one photo from a webcam, as a JPEG in this account's temp folder (see
# temp.ps1). Args: {device?, dry?} -- device: part of a camera's name (the first camera otherwise); dry: list the
# cameras and say which one it would use, without turning any on. Answer: {ok, path, mime, bytes, device, cameras}
# -- read the file with `read`, then remove it with `rm`. The camera's light comes on for the second or two this
# takes; asking the person first is the caller's part, every time.
#
# HOW: WinRT's MediaCapture (what the Camera app uses), driven from Windows PowerShell 5.1. An async WinRT call is
# awaited through System.Runtime.WindowsRuntime's AsTask() and .GetAwaiter().GetResult(), NOT .Wait(): Wait wraps
# a failure in an AggregateException that says only "One or more errors occurred", and the person needs to hear
# "access is denied" or "in use" instead.
#
# THE FIRST FRAME IS DARK: a webcam starts with its exposure and white balance at their defaults, so a photo taken
# the instant the device opens comes out black or murky. It is given 600 ms to settle first.
#
# A FILE, NOT BASE64 ON STDOUT: a photo can pass the host's 512 KB of output once it is base64, and a script that
# turns a picture into base64 on stdout is the shape antivirus (AMSI) has been seen to block outright -- the
# relay's screen grab was refused that way before a line of it ran. A file read back with `read` is neither.
DRun {
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        $null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
        $null = [Windows.Media.Capture.MediaCapture, Windows.Media.Capture, ContentType = WindowsRuntime]
        $null = [Windows.Media.Capture.MediaCaptureInitializationSettings, Windows.Media.Capture, ContentType = WindowsRuntime]
        $null = [Windows.Media.MediaProperties.ImageEncodingProperties, Windows.Media.MediaProperties, ContentType = WindowsRuntime]
        $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    } catch { return [ordered]@{ ok = $false; why = 'the Windows camera API (WinRT MediaCapture) is not available on this Windows: ' + (DInner $_.Exception).Message } }
    $as = @([WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 })
    $asOp = $as | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    $asAct = $as | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
    function DAwait($op, [type]$t) { $asOp.MakeGenericMethod($t).Invoke($null, @($op)).GetAwaiter().GetResult() }
    function DDo($act) { [void]$asAct.Invoke($null, @($act)).GetAwaiter().GetResult() }

    $all = DAwait ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::VideoCapture)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
    $cams = @($all | Where-Object { $_.IsEnabled })
    $names = @($cams | ForEach-Object { '' + $_.Name })
    if ($cams.Count -eq 0) { return [ordered]@{ ok = $false; why = 'no camera: Windows lists no video capture device on this machine'; cameras = $names } }
    $want = '' + $DJ.device
    $pick = $null
    foreach ($c in $cams) { if (-not $want -or ('' + $c.Name).IndexOf($want, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $pick = $c; break } }
    if ($null -eq $pick) { return [ordered]@{ ok = $false; why = "no camera's name contains `"$want`""; cameras = $names } }
    if ($DJ.dry) { return [ordered]@{ ok = $true; dry = $true; device = $pick.Name; cameras = $names } }

    $mc = New-Object Windows.Media.Capture.MediaCapture
    $set = New-Object Windows.Media.Capture.MediaCaptureInitializationSettings
    $set.VideoDeviceId = $pick.Id
    $set.StreamingCaptureMode = [Windows.Media.Capture.StreamingCaptureMode]::Video
    $st = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    try {
        DDo ($mc.InitializeAsync($set))
        Start-Sleep -Milliseconds 600
        DDo ($mc.CapturePhotoToStreamAsync([Windows.Media.MediaProperties.ImageEncodingProperties]::CreateJpeg(), $st))
    } catch {
        $e = DInner $_.Exception
        $h = '{0:X8}' -f $e.HResult
        $hint = switch ($h) {
            '80070005' { ' -- Windows refused it: "Let desktop apps access your camera" (Settings > Privacy & security > Camera) may be off' }
            'C00D3704' { ' -- the camera may be in use by another app' }
            'C00DABE4' { ' -- another app took the camera' }
            'C00DABE0' { ' -- the camera went away (unplugged or disabled)' }
            default { '' }
        }
        return [ordered]@{ ok = $false; why = ('could not take the photo with ' + $pick.Name + ': ' + $e.Message.Trim() + ' (0x' + $h + ')' + $hint); device = $pick.Name; cameras = $names }
    } finally { try { $mc.Dispose() } catch {} }
    if ($st.Size -eq 0) { return [ordered]@{ ok = $false; why = ($pick.Name + ' answered with an empty photo'); device = $pick.Name; cameras = $names } }
    $p = DTemp 'cam' 'jpg'
    $in = [IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st.GetInputStreamAt(0))
    $f = [IO.File]::Open($p, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $in.CopyTo($f); $n = $f.Length } finally { $f.Dispose(); $in.Dispose() }
    [ordered]@{ ok = $true; path = $p; mime = 'image/jpeg'; bytes = $n; device = $pick.Name; cameras = $names }
}
