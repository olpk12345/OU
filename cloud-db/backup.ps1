param(
    [string]$OutputDir = "./backups"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

docker compose exec -T postgres pg_dump `
    --clean --if-exists --no-owner `
    --username $env:POSTGRES_USER `
    --dbname $env:POSTGRES_DB > "$OutputDir/personal-db-$stamp.sql"

Write-Host "Backup created: $OutputDir/personal-db-$stamp.sql"
