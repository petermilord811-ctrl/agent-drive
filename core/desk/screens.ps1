# screens.ps1 -- the monitors on Windows, for windows.ps1 (desk.js ships it with that op only).
$global:DNATS += ';user32 MonitorFromPoint P LU;shcore GetDpiForMonitor I PIPP'

# Every monitor, in physical pixels (the awareness DDpi set comes before WinForms reads them), with its work
# area (the screen minus the taskbar) and its effective dpi (96 = 100%). MonitorFromPoint takes a POINT by
# value, which is 8 bytes and travels as an int64: x in the low half, y in the high.
function DMonitors {
    Add-Type -AssemblyName System.Windows.Forms
    $r = New-Object Collections.ArrayList
    foreach ($s in [Windows.Forms.Screen]::AllScreens) {
        $b = $s.Bounds; $w = $s.WorkingArea; $dpi = $null
        try {
            $x = [int64]($b.X + [int]($b.Width / 2)); $y = [int64]($b.Y + [int]($b.Height / 2))
            $hm = $API::MonitorFromPoint((($y -shl 32) -bor ($x -band 0xFFFFFFFFL)), 2)
            if ($API::GetDpiForMonitor($hm, 0, $DBUF, [IntPtr]::Add($DBUF, 4)) -eq 0) { $dpi = $MR::ReadInt32($DBUF, 0) }
        } catch {}
        [void]$r.Add([ordered]@{ name = $s.DeviceName; rect = @($b.X, $b.Y, $b.Width, $b.Height); work = @($w.X, $w.Y, $w.Width, $w.Height); primary = [bool]$s.Primary; dpi = $dpi })
    }
    , $r
}
