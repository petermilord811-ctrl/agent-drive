#!/usr/bin/env node
// @tool crop part of a screenshot (crop.py's arguments) -- works with NO Python: Windows' own System.Drawing does it
// @run  node vision/crop.js shot.png result.jpg 440,200,1480,860 0.6
//
// crop.py needs Python + Pillow. A driver PC without them (live 65912, 2026-11-18: only the Microsoft Store
// "python" stub, which prints "Python was not found" and exits 9009) silently produced no proof picture --
// fast.js spawned crop.py, ignored the failure, and finished with a missing file. This tries crop.py first
// (python, py, python3), and when none of them makes the file, on Windows does the same crop with
// System.Drawing through PowerShell. A .jpg is shrunk until it fits a chat picture (~44 KB), like crop.py.
// Prints `saved [w, h] <bytes> bytes via <how>`; exits 1 when nothing could make the file.
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const CHAT_CAP = 44000;   // bytes: a chat picture rides as a data: URL capped at 60000 chars (base64 adds 1/3)

function viaPython(src, dst, box, scale) {
  const script = path.join(__dirname, 'crop.py');
  for (const exe of ['python', 'py', 'python3']) {
    try { fs.rmSync(dst, { force: true }); } catch (_) {}
    const r = spawnSync(exe, ['-I', script, src, dst, box, String(scale)], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && fs.existsSync(dst) && fs.statSync(dst).size > 0) return 'python (' + exe + ')';
  }
  return '';
}

// Values reach PowerShell through the environment, never spliced into the script text.
const PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$b = $env:CROP_BOX.Split(',') | ForEach-Object { [int]$_ }
$scale = [double]$env:CROP_SCALE
$src = [System.Drawing.Image]::FromFile($env:CROP_SRC)
try {
  $rect = New-Object System.Drawing.Rectangle $b[0], $b[1], ($b[2] - $b[0]), ($b[3] - $b[1])
  $jpg = $env:CROP_DST -match '\.(jpe?g)$'
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
  $q = 80
  while ($true) {
    $w = [Math]::Max(1, [int]($rect.Width * $scale)); $h = [Math]::Max(1, [int]($rect.Height * $scale))
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $rect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    if ($jpg) {
      $p = New-Object System.Drawing.Imaging.EncoderParameters 1
      $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$q)
      $bmp.Save($env:CROP_DST, $enc, $p)
    } else {
      $bmp.Save($env:CROP_DST, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $bmp.Dispose()
    $size = (Get-Item -LiteralPath $env:CROP_DST).Length
    if (-not $jpg -or $size -le [int]$env:CROP_CAP -or $w -lt 200) { break }
    if ($q -gt 50) { $q -= 15 } else { $scale *= 0.85 }
  }
  Write-Output "$w $h $size"
} finally { $src.Dispose() }
`;

function viaWindows(src, dst, box, scale) {
  if (process.platform !== 'win32') return '';
  const env = Object.assign({}, process.env, {
    CROP_SRC: path.resolve(src), CROP_DST: path.resolve(dst), CROP_BOX: box, CROP_SCALE: String(scale), CROP_CAP: String(CHAT_CAP),
  });
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { encoding: 'utf8', env, windowsHide: true });
  return (r.status === 0 && fs.existsSync(dst)) ? 'System.Drawing' : '';
}

function crop(src, dst, box, scale) {
  if (!/^\d+,\d+,\d+,\d+$/.test(String(box))) throw new Error('box must be x0,y0,x1,y1');
  const [x0, y0, x1, y1] = box.split(',').map(Number);
  if (x1 <= x0 || y1 <= y0) throw new Error('box must have x1 > x0 and y1 > y0');
  if (!(scale > 0)) throw new Error('scale must be a number above 0');
  if (!fs.existsSync(src)) throw new Error('no such picture: ' + src);
  const how = viaPython(src, dst, box, scale) || viaWindows(src, dst, box, scale);
  if (!how) return { ok: false, why: 'no crop.py (Python + Pillow) and no Windows System.Drawing fallback worked' };
  return { ok: true, how, bytes: fs.statSync(dst).size };
}

module.exports = { crop };

if (require.main === module) {
  const [src, dst, box, scale] = process.argv.slice(2);
  if (!src || !dst || !box) { console.error('usage: node vision/crop.js <src.png> <dst.jpg|.png> <x0,y0,x1,y1> [scale=1]'); process.exit(2); }
  try {
    const r = crop(src, dst, box, scale === undefined ? 1 : parseFloat(scale));
    if (!r.ok) { console.error('[x] ' + r.why); process.exit(1); }
    console.log('saved ' + dst + ' ' + r.bytes + ' bytes via ' + r.how);
  } catch (e) { console.error('[x] ' + e.message); process.exit(2); }
}
