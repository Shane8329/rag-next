$paths = @(
  'D:\rag-cy\postgres-data',
  'D:\rag-cy\storage',
  'D:\rag-cy\storage\uploads',
  'D:\rag-cy\storage\imports',
  'D:\rag-cy\storage\cache'
)

foreach ($path in $paths) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

Write-Host 'Storage directories prepared on D drive.'
