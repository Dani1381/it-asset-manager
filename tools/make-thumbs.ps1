# Creates small JPEG thumbnails (uploads/_thumbs) for photos that do not have one yet.
# Used by the Excel export and the photo lists; runs on demand from server.js (Windows only).
param([string]$Uploads, [int]$Size = 240)
Add-Type -AssemblyName System.Drawing
$out = Join-Path $Uploads '_thumbs'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]80)
$made = 0
Get-ChildItem -Path $Uploads -File | Where-Object { $_.Extension -match '^\.(jpe?g|png|webp)$' } | ForEach-Object {
  $dest = Join-Path $out ($_.BaseName + '.jpg')
  if (Test-Path $dest) { return }
  try {
    $img = [System.Drawing.Image]::FromFile($_.FullName)
    # respect the phone's EXIF rotation
    $o = $img.PropertyIdList -contains 0x0112
    if ($o) {
      $v = $img.GetPropertyItem(0x0112).Value[0]
      switch ($v) { 3 { $img.RotateFlip('Rotate180FlipNone') } 6 { $img.RotateFlip('Rotate90FlipNone') } 8 { $img.RotateFlip('Rotate270FlipNone') } }
    }
    $k = [Math]::Min(1.0, $Size / [Math]::Max($img.Width, $img.Height))
    $w = [int][Math]::Max(1, $img.Width * $k); $h = [int][Math]::Max(1, $img.Height * $k)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawImage($img, 0, 0, $w, $h)
    $bmp.Save($dest, $codec, $params)
    $g.Dispose(); $bmp.Dispose(); $img.Dispose()
    $made++
  } catch { if ($img) { $img.Dispose() } }
}
Write-Output "made=$made"
