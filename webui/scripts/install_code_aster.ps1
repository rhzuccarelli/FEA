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
# The package cache nests files under pkgs\https\conda.anaconda.org\conda-forge\win-64\<package>\,
# which pushes some files (e.g. mfront docs) past the 260-character Windows path limit when the cache
# lives under the user profile. Keep the cache in a short folder at the drive root instead.
$pkgs = if ($env:CONDA_PKGS_DIRS) { $env:CONDA_PKGS_DIRS } else { Join-Path $env:SystemDrive 'fea-pkgs' }
try {
    New-Item -ItemType Directory -Force -Path $pkgs | Out-Null
} catch {
    $pkgs = Join-Path $prefix 'p'
    New-Item -ItemType Directory -Force -Path $pkgs | Out-Null
}
$env:CONDA_PKGS_DIRS = $pkgs
$env:MAMBA_EXTRACT_THREADS = '1'
Write-Host "Package cache: $pkgs"

function Remove-Tree($path) {
    # rd with the \\?\ prefix also removes paths longer than 260 characters.
    if (Test-Path -LiteralPath $path) { cmd /c rd /s /q "\\?\$path" }
}

function Remove-BrokenPackages {
    # An extracted package without info\repodata_record.json is incomplete: delete it and its archive
    # so the next attempt downloads and extracts it again.
    if (-not (Test-Path $pkgs)) { return }
    $archives = Get-ChildItem -Path $pkgs -Recurse -File -Include '*.conda', '*.tar.bz2' -ErrorAction SilentlyContinue
    foreach ($archive in $archives) {
        $dir = $archive.FullName -replace '\.(conda|tar\.bz2)$', ''
        if ((Test-Path -LiteralPath $dir) -and -not (Test-Path -LiteralPath (Join-Path $dir 'info\repodata_record.json'))) {
            Write-Host "Removing incomplete package $($archive.Name)"
            Remove-Tree $dir
            Remove-Item -LiteralPath $archive.FullName -Force
        }
    }
}

# Clean up broken extractions left by earlier versions of this script (cache inside the profile).
$oldPkgs = Join-Path $env:MAMBA_ROOT_PREFIX 'pkgs'
if ($oldPkgs -ne $pkgs) { Remove-Tree $oldPkgs }

Write-Host 'Installing code_aster from conda-forge (about 260 MB, this takes a few minutes)...'
$ok = $false
for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
    if ($attempt -gt 1) { Write-Host "Retrying (attempt $attempt of 3)..." }
    Remove-BrokenPackages
    & $mm create -y -n aster -c conda-forge 'code-aster=*=*nompi*' python=3.12
    $ok = ($LASTEXITCODE -eq 0)
}
if (-not $ok) {
    throw "micromamba failed 3 times. Try excluding $prefix and $pkgs from your antivirus scan, delete $pkgs, and run again."
}

$runAster = Join-Path $env:MAMBA_ROOT_PREFIX 'envs\aster\Library\bin\run_aster.bat'
if (-not (Test-Path $runAster)) { throw "Install finished but $runAster was not found" }
Write-Host ''
Write-Host "code_aster installed: $runAster"
Write-Host "You can delete the download cache $pkgs to free disk space."
Write-Host 'Start the web UI with:  .\scripts\serve.cmd'
