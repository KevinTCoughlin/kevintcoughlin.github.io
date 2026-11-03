---
published: 2026-11-03T03:20:00Z
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
