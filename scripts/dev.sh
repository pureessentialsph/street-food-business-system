#!/usr/bin/env bash
# Node lives in ~/.local/node and is not on the system PATH on this machine.
set -euo pipefail
export PATH="$HOME/.local/node/bin:$PATH"
cd "$(dirname "$0")/.."
exec pnpm dev
