# 홈 화면 아이콘 PNG 생성기
#
# 왜 PNG가 따로 필요한가:
#   iOS Safari는 apple-touch-icon에 SVG를 받지 않는다. SVG만 두면 홈 화면
#   아이콘이 로고가 아니라 페이지 스크린샷으로 나온다. 그래서 PNG가 필요하다.
#
# 왜 스크립트로 그리는가:
#   SVG를 변환하는 도구를 이 환경에서 기대할 수 없다. 도형이 단순하니
#   좌표를 그대로 옮겨 그린다. assets/icon.svg 를 고치면 여기도 같이 고칠 것.
#
# 사용: powershell -ExecutionPolicy Bypass -File make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root 'assets'

# icon.svg 의 512 좌표계를 그대로 쓴다.
$BASE = 512.0

function New-RoundedPath {
    param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-Icon {
    param([int]$size, [string]$path, [single]$inset)

    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $s = $size / $BASE

    # 배경은 반드시 불투명하게 채운다. iOS는 투명 픽셀을 검게 깔지 않고
    # 그대로 두어 아이콘이 깨져 보인다.
    $ebony = [System.Drawing.Color]::FromArgb(255, 13, 13, 13)
    $g.Clear($ebony)

    $bgBrush = New-Object System.Drawing.SolidBrush($ebony)
    $bgPath = New-RoundedPath 0 0 $size $size (112 * $s)
    $g.FillPath($bgBrush, $bgPath)

    # 아트워크를 안쪽으로 밀어 넣는 여백 비율 (마스커블용)
    $scale = $s * (1.0 - 2.0 * $inset)
    $off = $size * $inset

    # 흰 건반 네 개 — 오른쪽으로 갈수록 옅어진다
    $keys = @(
        @{ x = 96;  a = 255 },
        @{ x = 164; a = 209 },
        @{ x = 232; a = 163 },
        @{ x = 300; a = 117 }
    )
    foreach ($k in $keys) {
        $br = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($k.a, 255, 255, 255))
        $p = New-RoundedPath ($off + $k.x * $scale) ($off + 112 * $scale) (52 * $scale) (288 * $scale) (12 * $scale)
        $g.FillPath($br, $p)
        $p.Dispose(); $br.Dispose()
    }

    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))

    # 음표 머리 — 원본이 -18도 기울어 있다
    $st = $g.Save()
    $cx = $off + 374 * $scale
    $cy = $off + 356 * $scale
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform(-18)
    $g.FillEllipse($white, -42 * $scale, -33 * $scale, 84 * $scale, 66 * $scale)
    $g.Restore($st)

    # 음표 기둥
    $stem = New-RoundedPath ($off + 404 * $scale) ($off + 140 * $scale) (18 * $scale) (212 * $scale) (9 * $scale)
    $g.FillPath($white, $stem)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

    $stem.Dispose(); $white.Dispose(); $bgPath.Dispose(); $bgBrush.Dispose()
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("  {0}  ({1}x{1})" -f (Split-Path -Leaf $path), $size)
}

Write-Output 'PNG 아이콘 생성:'
New-Icon 180 (Join-Path $outDir 'apple-touch-icon-180.png') 0.0
New-Icon 192 (Join-Path $outDir 'icon-192.png') 0.0
New-Icon 512 (Join-Path $outDir 'icon-512.png') 0.0
# 마스커블은 안전 영역(가운데 80%) 안에 아트워크를 넣어야 잘리지 않는다
New-Icon 512 (Join-Path $outDir 'icon-512-maskable.png') 0.1
Write-Output '완료.'
