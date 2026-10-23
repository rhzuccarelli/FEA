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
Write-Host 'Installing code_aster from conda-forge (about 260 MB, this takes a few minutes)...'
& $mm create -y -n aster -c conda-forge 'code-aster=*=*nompi*' python=3.12
if ($LASTEXITCODE -ne 0) { throw "micromamba failed with exit code $LASTEXITCODE" }

$runAster = Join-Path $env:MAMBA_ROOT_PREFIX 'envs\aster\Library\bin\run_aster.bat'
if (-not (Test-Path $runAster)) { throw "Install finished but $runAster was not found" }
Write-Host ''
Write-Host "code_aster installed: $runAster"
Write-Host 'Start the web UI with:  .\scripts\serve.cmd'
