# run_omr.ps1 — прогін PDF через Audiveris у batch-режимі, експорт MusicXML
# Використання:  .\run_omr.ps1 -Input "шлях\до\нот.pdf" [-OutDir "шлях\вихід"]
param(
    [Parameter(Mandatory = $true)] [string]$Input,
    [string]$OutDir = "F:\PDF2MIDI\omr_out"
)

$audiveris = 'C:\Program Files\Audiveris\Audiveris.exe'
if (-not (Test-Path $audiveris)) { throw "Audiveris не знайдено: $audiveris" }
if (-not (Test-Path $Input))     { throw "Вхідний файл не знайдено: $Input" }
if (-not (Test-Path $OutDir))    { New-Item -ItemType Directory -Force $OutDir | Out-Null }

Write-Host "OMR -> $Input" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# -batch: без GUI; -transcribe: повний розпір; -export: MusicXML (.mxl); -output: тека
& $audiveris -batch -transcribe -export -output $OutDir -- $Input

$sw.Stop()
Write-Host ("Готово за {0:N1} c. Вихід у: {1}" -f $sw.Elapsed.TotalSeconds, $OutDir) -ForegroundColor Green
Get-ChildItem -Recurse $OutDir -Include *.mxl, *.xml, *.log | Select-Object FullName, Length, LastWriteTime
