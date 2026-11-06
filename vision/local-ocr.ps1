# local-ocr.ps1 -- the Windows half of vision/local-ocr.js: the text in a PNG read with Windows' own recognizer
# (Windows.Media.Ocr, the one the Windows host reads with), printed as ONE line of JSON.
#
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File local-ocr.ps1 <png> [lang] [scale]
#   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File local-ocr.ps1 -Probe
#
# WINDOWS POWERSHELL 5.1, NEVER pwsh. The WinRT types are reached through the .NET Framework's projection
# ([T, Windows.Foundation, ContentType = WindowsRuntime] and System.Runtime.WindowsRuntime's AsTask), which .NET
# Core dropped: PowerShell 7 cannot load them this way. local-ocr.js starts 5.1 by its full path for that reason.
#
# THE ANSWER, on stdout, in ASCII only -- every other character \u-escaped, so no console code page can mangle a
# word on its way to node:
#   {"ok":true,"lang":"en-US","pw":900,"ph":260,"scale":2,"max":10000,"ms":41,"angle":0.00,
#    "lines":[{"t":"Export display","w":[["Export",44,46,96,27],...]}]}
# Boxes are in the PNG's OWN pixels, whole numbers, whatever size it was read at; `scale` is the size it WAS read
# at (the one asked for, shrunk to fit the recognizer's MaxImageDimension); `ms` is the recognizer's own time.
# Anything wrong is {"ok":false,"why":"<in words>"}. -Probe answers {"ok":true,"langs":[...],"max":N,"profile":tag}.
#
# NOTE: PowerShell names are case-blind -- $W and $w are ONE variable -- so every name below is distinct in letters.
param([string]$Png = '', [string]$Lang = 'en-US', [string]$Scale = '1', [switch]$Probe)
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture

