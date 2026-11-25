---
published: 2026-11-25T17:25:00Z
tags:
  - android
  - performance
  - tips
---

# I shipped 11,105 icons to use 17

[Shoutkit](https://github.com/cascadiacollections/shoutkit-android)'s phone app draws 31 Material icons, and the watch app draws three: PlayArrow, Pause, and Stop. Fourteen of the phone's icons come from `material-icons-core`. The other seventeen came from `material-icons-extended`. The 1.7.8 Android archive of that library is 11,105 icon classes. Release builds shrink the unused ones away. Debug builds dex every class, and that step is where CI ran out of heap. Copying the seventeen and dropping the dependency took the FOSS debug APK from 29,397,070 bytes to 22,728,773.

## Where the heap went

A push on [#342](https://github.com/cascadiacollections/shoutkit-android/pull/342) failed two jobs. The build died with `Error while dexing` on `material-icons-extended`, in `:app:mergeExtDexPlayDebug` and `:cast:mergeExtDexPlayDebug`. CodeQL's autobuild died with `java.lang.OutOfMemoryError: Java heap space`. Both passed on a rerun. The Gradle heap was 4 GB. [#343](https://github.com/cascadiacollections/shoutkit-android/pull/343) raised `org.gradle.jvmargs` to `-Xmx6g` and set `kotlin.daemon.jvmargs=-Xmx3g`, so the Kotlin compile daemon, a second JVM, fits a 16 GB runner alongside Gradle. The icon library stayed. That write-up called it about 11,000 icons, of which the app used 32, and left the replacement for a later change.

The removal counted 31 on the phone and 3 on the watch. `material-icons-extended-android` 1.7.8 contains 11,105 classes, one `val Icons` property each: 2,083 names in each of filled, outlined, rounded, sharp, and twotone, and 138 automirrored icons in each of those styles. None of those names are the fourteen the phone imports from core. Compose BOM `2026.09.00`, the version in the [catalog](https://github.com/cascadiacollections/shoutkit-android/blob/9703448ed60085b7e56b69adc762e9ceb554346f/gradle/libs.versions.toml), still resolves both icon artifacts to 1.7.8, and 1.7.8 is the latest release on Google's Maven repository. The metadata was last updated on 2025-02-12. The [POM](https://dl.google.com/dl/android/maven2/androidx/compose/material/material-icons-extended-android/1.7.8/material-icons-extended-android-1.7.8.pom) says the module is a very large dependency and should not be included directly.

## The seventeen copies

[#345](https://github.com/cascadiacollections/shoutkit-android/pull/345) ([`9703448`](https://github.com/cascadiacollections/shoutkit-android/commit/9703448ed60085b7e56b69adc762e9ceb554346f)) removes `material-icons-extended` from the phone app, the watch app, and the version catalog. The watch module depends on `material-icons-core` on its own. The seventeen icons are copied from the 1.7.8 sources into `com.cascadiacollections.sir.ui.icons`: Backup, Bedtime, ContentCopy, DragHandle, FileDownload, FileUpload, FilterList, GraphicEq, History, LibraryMusic, MusicNote, Pause, PlayCircle, QueueMusic, Radio, Stop, and WifiOff. Sixteen are `Icons.Filled`. QueueMusic is `Icons.AutoMirrored.Filled`, the variant the library screen already used. Pause and Stop are copied again into `com.cascadiacollections.sir.wear.icons`, because the two apps share no Compose code. Call sites keep writing `Icons.Default` (an alias for `Icons.Filled`) and `Icons.AutoMirrored.Filled`, and change the import.

The fourteen that stay on core are Add, ArrowBack (automirrored), Check, Clear, Close, Delete, Favorite, FavoriteBorder, MoreVert, PlayArrow, Refresh, Search, Settings, and Share.

Under the Apache-2.0 header, `Pause` says where it came from and what changed:

```kotlin
// Copied from androidx.compose.material:material-icons-extended 1.7.8, package
// androidx.compose.material.icons.filled, so the app can use this icon without depending
// on the whole library. Changes from the original: the package, no explicit `public`,
// and the lint suppression below (the cache field's name is upstream's).
@file:Suppress("BackingPropertyNaming")

val Icons.Filled.Pause: ImageVector
```

`REUSE.toml` marks both directories Apache-2.0, so those terms stay on the copies inside the GPL-3.0 apps:

```toml
# Material icons copied from androidx.compose.material:material-icons-extended 1.7.8, so the
# apps ship the 17 icons they use instead of the whole library. Apache-2.0, as each file's
# header says; they keep those terms inside the GPL-3.0 apps.
[[annotations]]
path = [
    "app/src/main/java/com/cascadiacollections/sir/ui/icons/**",
    "wear/src/main/java/com/cascadiacollections/sir/wear/icons/**",
]
precedence = "override"
SPDX-FileCopyrightText = "The Android Open Source Project"
SPDX-License-Identifier = "Apache-2.0"
```

## What the clean build measured

The commit message says the FOSS debug APK went from 35.1 MB to 22.7 MB. [#345](https://github.com/cascadiacollections/shoutkit-android/pull/345) measured both sides clean, [`ff30d27`](https://github.com/cascadiacollections/shoutkit-android/commit/ff30d27ddb907631e54f8e0adf8fced2c393fdee) on `main` against the branch, each with `--rerun-tasks --no-build-cache`. The before size in that run is 29,397,070 bytes. The 35.1 MB figure came from an incremental build.

|                                           |                  Before |         After |
| ----------------------------------------- | ----------------------: | ------------: |
| FOSS debug APK                            |            29,397,070 B |  22,728,773 B |
| Debug dex, uncompressed                   |                 85.2 MB |       54.0 MB |
| Methods defined in the debug APK          |                 236,017 |       213,150 |
| `androidx.compose.material.icons` methods | 23,529 (13.7 MB of dex) | 628 (0.25 MB) |
| Release APK                               |             4,278,226 B |   4,278,226 B |

The release APK is the same 4,278,226 bytes. R8 was already removing the unused icons, so the bytes that moved are in the debug APK, which is what CI dexes. The debug APK is 6,668,297 bytes smaller, 22.7%. One clean debug build was a little faster, 78.7 s to 71.0 s with a cold daemon and 21.4 s to 19.6 s warm. Those are one run each.

`detekt`, `:app:lintPlayDebug`, `:wear:lintDebug`, `:app:testFossDebugUnitTest`, `:wear:testDebugUnitTest`, `:app:assembleFossDebug`, and `:wear:assembleDebug` passed locally, and so did `reuse lint` and `.github/scripts/check-license-boundary.sh`. The vectors are the 1.7.8 paths. A side-by-side look on a device is still open, and the watch app was only compiled.

If a debug build is dexing `material-icons-extended` to draw a handful of icons, copy those icons and keep `material-icons-core`.
