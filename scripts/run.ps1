# Baut Oberfläche und Server und startet Lumantic auf http://127.0.0.1:8080
#   .\scripts\run.ps1          normaler Start
#   .\scripts\run.ps1 -Seed    Beispiel-Goldlayer neu erzeugen
param([switch]$Seed)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not $env:LUMANTIC_DUCKDB) {
    $cmd = Get-Command duckdb -ErrorAction SilentlyContinue
    if ($cmd) {
        $env:LUMANTIC_DUCKDB = $cmd.Source
    } else {
        $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter duckdb.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $found) { throw "DuckDB CLI fehlt. Installieren mit: winget install DuckDB.cli" }
        $env:LUMANTIC_DUCKDB = $found.FullName
    }
}

if ($Seed -or -not (Test-Path "goldlayer\gold.duckdb")) {
    go run ./cmd/seed -duckdb $env:LUMANTIC_DUCKDB
}

Push-Location web
if (-not (Test-Path node_modules)) { npm install --no-fund --no-audit }
npm run build
Pop-Location

go build -o bin/lumantic.exe ./cmd/lumantic

$config = if ($env:LUMANTIC_CONFIG) { $env:LUMANTIC_CONFIG } else { "config\lumantic.json" }
if (Test-Path $config) {
    Write-Host "Einstellungen: $config"
} else {
    Write-Host "Einstellungen: $config (entsteht beim ersten Speichern in der App, Vorlage: config\lumantic.example.json)"
}
& .\bin\lumantic.exe