# A JSON string in ASCII. Only reached for text that is not already plain printable ASCII (the caller checks),
# because a PowerShell function call costs more than the whole rest of a word's work.
function Q([string]$str) {
  $sb = New-Object Text.StringBuilder ($str.Length + 16)
  [void]$sb.Append('"')
  foreach ($ch in $str.ToCharArray()) {
    $c = [int]$ch
    if ($c -eq 0x22) { [void]$sb.Append('\"') }
    elseif ($c -eq 0x5c) { [void]$sb.Append('\\') }
    elseif ($c -lt 0x20 -or $c -gt 0x7e) { [void]$sb.Append('\u').Append($c.ToString('x4', $inv)) }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}
# -cmatch, not -match: case-blind matching folds U+212A (the Kelvin sign) into 'k', inside the class, and a
# non-ASCII character would slip out unescaped.
$plain = '^[\x20\x21\x23-\x5b\x5d-\x7e]*$'
function Say([string]$json) { [Console]::Out.Write($json + "`n"); [Console]::Out.Flush() }

# The script a tag names where one language is written two ways (the host's OcrScript): Traditional Chinese is
# not read with the Simplified recognizer, nor Cyrillic Serbian with the Latin one.
function ScriptOf([string]$tag) {
  if ($tag.StartsWith('zh')) { if ($tag -match '-(hant|tw|hk|mo)') { return 'hant' } else { return 'hans' } }
  if ($tag.StartsWith('sr')) { if ($tag -match '-latn') { return 'latn' } else { return 'cyrl' } }
  return ''
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]

  # WinRT's IAsyncOperation<T>, waited on as a .NET Task. The wait is capped so a process whose node has gone
  # away cannot sit forever; node's own timeout (local-ocr.js) is the one that governs.
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(120000)) { throw 'Windows did not answer within two minutes' }
    return $task.Result
  }

  $avail = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
  $maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension

  if ($Probe) {
    $prof = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    $profTag = ''
    if ($prof) { $profTag = $prof.RecognizerLanguage.LanguageTag }
    $tags = @($avail | ForEach-Object { Q $_.LanguageTag })
    Say ('{"ok":true,"langs":[' + ($tags -join ',') + '],"max":' + $maxDim.ToString($inv) + ',"profile":' + (Q $profTag) + '}')
    exit 0
  }

  # THE RECOGNIZER for the language asked for, picked the way the host picks it (OcrPick): that exact tag, else a
  # regional form of it ("en" -> "en-US"), else the same language and script from another region ("en-GB" ->
  # "en-US"). Failing all three, the languages of this user's profile -- and the answer's "lang" says which
  # recognizer read it, so a caller who asked for something else can see that it did not get it.
  $want = $Lang.Trim().ToLowerInvariant()
  if (-not $want) { $want = 'en-us' }
  $primary = $want.Split('-')[0]
  $wantScript = ScriptOf $want
  $exact = $null; $regional = $null; $same = $null
  foreach ($cand in $avail) {
    $ct = $cand.LanguageTag.ToLowerInvariant()
    if ($ct -eq $want) { $exact = $cand; break }
    if (-not $regional -and $ct.StartsWith($want + '-')) { $regional = $cand }
    if (-not $same -and $ct.Split('-')[0] -eq $primary -and (ScriptOf $ct) -eq $wantScript) { $same = $cand }
  }
  $pick = $exact
  if (-not $pick) { $pick = $regional }
  if (-not $pick) { $pick = $same }
  $engine = $null
  if ($pick) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($pick) }
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) {
    if ($avail.Count -eq 0) { throw 'Windows on this machine cannot read text in any language yet (no OCR language is installed)' }
    throw ($Lang + ' is not one of the languages Windows on this machine can read, and none of this user''s languages is')
  }

  # StorageFile -> BitmapDecoder -> SoftwareBitmap. The decoder scales in the same pass it decodes (cubic, as the
  # host's WIC scaler does), so a small crop is read bigger without a second copy of it ever being made.
  $full = [IO.Path]::GetFullPath($Png)
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $picW = [int]$decoder.PixelWidth
    $picH = [int]$decoder.PixelHeight
    $k = 1.0
    if (-not [double]::TryParse($Scale, [Globalization.NumberStyles]::Float, $inv, [ref]$k) -or -not ($k -gt 0 -and $k -le 4)) { $k = 1.0 }
    # Never longer than the recognizer takes (MaxImageDimension, 10000 on Windows 11): a picture over it is read
    # SMALLER, and its boxes still come back in its own pixels. Past it, RecognizeAsync refuses the picture outright
    # ("Image dimensions are too large!").
    if ($maxDim -gt 0) { $k = [Math]::Min($k, [Math]::Min($maxDim / $picW, $maxDim / $picH)) }
    $outW = [int][Math]::Max(1, [Math]::Floor($picW * $k + 0.5))
    $outH = [int][Math]::Max(1, [Math]::Floor($picH * $k + 0.5))
    $xf = New-Object Windows.Graphics.Imaging.BitmapTransform
    if ($outW -ne $picW -or $outH -ne $picH) {
      $xf.ScaledWidth = [uint32]$outW
      $xf.ScaledHeight = [uint32]$outH
      $xf.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
    }
    $bmp = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
                                                  [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $xf,
                                                  [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
                                                  [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  } finally { $stream.Dispose() }

  $clock = [Diagnostics.Stopwatch]::StartNew()
  $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $ms = $clock.ElapsedMilliseconds
  $bmp.Dispose()

  # Back to the PNG's own pixels, each axis by its own ratio (the rounded size is not exactly k), rounded half away
  # from zero as the host rounds them.
  $kx = $outW / $picW
  $ky = $outH / $picH
  $away = [MidpointRounding]::AwayFromZero
  $sb = New-Object Text.StringBuilder 8192
  $tagUsed = $engine.RecognizerLanguage.LanguageTag
  [void]$sb.Append('{"ok":true,"lang":').Append((Q $tagUsed)).Append(',"pw":').Append($picW.ToString($inv)).Append(',"ph":').Append($picH.ToString($inv))
  [void]$sb.Append(',"scale":').Append(([double]$k).ToString('0.####', $inv)).Append(',"max":').Append($maxDim.ToString($inv)).Append(',"ms":').Append($ms.ToString($inv))
  $tilt = $res.TextAngle
  if ($null -ne $tilt) { [void]$sb.Append(',"angle":').Append(([double]$tilt).ToString('0.00', $inv)) }
  [void]$sb.Append(',"lines":[')
  $firstLine = $true
  foreach ($line in $res.Lines) {
    if (-not $firstLine) { [void]$sb.Append(',') }
    $firstLine = $false
    $lt = $line.Text
    if ($lt -cmatch $plain) { [void]$sb.Append('{"t":"').Append($lt).Append('","w":[') } else { [void]$sb.Append('{"t":').Append((Q $lt)).Append(',"w":[') }
    $firstWord = $true
    foreach ($word in $line.Words) {
      if (-not $firstWord) { [void]$sb.Append(',') }
      $firstWord = $false
      $wt = $word.Text
      if ($wt -cmatch $plain) { [void]$sb.Append('["').Append($wt).Append('",') } else { [void]$sb.Append('[').Append((Q $wt)).Append(',') }
      $r = $word.BoundingRect
      [void]$sb.Append(([long][Math]::Round($r.X / $kx, $away)).ToString($inv)).Append(',')
      [void]$sb.Append(([long][Math]::Round($r.Y / $ky, $away)).ToString($inv)).Append(',')
      [void]$sb.Append(([long][Math]::Round($r.Width / $kx, $away)).ToString($inv)).Append(',')
      [void]$sb.Append(([long][Math]::Round($r.Height / $ky, $away)).ToString($inv)).Append(']')
    }
    [void]$sb.Append(']}')
  }
  [void]$sb.Append(']}')
  Say $sb.ToString()
  exit 0
} catch {
  # The innermost reason: a failed WinRT call arrives wrapped in a MethodInvocationException around an
  # AggregateException around the one that says what happened.
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  $msg = ('' + $e.Message).Trim()
  if (-not $msg) { $msg = 'the text could not be read' }
  Say ('{"ok":false,"why":' + (Q $msg) + '}')
  exit 1
}
