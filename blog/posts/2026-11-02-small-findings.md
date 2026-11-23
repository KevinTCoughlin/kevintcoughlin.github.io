---
published: 2026-11-03T03:20:00Z
updated: 2026-11-23T01:37:15Z
---

# Small Findings

Short notes from side projects. Each one is something I measured or hit, not a general claim.

## Godot 4.8 beta 2 makes my Android APK about 6 MB smaller

_2026-11-02_

[Salt Line](https://github.com/cascadiacollections/saltline), my Rust + Godot artillery game, ships on Godot 4.7.2. I keep an opt-in CI job that exports the same project with both 4.7.2 and 4.8-beta2 and compares the results.

Both exports below use Godot's official export templates, for arm64 Android, with release builds. My shipping 4.7.2 build uses a stripped custom engine instead, so these aren't my store sizes. They do compare like with like.

|                                                          |        4.7.2 |    4.8-beta2 |               Change |
| -------------------------------------------------------- | -----------: | -----------: | -------------------: |
| Salt Line APK                                            | 90,869,703 B | 84,594,405 B | −6,275,298 B (−6.9%) |
| `libgodot_android.so` in the APK                         | 71,114,944 B | 64,818,536 B | −6,296,408 B (−8.9%) |
| `libsalt_line_godot.so` (my Rust GDExtension) in the APK |  6,077,720 B |  6,077,720 B |                  0 B |

Almost all of the drop is the engine library. My own native library is byte-for-byte the same size. So the savings come from Godot, not from anything I changed.

Not everything got smaller. The Linux x86_64 release export grew by 3,135,744 B (78.6 MB → 81.7 MB), the same amount as the official Linux template grew. I haven't looked into what changed in the engine on either platform.

The numbers come from one CI run ([41565869845](https://github.com/cascadiacollections/saltline/actions/runs/41565869845)) against 4.8-beta2 commit `cafc17a19`. Betas change, so I'll measure again at the release candidate.

### The export that didn't build at first

The first 4.8 Android export failed in Gradle:

```
GodotApp.java:49: error: cannot find symbol
  symbol:   variable FLAVOR
  location: class BuildConfig
```

4.8 moved `com/godot/game/GodotApp.java` to `com/godot/game/app/GodotApplication.java`. My build script unpacked the 4.8 Android build template over the 4.7.2 one that the job had just used, so the old `GodotApp.java` stayed behind and was compiled against 4.8's Gradle project.

The fix was to delete `android/build` before unpacking the template ([saltline#144](https://github.com/cascadiacollections/saltline/pull/144)). If you switch Godot versions in one checkout and see a strange Java error in the Android export, check for files left over from the old template.

## Godot 4.8: `vulkan=false` is no longer enough for a Vulkan-less build

_2026-11-12_

I ship Salt Line with a stripped Godot engine, compiled from a [build profile](https://docs.godotengine.org/en/stable/engine_details/development/compiling/optimizing_for_size.html) that turns off what the game doesn't use, Vulkan included. On Godot 4.7.2 that profile sets `"vulkan": false`. When I built the same profile against 4.8-beta3, the Android template stopped compiling:

```
platform/android/display_server_android.cpp:883:2: error: use of undeclared identifier 'free_vulkan_global_context'
```

The cause is a new option in 4.8. `SConstruct` now has a `rendering_device` option, on by default, and defines `RD_ENABLED` from it. In 4.7.2, only the Vulkan driver turned on `RD_ENABLED` on Android. So `vulkan=false` now leaves `RD_ENABLED` defined without `VULKAN_ENABLED`. The Android display server's destructor calls `free_vulkan_global_context()` under `#if defined(RD_ENABLED)`, but the header only declares that function under `#ifdef VULKAN_ENABLED`.

The fix is to turn off the new option as well:

```json
"vulkan": false,
"rendering_device": false
```

That's also the setting you want: with no Vulkan driver there's nothing for RenderingDevice to drive. You can't put it in a profile you still use for 4.7.2, though, because 4.7.2 doesn't have the option. My trial build adds it on top of the 4.7.2 profile and checks that every option it sets exists in the Godot tree it builds ([saltline#154](https://github.com/cascadiacollections/saltline/pull/154)).

With that change, the stripped 4.8-beta3 arm64 `libgodot_android.so` is 21,041,224 B, against 23,186,048 B for my shipping 4.7.2 engine. That's 2.1 MB (9%) smaller, before I've tried turning off the new `tilemap` and `texture_streaming` modules.

The same code is on beta2 and on Godot's `master`, so this isn't a beta3 regression. I only hit it now because beta2's trial never built the stripped engine. If you build a Vulkan-less Godot 4.8, set `rendering_device=false` too.

## A GitHub traffic referrer that was only bots

_2026-11-04_

GitHub's traffic page started listing `aocr.org` as a referrer. Every one of my repos spiked on the same day, 2026-10-29. The "visitors" landed on old merged PRs and on `.gitignore`, which nobody reads on purpose. The site itself sits behind a Cloudflare challenge.

GitHub builds its referrer list from the `Referer` header, and any client can set that header to anything. This is referrer spam. I'm treating referrer counts as noise until I have install counts to compare against.

## My media keys never worked, and I didn't notice

_2026-11-04_

`mediactl` in [wezterm-media](https://github.com/KevinTCoughlin/wezterm-media) sends media keys on macOS by posting an `NSEvent` from `otherEventWithType:14 subtype:8`. It used key codes 1016, 1017 and 1018 for play, next and previous. But `NX_KEYTYPE_PLAY`, `NX_KEYTYPE_NEXT` and `NX_KEYTYPE_PREVIOUS` in `IOKit/hidsystem/ev_keymap.h` are 16, 17 and 18. So those three keys never did anything.

Nobody noticed because my Mac controlled playback through AppleScript instead. The fix is [wezterm-media#4](https://github.com/KevinTCoughlin/wezterm-media/pull/4).

## "STEAM validation rejected" was a text file with the wrong number in it

_2026-11-22_

[cs-server](https://github.com/KevinTCoughlin/cs-server) is my containerized Counter-Strike 1.6 server. It had bots, a passing health check, a connection to Steam and VAC turned on. Then I joined it from a real game client for the first time and got `STEAM validation rejected`.

The image had `70` in `steam_appid.txt`. That is Half-Life's Steam app id; Counter-Strike's is 10. The engine normally rewrites that file at startup with the id of the game it is running. My container has a read-only root filesystem, so it couldn't, and the server signed on to Steam as Half-Life. Steam then refused every ticket a Counter-Strike client presented. The one hint in the log was a line I had read past many times:

```
Setting breakpad minidump AppID = 70
```

I confirmed it by starting the same image with the file set to `10`. The same client connected and the server logged `STEAM USERID validated`.

Nothing automated could have caught this. Bots don't authenticate, and neither do the server-browser query or my health check. The fix writes each game's own id at build time ([cs-server#114](https://github.com/KevinTCoughlin/cs-server/pull/114)). If you run a GoldSrc server on a read-only filesystem, check that file.

## A config file my server couldn't read, and didn't complain about

_2026-11-22_

My installer for the same server copies `server.cfg` into a directory under `~/.config` and used to set it to mode 600, because the file can hold an RCON password. A server installed that way ran on stock settings and said nothing about it.

The server process runs as a non-root user inside the container (uid 10001). Under rootless Podman my own user maps to root in the container, so the bind-mounted file showed up as owned by root with mode 600, and the server's user fell under "other". The engine doesn't treat a config file it can't open as an error. It carries on with defaults. The only trace was from a plugin that reads the map cycle:

```
Couldn't read file "mapcycle.txt"
```

I found it when I test-installed a second game, Day of Defeat, and its hostname came up as "Half-Life" instead of the one in its config.

The fix was mode 644 for the files inside a directory that stays 700 ([cs-server#109](https://github.com/KevinTCoughlin/cs-server/pull/109)). Other users on the host still can't reach the files, because they can't get through the directory. The container can, because each file is mounted on its own and the container never walks the host path.

## `Tf_sg.sc`: a file name that only works on x86

_2026-11-22_

I added Team Fortress Classic to the same image build. It passed its test on amd64 and died on arm64, where the 32-bit server runs under `qemu-i386`:

```
Host_Error: EV_Precache_internal: file events/wpn/tf_sg.sc missing from server
```

I blamed SteamCMD, which has a known habit of not downloading every file in one pass, and wrote two different retry loops to make the download "complete". Both were wrong. The download had been complete the whole time. The file is there, as `Tf_sg.sc` with a capital T, and the game asks for `tf_sg.sc`.

On x86 the engine finds it anyway. Under `qemu-i386` on arm64 it doesn't. I haven't worked out why the lookup behaves differently there. The fix doesn't depend on knowing: the build adds a lower-case symlink next to every mixed-case file in the game directory ([cs-server#109](https://github.com/KevinTCoughlin/cs-server/pull/109)). Team Fortress Classic had 36 such files; this is the one that stopped the server.

What I'd do differently: list the directory before theorizing about the download.

## My CI never ran the Docker release that broke my server

_2026-11-22_

Docker Engine 29.4.2 (2026-05-01) blocked the `socketcall` system call in its default seccomp profile, as a mitigation for CVE-2026-31431. 32-bit programs open sockets through that call, so every i386 program lost networking, my game server included. It was reported as [moby/moby#52506](https://github.com/moby/moby/issues/52506) and undone five days later in 29.4.3.

I hit it months later on a machine that still had 29.4.2, and worked around it by shipping a copy of Docker's upstream profile and passing it to every `docker run`. When I went to remove that workaround, I checked what my CI had been testing all along. GitHub's hosted `ubuntu-24.04` runners had Docker 28.0.4, which is older than the bug. So CI had never run the broken release, and it couldn't tell me whether a current one worked either.

I removed the copied profile and added a small weekly job that installs the newest Docker Engine on a runner with `docker/setup-docker-action` and starts the published image under the built-in profile ([cs-server#121](https://github.com/KevinTCoughlin/cs-server/pull/121)). Its first run was on 29.10.0 and passed. The installer now refuses 29.4.2 by name.

If your software is sensitive to the container runtime, check which runtime version your CI actually has. Mine was a major version behind the one people install today.

## A crash I've seen three times, and a core dump I didn't expect to have

_2026-11-22_

Two release builds of cs-server in a row failed the same test step: the game server segfaulted on a map change sent a second or two after startup, with bots turned off. The same step passed on every pull request. Locally I got it once in about 350 boots.

The server couldn't write its own crash log, because the container's root filesystem is read-only. But the host is Fedora, and `systemd-coredump` had kept a record of the crash inside the rootless container:

```
$ coredumpctl info hlds_linux
  #0  0x00000000f1b4338a n/a (/hlds/cstrike/dlls/cs.so + 0x1fc38a)
```

The game library is stripped, but it exports its C++ symbols. `nm -D` on the file puts that address inside `CNavArea::UpdateOnOpenList()`, which is bot navigation in [ReGameDLL](https://github.com/rehlds/ReGameDLL_CS). On a server with bots off.

It turned out bots-off wasn't quite off. `server.cfg` sets `bot_quota 10` at every map start, the game adds a bot on the next frame, and my plugin put the quota back to 0 half a second later, kicking it. That half-second bot is the only thing using navigation on such a server. My plugin now hooks the cvar and holds it at 0, so no bot joins ([cs-server#124](https://github.com/KevinTCoughlin/cs-server/pull/124)).

I can't say that fixes the crash. At one failure in a few hundred runs, a clean run proves very little, and the faulty pointer is in ReGameDLL's code, not mine. What I can say is that the only suspect is gone, and that `coredumpctl` is worth checking even when the crash happened in a container.
