---
published: 2026-11-25T17:20:00Z
tags:
  - android
  - performance
---

# I stopped dexing every Material icon in the ShoutKit debug build

[ShoutKit](https://github.com/cascadiacollections/shoutkit-android) depended on `material-icons-extended` for a handful of icons. The phone app uses 31 and the watch app 3. Release builds shrink the rest away. Debug builds dex the whole library, and that dex is where CI ran out of heap.

## The library is the whole catalog

`androidx.compose.material:material-icons-extended` 1.7.8 is the last release on Google's Maven. The metadata lists `latest` as 1.7.8 and `lastUpdated` as 2025-02-12. `material-icons-core` stopped at the same version. The 1.7.8 extended sources contain 11,105 `public val Icons` properties. [shoutkit-android#343](https://github.com/cascadiacollections/shoutkit-android/pull/343) and the commit below both call that about 11,000 icons.

The phone app turns minify and resource shrinking on for the release build type only:

```kotlin
release {
    isMinifyEnabled = true
    isShrinkResources = true
```

Debug leaves both at the Android Gradle Plugin default, so the dex step sees every icon in the dependency.

On [#342](https://github.com/cascadiacollections/shoutkit-android/pull/342), one push failed two jobs. [#343](https://github.com/cascadiacollections/shoutkit-android/pull/343) records them. The build job hit `Error while dexing` `material-icons-extended` in `:app:mergeExtDexPlayDebug` and `:cast:mergeExtDexPlayDebug`. CodeQL's autobuild hit `java.lang.OutOfMemoryError: Java heap space`. Both passed on a re-run with no code change. That pull request raised `org.gradle.jvmargs` from `-Xmx4g` to `-Xmx6g` and capped the Kotlin daemon at `-Xmx3g`. It also says the real fix is to stop shipping the library. That change is [`9703448`](https://github.com/cascadiacollections/shoutkit-android/commit/9703448ed60085b7e56b69adc762e9ceb554346f), merged as [#345](https://github.com/cascadiacollections/shoutkit-android/pull/345).

## Fourteen stay in core, seventeen are copied

After the change, fourteen phone icons are still imported from `androidx.compose.material.icons`, and all fourteen are in the 1.7.8 core sources: Add, ArrowBack, Check, Clear, Close, Delete, Favorite, FavoriteBorder, MoreVert, PlayArrow, Refresh, Search, Settings, and Share. ArrowBack is the automirrored one. Core stays on the phone app.

The other seventeen are not in those core sources. They are copied from the 1.7.8 extended sources into `com.cascadiacollections.sir.ui.icons`: Backup, Bedtime, ContentCopy, DragHandle, FileDownload, FileUpload, FilterList, GraphicEq, History, LibraryMusic, MusicNote, Pause, PlayCircle, QueueMusic, Radio, Stop, and WifiOff. Sixteen are `Icons.Filled`. QueueMusic is `Icons.AutoMirrored.Filled`.

The watch app uses three: PlayArrow from core, plus Pause and Stop. The wear module does not depend on the phone app, so Pause and Stop are copied again into `com.cascadiacollections.sir.wear.icons`, and wear depends on core instead of extended.

Call sites keep `Icons.Default`, `Icons.Filled`, and `Icons.AutoMirrored.Filled`. `SirTab` still says `Icons.Default.PlayCircle`. The import is what moves:

```kotlin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import com.cascadiacollections.sir.ui.icons.LibraryMusic
import com.cascadiacollections.sir.ui.icons.PlayCircle
```

`Stop.kt` is the shortest copy. The Apache-2.0 header above this comment is the upstream header, unchanged. The path data is the 1.7.8 path. Upstream declares `public val`. The copy drops `public` and adds the suppression.

```kotlin
// Copied from androidx.compose.material:material-icons-extended 1.7.8, package
// androidx.compose.material.icons.filled, so the app can use this icon without depending
// on the whole library. Changes from the original: the package, no explicit `public`,
// and the lint suppression below (the cache field's name is upstream's).
@file:Suppress("BackingPropertyNaming")

package com.cascadiacollections.sir.ui.icons

val Icons.Filled.Stop: ImageVector
    get() {
        if (_stop != null) {
            return _stop!!
        }
        _stop = materialIcon(name = "Filled.Stop") {
            materialPath {
                moveTo(6.0f, 6.0f)
                horizontalLineToRelative(12.0f)
                verticalLineToRelative(12.0f)
                horizontalLineTo(6.0f)
                close()
            }
        }
        return _stop!!
    }

private var _stop: ImageVector? = null
```

`REUSE.toml` marks both directories Apache-2.0:

```toml
[[annotations]]
path = [
    "app/src/main/java/com/cascadiacollections/sir/ui/icons/**",
    "wear/src/main/java/com/cascadiacollections/sir/wear/icons/**",
]
precedence = "override"
SPDX-FileCopyrightText = "The Android Open Source Project"
SPDX-License-Identifier = "Apache-2.0"
```

The phone app drops the extended dependency and keeps core:

```kotlin
implementation(libs.androidx.compose.material.icons.core)
```

The wear module's dependency changes from extended to that same core artifact. The catalog entry for `material-icons-extended` is removed.

## The debug APK

The commit message says the FOSS debug APK went from 35.1 MB to 22.7 MB. [#345](https://github.com/cascadiacollections/shoutkit-android/pull/345) says that before figure came from an incremental build and overstates it. The like-for-like run is one workstation, FOSS flavour, `main` at [`ff30d27`](https://github.com/cascadiacollections/shoutkit-android/commit/ff30d27ddb907631e54f8e0adf8fced2c393fdee) against the branch, each with `--rerun-tasks --no-build-cache`:

|                                            | Before                  | After            |
| ------------------------------------------ | ----------------------- | ---------------- |
| Debug APK                                  | 29,397,070 bytes        | 22,728,773 bytes |
| Debug dex, uncompressed                    | 85.2 MB                 | 54.0 MB          |
| Methods defined in the debug APK           | 236,017                 | 213,150          |
| of which `androidx.compose.material.icons` | 23,529 (13.7 MB of dex) | 628 (0.25 MB)    |
| Release APK                                | 4,278,226 bytes         | 4,278,226 bytes  |

22,728,773 bytes is the 22.7 MB in the commit message. The release APK is the same size both ways, because R8 was already dropping the unused icons. The same pull request also timed a clean debug build, one run each: 78.7 s to 71.0 s with a cold daemon, and 21.4 s to 19.6 s with a warm one. It says to read that as a little faster.

Nobody compared the icons on a screen. The vectors match the 1.7.8 sources, and the watch app was only compiled.

The 6 GB heap from #343 is still in `gradle.properties`. The dex that ran out of memory was this library.
