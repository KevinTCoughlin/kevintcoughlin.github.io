---
published: 2026-11-25T17:20:00Z
tags:
  - homelab
  - minecraft
  - performance
---

# Don't flip the JVM flag, measure it on a copy of the world

JDK 25 can shrink object headers with `-XX:+UseCompactObjectHeaders`. On the Paper server that can cut the heap, and it can also move GC pauses and tick time. I built a harness that copies the world twice and compares the two runs. I have not measured the world yet. The numbers come later.

## The flag stays off

[`cdb170b`](https://github.com/KevinTCoughlin/minecraft-server/commit/cdb170bb10ba08c3f212321bf0bec4428f619d6d) made `scripts/jvm-opts.sh` the flag list for a host start and for the container image. With no container memory limit, that script boots on a safe default heap, about a quarter of host memory clamped between 1G and 4G, or 2G when host memory cannot be read. Compact headers stay out of that list. They sit outside [Aikar's flags](https://docs.papermc.io/paper/aikars-flags).

[minecraft-server#133](https://github.com/KevinTCoughlin/minecraft-server/pull/133) ([`b15e353`](https://github.com/KevinTCoughlin/minecraft-server/commit/b15e3533f59f6ea24fba6a7f915c09979e3374a0)) adds the opt-in on top of that script, and the harness that has to pass before the flag is turned on for a server people play. `scripts/jvm-opts.sh` appends `-XX:+UseCompactObjectHeaders` only when `COMPACT_OBJECT_HEADERS` is `true`, `1`, `yes`, or `on`. Any other value is an error. Unset, `false`, `0`, `no`, and `off` leave it off. G1 already passes `-XX:+UnlockExperimentalVMOptions`. ZGC does not, so the opt-in adds that unlock only for ZGC. JDK 25 still treats the flag as experimental.

Compose `JVM_XX_OPTS` leaves the flag out. The custom image uses `scripts/jvm-opts.sh`, so the same variable is the opt-in there. The live server keeps the current flags. An `ACCEPT` from the harness is evidence for a follow-up. It leaves the default off.

## Two copies, one difference

`scripts/measure-compact-headers.sh` copies the world with `cp -a`, once into `baseline/world` and once into `compact/world`, both from the original. The second run starts from the same files as the first. The server directory is always one of those copies, and `server.properties` sets `level-name=world` there.

Both runs call `scripts/jvm-opts.sh` with `MEMORY_MODE=fixed` and the same heap, GC, and dump settings. The compact run is the only one with `COMPACT_OBJECT_HEADERS=true`. Before Java starts, the script stops if the baseline flags mention `UseCompactObjectHeaders`, and it stops if the compact flags are missing the line `-XX:+UseCompactObjectHeaders`. Each run adds the same `-Xlog:gc*` options, with a different log path. `HeapDumpPath` differs by run directory.

Defaults match a host start: G1, `-Xms4G -Xmx4G`, view distance 10, simulation distance 10. The measurement server listens on `127.0.0.1:25566`, with an empty plugins directory, peaceful difficulty, mob spawning off, and `pause-when-empty-seconds=-1`. After Paper prints `Done`, it waits 120 seconds, then samples for 180 seconds. The runs are sequential, so one heap is touched at a time, and `AlwaysPreTouch` touches that whole heap. Leave disk for two full copies.

```bash
./scripts/stop.sh
./scripts/measure-compact-headers.sh --world server/parkour-spiral
```

The argument is the world directory, the folder that contains `level.dat`. `server/parkour-spiral` is the usual map. Java 25 and `server/paper.jar` have to be on the host. Paper 26.3 will not start on an older JDK.

## What it refuses

A copy taken while the world is open, or a server whose level is the original, is not a before and after. The harness checks the copy after `cp` and again immediately before Java starts. It refuses when:

- the work directory is the original world, sits inside it, or contains it, including a symlink whose target is the world
- the work directory is the live `server/` directory
- the copy's `level.dat` is missing, is a symlink, or is the same inode as the original
- any symlink inside the copy points at the original world
- any hardlink inside the copy is a file in the original world
- Paper is still running from `server/server.pid` and the world sits inside that server directory
- the original `level.dat` checksum changes during the two runs

A `session.lock` in the original world prints a warning. The same check is available for a copy made by hand:

```bash
./scripts/measure-compact-headers.sh check-copy \
    --source server/parkour-spiral \
    --dest /tmp/parkour-copy
```

Exit 1 means the harness refused to run, or a server did not finish. Exit 0 means a comparison was written, including a rejection.

## What a passing run has to show

After warmup the harness samples used heap with `jcmd <pid> GC.heap_info`, falling back to `jstat -gc`, every 15 seconds through the soak. Pauses before the warmup mark are ignored, so startup GC stays out of the comparison. Then it sends `tps` and `mspt` on the console and stops the server.

The 1 minute TPS figure is the one that counts. A `*` from Paper means that window is not full yet, and the verdict is inconclusive. MSPT is the 1 minute average. TPS is capped at 20, so a slower tick can sit behind a perfect TPS number. MSPT is part of "TPS no worse".

The summary lands in `.compact-headers-measure/<timestamp>/summary.md`. `latest` points at that directory when the default work directory is used. `verdict.txt` is one word: `ACCEPT`, `REJECT`, or `INCONCLUSIVE`.

Enable the flag in `scripts/jvm-opts.sh` and in Compose `JVM_XX_OPTS` only when the copy shows a smaller heap and pauses and TPS are no worse:

- **Heap.** The first sample after warmup and the high-water mark during the soak are both strictly lower with the flag.
- **GC pauses.** Soak max and p99 are less than or equal to the baseline. Zero pauses on both sides counts as equal. G1's target in the current flags is `-XX:MaxGCPauseMillis=200`.
- **TPS.** The 1 minute TPS is greater than or equal to the baseline, with a 0.05 tolerance so one decimal place from Paper is not a false failure.
- **MSPT.** The 1 minute average is less than or equal to the baseline, with the same 0.05 ms tolerance.

`ACCEPT` means those gates passed. If the high-water drop is under 1%, the summary says to repeat the run before treating it as a real win. `REJECT` means leave the flag out. `INCONCLUSIVE` means a heap sample, a pause log, TPS, or MSPT was missing. One pair of idle soaks is noisy. A few milliseconds of pause jitter is a reason to run it again.

## The numbers are still to come

I have not run this on `parkour-spiral`. That soak needs Java 25 and the world on the host, with the live server stopped, and it has not happened. `tests/jvm-opts.sh` checks the flag is absent by default and present when `COMPACT_OBJECT_HEADERS` is set, and that an unknown value fails. `tests/compact-headers.sh` checks the copy refusals (same path, symlink, hardlink, path overlap, and a live `server.pid`) and the `ACCEPT` / `REJECT` / `INCONCLUSIVE` parser, including a stubbed two-run measurement that never uses the original directory as the server world. Heap, pause, TPS, and MSPT numbers come from a real soak, and that soak has not been run.

The comparison is tracked on [minecraft-server#129](https://github.com/KevinTCoughlin/minecraft-server/issues/129). When `summary.md` exists I will put it there. Until then the flag stays off.
