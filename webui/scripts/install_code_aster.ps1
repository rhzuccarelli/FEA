# Install code_aster (https://gitlab.com/codeaster/src) on Windows from conda-forge,
# using a standalone micromamba. Installs into %USERPROFILE%\fea-aster (a short path,
# to stay clear of the Windows 260-character path limit).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$prefix = if ($env:ASTER_PREFIX) { $env:ASTER_PREFIX } else { Join-Path $env:USERPROFILE 'fea-aster' }
New-Item -ItemType Directory -Force -Path $prefix | Out-Null

$mm = Join-Path $prefix 'micromamba.exe'
if (-not (Test-Path $mm)) {
    Write-Host 'Downloading micromamba...'
    Invoke-WebRequest -UseBasicParsing -OutFile $mm `
        -Uri 'https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64'
}

$env:MAMBA_ROOT_PREFIX = Join-Path $prefix 'root'
# Extract one package at a time: parallel extraction on Windows (often with antivirus scanning the
# files) can leave broken entries in the package cache ("Cannot find a valid extracted directory cache").
$env:MAMBA_EXTRACT_THREADS = '1'
$pkgs = Join-Path $env:MAMBA_ROOT_PREFIX 'pkgs'

function Remove-BrokenPackages {
    # A cached package whose extracted folder lacks info\repodata_record.json is incomplete: delete it
    # (folder and archive) so the next attempt downloads and extracts it again.
    if (-not (Test-Path $pkgs)) { return }
    foreach ($dir in Get-ChildItem -Path $pkgs -Directory) {
        $archives = @("$($dir.FullName).conda", "$($dir.FullName).tar.bz2") | Where-Object { Test-Path $_ }
        if ($archives -and -not (Test-Path (Join-Path $dir.FullName 'info\repodata_record.json'))) {
            Write-Host "Removing incomplete package $($dir.Name)"
            Remove-Item -Recurse -Force $dir.FullName
            $archives | ForEach-Object { Remove-Item -Force $_ }
        }
    }
}

Write-Host 'Installing code_aster from conda-forge (about 260 MB, this takes a few minutes)...'
$ok = $false
for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
    if ($attempt -gt 1) { Write-Host "Retrying (attempt $attempt of 3)..." }
    Remove-BrokenPackages
    & $mm create -y -n aster -c conda-forge 'code-aster=*=*nompi*' python=3.12
    $ok = ($LASTEXITCODE -eq 0)
}
if (-not $ok) {
    throw "micromamba failed 3 times. Try excluding $prefix from your antivirus scan, delete $pkgs, and run again."
}

$runAster = Join-Path $env:MAMBA_ROOT_PREFIX 'envs\aster\Library\bin\run_aster.bat'
if (-not (Test-Path $runAster)) { throw "Install finished but $runAster was not found" }
Write-Host ''
Write-Host "code_aster installed: $runAster"
Write-Host 'Start the web UI with:  .\scripts\serve.cmd'
