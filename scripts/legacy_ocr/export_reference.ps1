param(
  [string]$Output = "scripts/legacy_ocr/reference.json",
  [switch]$Local
)

$ErrorActionPreference = "Stop"
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$scope = if ($Local) { "--local" } else { "--remote" }

function Read-D1Table([string]$Table) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $raw = & npx wrangler d1 execute jufexk $scope --json --command "SELECT * FROM $Table" 2>$null
  $ErrorActionPreference = $previousPreference
  if ($LASTEXITCODE -ne 0) { throw "读取 D1 表 $Table 失败" }
  $parsed = $raw | ConvertFrom-Json
  return @($parsed[0].results)
}

$snapshot = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  source = if ($Local) { "local D1 read-only snapshot" } else { "remote D1 read-only snapshot" }
  courses = @(Read-D1Table "courses")
  teachers = @(Read-D1Table "teachers")
  course_teachers = @(Read-D1Table "course_teachers")
  offerings = @(Read-D1Table "offerings")
  offering_teachers = @(Read-D1Table "offering_teachers")
}

$parent = Split-Path -Parent $Output
if ($parent) { New-Item -ItemType Directory -Force $parent | Out-Null }
$snapshot | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Output
Write-Host "已生成只读匹配快照：$Output"
