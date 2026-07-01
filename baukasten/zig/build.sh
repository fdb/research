#!/bin/sh
# Builds the baukasten engine to WASM. Requires the ziglang pip package
# (pip install ziglang) or a system zig >= 0.16.
#
# The compiled engine.wasm is committed to the repo so the site stays a
# no-build static deploy; run this only when engine.zig changes.
set -e
cd "$(dirname "$0")"
ZIG="${ZIG:-python3 -m ziglang}"
$ZIG build-exe engine.zig \
  -target wasm32-freestanding \
  -O ReleaseFast \
  -fstrip \
  -fno-entry \
  --export=cmd_ptr \
  --export=tex_eval \
  --export=mesh_eval \
  -femit-bin=../engine.wasm
rm -f engine.wasm.o
ls -la ../engine.wasm
