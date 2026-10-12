#!/usr/bin/env bash
# File Description: Installs the repository's Aideos dispatcher as the global `aideos` command.
# Inputs and outputs: repository checkout and HOME -> ~/.local/bin/aideos symlink to bin/aideos.
# Used by: repository maintainers setting up the global command from README.md.

set -euo pipefail

# Resolves the repository root from this script's location.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
bin_dir="${HOME}/.local/bin"
target="${bin_dir}/aideos"

mkdir -p "$bin_dir"
ln -sfn "${repo_root}/bin/aideos" "$target"
printf 'Installed %s -> %s\n' "$target" "${repo_root}/bin/aideos"
