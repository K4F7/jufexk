param(
  [Parameter(Mandatory = $true)][string]$Hwnd,
  [Parameter(Mandatory = $true)][string]$OutPng,
  [int]$Width = 2560,
  [int]$Height = 1440
)

Add-Type -AssemblyName System.Drawing
if (-not ("JufexkPrintWindow" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JufexkPrintWindow {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
}

$handle = [IntPtr][int64]$Hwnd
[void][JufexkPrintWindow]::ShowWindow($handle, 9)
[void][JufexkPrintWindow]::SetWindowPos($handle, [IntPtr]::new(-1), 0, 0, $Width, $Height, 0x0040)
[void][JufexkPrintWindow]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 250

$rect = New-Object JufexkPrintWindow+RECT
[void][JufexkPrintWindow]::GetWindowRect($handle, [ref]$rect)
$windowWidth = $rect.Right - $rect.Left
$windowHeight = $rect.Bottom - $rect.Top
if ($windowWidth -lt 800 -or $windowHeight -lt 600) {
  throw "capture window is not usable: ${windowWidth}x${windowHeight}"
}

$bitmap = New-Object System.Drawing.Bitmap $windowWidth, $windowHeight
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$printed = $false
try {
  $printed = [JufexkPrintWindow]::PrintWindow($handle, $hdc, 2)
} finally {
  $graphics.ReleaseHdc($hdc)
}
if (-not $printed) {
  $graphics.Dispose()
  $bitmap.Dispose()
  throw "PrintWindow failed; refusing CopyFromScreen fallback"
}

$directory = Split-Path -Parent $OutPng
if ($directory) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
$bitmap.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

[ordered]@{
  method = "print_window"
  path = $OutPng
  width = $windowWidth
  height = $windowHeight
} | ConvertTo-Json -Compress
