#!/bin/sh
# SPDX-License-Identifier: MIT
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$package_dir"

# Node's loader avoids tsx CLI's unnecessary local IPC server in sandboxes.
# Dependencies must already be installed; this check never installs packages.
node --import tsx tools/build-script.ts

test_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/nds-ts-native.XXXXXX")
trap 'rm -rf "$test_build_dir"' EXIT HUP INT TERM

sanitizer_flags=""
if [ "${SANITIZE:-1}" = "1" ]; then
    sanitizer_flags="-fsanitize=address,undefined -fno-omit-frame-pointer"
fi

"${CC:-cc}" -std=c99 -O1 -g -Wno-deprecated-declarations $sanitizer_flags \
    -Ivendor/duktape -c vendor/duktape/duktape.c \
    -o "$test_build_dir/duktape.o"
"${CXX:-c++}" -std=c++17 -O1 -g -Wall -Wextra -Werror $sanitizer_flags \
    -Ivendor/duktape -Inative -Igen \
    native/runtime.cpp native/graphics.cpp tests/runtime.cpp \
    "$test_build_dir/duktape.o" -lm -o "$test_build_dir/runtime-test"

# Bound the whole subprocess as well as testing the engine's own watchdog.
node --input-type=module - "$test_build_dir/runtime-test" "$package_dir/gen/game.js" <<'EOF'
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.argv[2], [process.argv[3]], {
  stdio: 'inherit',
  timeout: 20000,
});
if (result.error) console.error(`Native test process failed: ${result.error.message}`);
if (result.signal) console.error(`Native test process terminated by ${result.signal}`);
process.exit(result.status ?? 1);
EOF
