$ErrorActionPreference = 'Stop'
Set-Location 'D:\大模型18期\AI知乎大模型应用专家-18期\16-项目实战：企业知识库\RAG-next'
Get-Content '.env' | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $idx = $_.IndexOf('=')
  if ($idx -gt 0) {
    $name = $_.Substring(0, $idx).Trim()
    $value = $_.Substring($idx + 1).Trim()
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
pnpm --filter @rag-next/api dev