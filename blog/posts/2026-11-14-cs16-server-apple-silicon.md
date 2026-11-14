---
published: 2026-11-14T18:00:00Z
---

# Running a 32-bit Counter-Strike 1.6 server on Apple silicon (without Rosetta)

I run [cs-server](https://github.com/KevinTCoughlin/cs-server), a containerized Counter-Strike 1.6 ScoutzKnivez server on the ReHLDS stack. It lives on a Linux box under Podman and Quadlet. I wanted it to run on a Mac too, with Apple's new [`container`](https://github.com/apple/container) CLI, and the obvious plan was `--platform linux/amd64 --rosetta`.

That plan failed on the first command.

## Rosetta for Linux is x86_64 only

```text
$ container run --rm --platform linux/amd64 --rosetta \
    --entrypoint /hlds/hlds_linux ghcr.io/kevintcoughlin/cs-server -help
Error: failed to exec [/hlds/hlds_linux -help] ... "Exec format error"
```

The same image's `/bin/sh` ran fine under Rosetta. The difference is byte 4 of the ELF header:

```text
$ od -An -tx1 -j4 -N1 /hlds/hlds_linux
 01
```

`01` means ELFCLASS32. HLDS, the 2003-era Half-Life Dedicated Server, is a 32-bit i386 binary, and so are its engine, game DLL, Metamod and AMX Mod X modules. Even SteamCMD, which installs the server, is 32-bit. Rosetta for Linux translates 64-bit x86 only. No flag combination changes that.

> **Tip:** before you try any game server on Apple silicon, check the ELF class of its binaries. One `od` call saves an afternoon.

## Plan B: qemu-user inside an arm64 image

Rosetta translates at the CPU level. QEMU's _user-mode_ emulator, `qemu-i386`, translates a single Linux process instead, so it doesn't care what the host is. The image therefore becomes **linux/arm64**, ships the i386 libraries through Debian multiarch (`libc6:i386` and friends install fine on arm64), and launches the server as `qemu-i386 /hlds/hlds_linux …`.

Two details kept that small:

- **Copy one binary, not the package.** Debian's `qemu-user` ships every target architecture, about 460 MB. The image copies the static `qemu-i386` (14 MB) out of it and purges the package in the same layer.
- **No binfmt registration needed.** Apple `container` has no `--privileged`. Calling qemu explicitly sidesteps that. `hlds_run` accepts `-binary <path>`, so the entrypoint hands it a two-line wrapper.

One trick kept the health check working. The health check looks for a process named `hlds_linux` in `/proc/*/comm`. Under qemu, the process name is the emulator's. Running qemu through a **symlink named `hlds_linux`** fixes that, because the kernel takes the process name from the path you exec.

## Valve's libraries vs. qemu-user

The engine and AMX Mod X ran on the first try. Steam's client library did not:

```text
Fatal error: futex robust_list not initialized by pthreads
qemu: uncaught target signal 11 (Segmentation fault)
```

qemu-user doesn't implement the `set_robust_list` / `get_robust_list` syscalls. `steamclient.so` checks that the calling thread has a robust futex list and aborts when it can't read one back.

The fix is a ~100-line `LD_PRELOAD` shim, cross-compiled with `gcc-i686-linux-gnu`. It intercepts libc's `syscall()` and answers `get_robust_list` with an empty, glibc-shaped list head. "Glibc-shaped" mattered: my first version left `futex_offset` at 0, and the error changed to _"robust_list not pthreads-compatible"_, which at least showed the check was reading my answer. glibc uses `offsetof(__lock) - offsetof(__list.__next)`, which is −20 on i386. With that value the check passes. Under emulation nothing in the kernel walks that list, so this only satisfies the check.

SteamCMD, which runs at build time, needed three more workarounds:

1. **`/proc/cpuinfo`.** SteamCMD exits(1) without an x86 `flags` line (it wants SSE). Under qemu-user the file still describes the ARM host. The build sandbox won't let you bind-mount over `/proc`, and `unshare` is blocked in `container build`. So the same shim redirects `open("/proc/cpuinfo")` to a fake x86 one. Include `cpu MHz`: without it SteamCMD still bails.
2. **`STEAM_PLATFORM=linux32`.** After self-updating, `steamcmd.sh` notices `uname -m` is `aarch64` and looks for a `linuxarm64` build that isn't there.
3. **`DEBUGGER=run-i386`.** `steamcmd.sh` already launches its binary through `$DEBUGGER` and keeps its restart-after-update loop. That makes it the perfect hook for an emulator wrapper.

Finally, the server came up "disconnected from Steam3" until the runtime image got **`ca-certificates`**. `steamclient.so` couldn't open TLS without them. (Worth checking on the x86 image too.)

## One Containerfile, two architectures

I didn't want a separate Mac Containerfile. Everything architecture-specific lives in one script, `i386-compat.sh`:

|                                    | amd64                                | arm64                                 |
| ---------------------------------- | ------------------------------------ | ------------------------------------- |
| i386 libraries                     | `lib32*` biarch packages (unchanged) | multiarch `:i386` + `ca-certificates` |
| Build-time i386 tools (`run-i386`) | `exec "$@"`                          | `qemu-i386` + shim + fake cpuinfo     |
| Server launcher                    | not installed                        | qemu symlink named `hlds_linux`       |

The Containerfile calls `run-i386 ./amxxpc` and `DEBUGGER=run-i386 steamcmd.sh`. On x86 those are a no-op `exec`, so the Linux image builds the same way as before (CI agrees). One gotcha: **Apple's builder doesn't set `TARGETARCH`**, so `FROM stage-${TARGETARCH}` fails with `invalid ref: stage-`. Branch inside a script instead.

## Does it hold up?

On an M-series Mac with 2 vCPUs, 20 slots and 10 bots, at `sys_ticrate 1000` with `pingboost 2`:

- **~250 server FPS**, which is plenty for LAN and friends (clients update at ≤100 Hz)
- **~50–80% of the VM's CPU** and **~340 MiB** of RAM
- the server connects to Steam in secure mode, and answers A2S queries on the LAN
- a from-source image build in about ten minutes, most of it SteamCMD downloading under emulation

For a busy public server I'd still use Linux on x86. For a Mac in the living room on LAN night, it's more than enough. A small launchd agent makes it start at login and restart on crashes, and the in-game shutdown countdown still runs on stop.

## Takeaways

- **Check the ELF class first.** Rosetta for Linux won't run 32-bit x86.
- **qemu-user is a real option** for small, old, single-process servers. Copy just the one target binary into your image.
- **Most breakage was at the edges:** syscalls qemu doesn't implement, `/proc` files describing the wrong CPU, and scripts that sniff `uname -m`. An `LD_PRELOAD` shim covers a surprising amount of that.
- **Keep architecture logic in one script** with a no-op path for the native case. Then the x86 build doesn't change.

The full change is [cs-server#56](https://github.com/KevinTCoughlin/cs-server/pull/56). The interesting files are `scripts/i386-compat.sh` and `scripts/i386-qemu-shim.c`.
