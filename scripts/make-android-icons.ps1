# Regenerate the Android adaptive-launcher icon layers from the brand artwork.
#
# Why this exists: the launcher icon is a *masked* composite. Android draws the
# background layer, then the foreground layer, then cuts the pair to the shape
# the launcher uses (circle / squircle / rounded square). Only the central 66dp
# of the 108dp canvas is guaranteed to survive that cut -- the outer 21dp on every
# side is bleed.
#
# The 2.6.10 art drop pasted the full-bleed badge straight into
# ic_launcher_foreground.png, ring touching all four edges of the 108dp canvas.
# Every launcher therefore sliced the ring off and zoomed the microscope into the
# crop box -- the "app logo looks wrong" report on the Play-store update dialog
# was that clipping, not a broken file.
#
# This script keeps the artwork whole by scaling the badge into the safe zone
# (64dp of the 108dp canvas) on a transparent field, so no mask can reach an edge
# of the drawing. The white behind it comes from @color/ic_launcher_background,
# which the adaptive XML already declares.
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/make-android-icons.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/make-android-icons.ps1 -VerifyOnly
param(
    [string]$Source = 'public/android-chrome-512x512.png',
    [string]$ResDir = 'android/app/src/main/res',
    # Badge diameter as a fraction of the 108dp adaptive canvas. 64dp / 108dp;
    # the guaranteed-visible disc is 66dp, so this leaves ~1dp of margin.
    [double]$BadgeFraction = (64 / 108),
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = [IO.Path]::GetFullPath((Join-Path $repoRoot $Source))
$resPath = [IO.Path]::GetFullPath((Join-Path $repoRoot $ResDir))
if (-not (Test-Path $sourcePath)) { throw "source artwork not found: $sourcePath" }

# density bucket -> scale factor applied to the 108dp / 64dp dp-sizes.
$densities = @(
    @{ Name = 'mdpi'; Scale = 1.0 },
    @{ Name = 'hdpi'; Scale = 1.5 },
    @{ Name = 'xhdpi'; Scale = 2.0 },
    @{ Name = 'xxhdpi'; Scale = 3.0 },
    @{ Name = 'xxxhdpi'; Scale = 4.0 }
)

function Get-AlphaBounds([System.Drawing.Bitmap]$bmp) {
    $minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $bmp.Height; $y++) {
        for ($x = 0; $x -lt $bmp.Width; $x++) {
            if ($bmp.GetPixel($x, $y).A -gt 10) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    return @{ MinX = $minX; MinY = $minY; MaxX = $maxX; MaxY = $maxY }
}

# NOTE: do not name this $source -- PowerShell parameter variables keep their
# [string] type constraint, so assigning a Bitmap to $Source silently stringifies
# it and the Dispose below throws.
$srcBmp = [System.Drawing.Bitmap]::new($sourcePath)
$failures = 0

try {
    foreach ($d in $densities) {
        $canvas = [int][math]::Round(108 * $d.Scale)
        $badge = [int][math]::Round($canvas * $BadgeFraction)
        $target = Join-Path $resPath "mipmap-$($d.Name)\ic_launcher_foreground.png"
        if (-not (Test-Path (Split-Path $target))) { throw "missing resource folder: $(Split-Path $target)" }

        if ($VerifyOnly) {
            $existing = [System.Drawing.Bitmap]::new($target)
            try {
                $b = Get-AlphaBounds $existing
                $margin = [math]::Min($b.MinX, $b.MinY)
                $expected = [int][math]::Floor(($canvas - [int][math]::Round($canvas * $BadgeFraction)) / 2) - 2
                $ok = ($existing.Width -eq $canvas) -and ($existing.Height -eq $canvas) -and ($margin -ge $expected)
                if (-not $ok) { $script:failures++ }
                '{0} mipmap-{1}: {2}x{3} inset={4} (need >= {5}) -> {6}' -f `
                    ($(if ($ok) { '  ok' } else { 'FAIL' })), $d.Name, $existing.Width, $existing.Height, $margin, $expected, (Split-Path $target -Leaf)
            }
            finally { $existing.Dispose() }
            continue
        }

        $bmp = [System.Drawing.Bitmap]::new($canvas, $canvas, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $g.Clear([System.Drawing.Color]::Transparent)
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $offset = [int][math]::Round(($canvas - $badge) / 2)
                # The source badge is inscribed in its own square, so drawing the
                # whole square at `badge` px places the ring at exactly that diameter.
                $g.DrawImage($srcBmp, (New-Object System.Drawing.RectangleF($offset, $offset, $badge, $badge)))
            }
            finally { $g.Dispose() }
            $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $bmp.Dispose() }
        Write-Output "wrote mipmap-$($d.Name)/ic_launcher_foreground.png  ${canvas}x${canvas} (badge ${badge}px)"
    }
}
finally { $srcBmp.Dispose() }

if ($VerifyOnly -and $failures -gt 0) {
    throw "$failures launcher layer(s) still fill the adaptive canvas -- run without -VerifyOnly."
}
if (-not $VerifyOnly) {
    Write-Output ''
    Write-Output 'Re-run with -VerifyOnly after a rebuild, and sync into the APK with: npm run sync:android'
}
