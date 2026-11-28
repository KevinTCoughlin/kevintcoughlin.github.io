---
published: 2026-12-01T16:00:00Z
tags:
  - gamedev
  - tips
---

# A gamemoded restart dropped the GameMode hold

In [godot-xdg-portals](https://github.com/KevinTCoughlin/godot-xdg-portals), `gamemoded`, not the portal, holds GameMode registrations. A daemon restart dropped them, and `request_game_mode()` still returned true.

`request_game_mode()` records a pid after `RegisterGame` returns 0. A later call for that pid returns true and does not call the portal again. A portal restart still works that way: a second `RegisterGame` for a pid the daemon already knows is rejected. A `gamemoded` restart drops every registration. The facade still had the pid, and the game ran without GameMode until it exited. The change is [godot-xdg-portals#51](https://github.com/KevinTCoughlin/godot-xdg-portals/pull/51) ([`bf3e41c`](https://github.com/KevinTCoughlin/godot-xdg-portals/commit/bf3e41c93aa7e0c95c8e166135058d3796324049)), which builds on the portal name watch in [godot-xdg-portals#44](https://github.com/KevinTCoughlin/godot-xdg-portals/pull/44). [#49](https://github.com/KevinTCoughlin/godot-xdg-portals/issues/49) had two options. This one takes the watch.

## The portal name watch cannot see the daemon

#44 watches `org.freedesktop.portal.Desktop`. When that name is lost, cached capabilities drop and GameMode holds stay. `gamemoded` tracks the game process, so a portal restart does not drop them, and registering again would be rejected.

The daemon's own name is `com.feralinteractive.GameMode`. #44 does not watch it. Before this change the pid stayed in `_game_mode_pids`, so the next request returned before it reached the bus:

```gdscript
	if _game_mode_pids.has(resolved):
		return true
```

`query_game_mode()` asks the backend and does not read that dictionary. [#49](https://github.com/KevinTCoughlin/godot-xdg-portals/issues/49) says that call would report `NOT_REGISTERED` after the daemon drops the pid. `request_game_mode()` never asks.

## Watch the daemon, and take the hold again

The native backend watches `com.feralinteractive.GameMode` and only watches it. The portal still forwards `RegisterGame`. There is no auto-start flag, so the watch does not activate the daemon.

```cpp
	// gamemoded holds GameMode registrations, not the portal. When it restarts
	// they are gone, and the facade has to register again. No auto-start flag:
	// watching must not activate the daemon.
	game_mode_daemon_watch = g_bus_watch_name_on_connection(connection,
			GAME_MODE_DAEMON_BUS_NAME, G_BUS_NAME_WATCHER_FLAGS_NONE,
			&XdgPortalNative::on_game_mode_daemon_appeared,
			&XdgPortalNative::on_game_mode_daemon_vanished, this, nullptr);
```

The first report is the daemon as found at startup. Nothing was registered with an earlier instance, so that report is ignored. A later owner is a new instance. A replacement with no unowned gap is reported as lost, then back. The facade keeps those pids as lost. The game still wants them, and the next instance gets them back:

```gdscript
func _on_game_mode_daemon_presence_changed(available: bool) -> void:
	if available:
		_retake_lost_game_mode()
		return
	for pid: int in _game_mode_pids.keys():
		_game_mode_lost_pids[pid] = true
	_game_mode_pids.clear()
```

`_retake_lost_game_mode()` calls `RegisterGame` for each lost pid once a daemon owns the name and the portal can be reached. If the portal name is unowned, it waits and runs again when the portal returns. A pid the new daemon rejects is dropped, and `portal_error` is emitted with context `GameMode.RegisterGame`:

```gdscript
			portal_error.emit(
				"GameMode.RegisterGame",
				"Could not register pid %d with GameMode again after gamemoded restarted." % pid
			)
```

`release_game_mode()` for a lost hold returns true with no bus call, and the hold is not taken again. `UnregisterGame` would otherwise D-Bus-activate a daemon that never had the pid:

```gdscript
	if _game_mode_lost_pids.has(resolved):
		_game_mode_lost_pids.erase(resolved)
		return true
```

`request_game_mode()` for a lost hold erases that entry and registers immediately. The outcome of that call decides it. Leaving the tree clears lost holds and does not unregister them. `gamemoded` already dropped the pid.

## Inside Flatpak the name is not visible

A Flatpak sandbox cannot see `com.feralinteractive.GameMode`, so the watch never fires and nothing changes there. No extra permission is requested. A `gamemoded` restart is recovered only when the game exits. The same note is in `docs/compatibility.md` and `docs/api.md`. The constant says why a missing name is left alone:

```cpp
// The GameMode daemon's own name. Only watched, never called: the portal
// forwards registrations to it. A sandbox that cannot see the name never
// reports it, which is the same as a daemon that never restarts.
inline constexpr const char *GAME_MODE_DAEMON_BUS_NAME = "com.feralinteractive.GameMode";
```

## What I ran

`./scripts/run_tests.sh` reported 116 passed and 0 failed, on Godot 4.7.2, a macOS build, headless. Seven of the tests are new, in `tests/test_game_mode_daemon.gd`. They cover taking the hold again after a restart, not taking a hold released before the restart, a local release while the daemon is gone, a request during the gap, a rejected re-take, a daemon restart during a portal gap, and leaving the tree after the daemon went away.

I did not run `./scripts/run_native_smoke.sh` locally. It now has a `gamemode-restart` mode, in which the fake portal also owns the daemon name and restarts it after the first `RegisterGame`. The checks on [`bf3e41c`](https://github.com/KevinTCoughlin/godot-xdg-portals/commit/bf3e41c93aa7e0c95c8e166135058d3796324049) passed, including the Godot suites and the fake-portal smoke ([run 46081122884](https://github.com/KevinTCoughlin/godot-xdg-portals/actions/runs/46081122884)). I did not run row 16 of `docs/native-testing.md`, `systemctl --user restart gamemoded`. Not tested on hardware.
