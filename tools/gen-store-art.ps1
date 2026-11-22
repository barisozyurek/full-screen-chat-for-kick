# Store listing promo tiles for Full-Screen Chat for Kick.
# Requires Windows PowerShell / PowerShell 7 with System.Drawing.
# Usage: powershell -ExecutionPolicy Bypass -File tools\gen-store-art.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$storeDir = Join-Path $root 'store'
New-Item -ItemType Directory -Path $storeDir -Force | Out-Null

$bg = [System.Drawing.Color]::FromArgb(13, 14, 17)
$text = [System.Drawing.Color]::FromArgb(231, 234, 228)
$muted = [System.Drawing.Color]::FromArgb(141, 148, 139)
$accent = [System.Drawing.Color]::FromArgb(83, 252, 24)

$icon = [System.Drawing.Image]::FromFile((Join-Path $root 'icons\icon128.png'))

function New-Tile([int]$width, [int]$height) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear($bg)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Tile($tile, [string]$name) {
    $path = Join-Path $storeDir $name
    $tile.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $tile.Graphics.Dispose()
    $tile.Bitmap.Dispose()
    $bytes = (Get-Item $path).Length
    Write-Output "store/$name  $bytes bytes"
}

# 1400 x 560 large promo tile
$large = New-Tile 1400 560
$large.Graphics.FillRectangle((New-Object System.Drawing.SolidBrush($accent)), 0, 0, 8, 560)
$large.Graphics.DrawImage($icon, 92, 184, 192, 192)

$titleFont = New-Object System.Drawing.Font('Segoe UI', 48, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$subFont = New-Object System.Drawing.Font('Segoe UI', 25, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$large.Graphics.DrawString('Full-Screen Chat for Kick', $titleFont, (New-Object System.Drawing.SolidBrush($text)), 336, 220)
$large.Graphics.DrawString('Kick chat over full-screen streams and replays.', $subFont, (New-Object System.Drawing.SolidBrush($muted)), 338, 292)
$titleFont.Dispose()
$subFont.Dispose()
Save-Tile $large 'promo-large-1400x560.png'

# 440 x 280 small promo tile
$small = New-Tile 440 280
$small.Graphics.FillRectangle((New-Object System.Drawing.SolidBrush($accent)), 0, 0, 6, 280)
$small.Graphics.DrawImage($icon, 32, 92, 96, 96)

$smallTitle = New-Object System.Drawing.Font('Segoe UI', 21, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$smallSub = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$small.Graphics.DrawString('Full-Screen Chat', $smallTitle, (New-Object System.Drawing.SolidBrush($text)), 150, 99)
$small.Graphics.DrawString('for Kick', $smallTitle, (New-Object System.Drawing.SolidBrush($text)), 150, 127)
$small.Graphics.DrawString('Chat over full-screen streams', $smallSub, (New-Object System.Drawing.SolidBrush($muted)), 151, 166)
$smallTitle.Dispose()
$smallSub.Dispose()
Save-Tile $small 'promo-small-440x280.png'

$icon.Dispose()
