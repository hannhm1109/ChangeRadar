# Render the actual compiled demo output as a README terminal preview.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$lines = @(& node (Join-Path $PSScriptRoot 'demo.mjs') --no-color)
$status = $LASTEXITCODE
if ($status -ne 1 -or $lines.Count -lt 10) {
    throw 'Expected a complete demo report with exit code 1. Run npm run build first.'
}
$font = New-Object System.Drawing.Font('Consolas', 16, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$probe = New-Object System.Drawing.Bitmap(1, 1)
$measure = [System.Drawing.Graphics]::FromImage($probe)
$width = 960
foreach ($line in $lines) {
    $width = [Math]::Max($width, [Math]::Ceiling($measure.MeasureString([string]$line, $font).Width) + 80)
}
$measure.Dispose()
$probe.Dispose()
$lineHeight = 25
$height = 110 + ($lines.Count * $lineHeight) + 70
$bitmap = New-Object System.Drawing.Bitmap([int]$width, [int]$height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#18191b'))
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$brushes = @{}
foreach ($entry in @{ text = '#e9e9ed'; muted = '#a8aab2'; HIGH = '#ff8a8a'; MEDIUM = '#eccc7f'; LOW = '#98d3ae' }.GetEnumerator()) {
    $brushes[$entry.Key] = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($entry.Value))
}
try {
    $graphics.DrawString('ChangeRadar / demo', $font, $brushes.muted, 32, 22)
    $graphics.DrawString('$ npm run demo', $font, $brushes.text, 32, 60)
    $y = 110
    foreach ($line in $lines) {
        $brush = $brushes.text
        if (@('HIGH', 'MEDIUM', 'LOW') -contains $line) { $brush = $brushes[$line] }
        $graphics.DrawString([string]$line, $font, $brush, 32, $y)
        $y += $lineHeight
    }
    $graphics.DrawString('Exit 1: HIGH finding detected. Review required; not a tool error.', $font, $brushes.muted, 32, $y + 16)
    $docs = Join-Path $root 'docs'
    [void][System.IO.Directory]::CreateDirectory($docs)
    $target = Join-Path $docs 'demo.png'
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Rendered demo preview: $target ($width x $height)"
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    $font.Dispose()
    foreach ($brush in $brushes.Values) { $brush.Dispose() }
}
