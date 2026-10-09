#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

# The checked-in source includes Duktape; the container needs no network access.
BLOCKSDS_IMAGE="${NDS_TS_BLOCKSDS_IMAGE:-skylyrac/blocksds@sha256:779f6193d1030c62e60d1f0f39c3e32cf4045c0bd224a45c0ceadf9d9ab01a51}"
node --import tsx tools/build-script.ts "$@"
docker run --rm --network=none -v "$PWD":/work -w /work "$BLOCKSDS_IMAGE" make -j2
printf '\nROM: %s/build/nds-ts-demo.nds\n' "$PWD"
