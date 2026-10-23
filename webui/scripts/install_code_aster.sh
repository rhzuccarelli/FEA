#!/usr/bin/env bash
# Install code_aster (https://gitlab.com/codeaster/src) from conda-forge into ./.aster
# using a standalone micromamba. Building code_aster from source is also possible, see
# the upstream repository; any install works as long as CODE_ASTER_RUN points at run_aster.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
prefix="${ASTER_PREFIX:-$here/.aster}"
mkdir -p "$prefix"
if [ ! -x "$prefix/micromamba" ]; then
  curl -fsSL -o "$prefix/micromamba" \
    https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-linux-64
  chmod +x "$prefix/micromamba"
fi
export MAMBA_ROOT_PREFIX="$prefix/root"
"$prefix/micromamba" create -y -n aster -c conda-forge "code-aster=*=*nompi*" python=3.12
echo
echo "Installed. Start the UI with:"
echo "  CODE_ASTER_RUN=$MAMBA_ROOT_PREFIX/envs/aster/bin/run_aster ./scripts/serve.sh"
