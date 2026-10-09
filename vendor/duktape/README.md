# Duktape 2.7.0

Vendored from https://duktape.org/duktape-2.7.0.tar.xz.

Archive SHA-256: `90f8d2fa8b5567c6899830ddef2c03f3c27960b11aca222fa17aa7ac613c2890`.

`duktape.c`, `duktape.h`, `LICENSE.txt`, and `AUTHORS.rst` are unmodified upstream files.
`duk_config.h` enables the interrupt counter and the `nds_ts_timeout_check()` callback,
and reduces the call stack, native recursion, and compiler recursion limits to
128, 64, and 128 respectively. The same configuration is used for host and DS tests.

The JS heap allocator in `native/runtime.cpp` imposes a separate 512 KiB budget,
including allocation headers. Script initialization gets a 500 ms execution budget;
each game callback gets 100 ms. The interpreter checks the deadline periodically,
so these are watchdog thresholds, not guarantees about frame completion times.

Duktape uses the MIT license; preserve `LICENSE.txt` and `AUTHORS.rst` when copying it.
