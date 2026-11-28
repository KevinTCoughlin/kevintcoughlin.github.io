---
published: 2026-11-29T16:00:00Z
description: Listen Now trapped on Dictionary(uniqueKeysWithValues:) when two RecentStation rows shared an id. The latest play is kept, and counts sum to 6.
tags:
  - swift
  - ios
  - tips
---

# Listen Now crashed when two recents shared an id

In [ShoutKit](https://github.com/cascadiacollections/shoutkit), Listen Now keyed Recently Played with `Dictionary(uniqueKeysWithValues:)`. That initializer traps when two keys match. `stationID` stopped being unique in schema V2, because CloudKit does not support unique attributes, and with iCloud sync on the same station can briefly have two Recently Played rows. Drawing Listen Now in that window crashed. The change is [shoutkit#288](https://github.com/cascadiacollections/shoutkit/pull/288) ([`fa434a1`](https://github.com/cascadiacollections/shoutkit/commit/fa434a1708e25a4c3ff3722e79a5a885502fe129)), for [shoutkit#282](https://github.com/cascadiacollections/shoutkit/issues/282).

## The lookup trapped

`displayedRecentStations` built a dictionary from every recent row:

```swift
let byID = Dictionary(uniqueKeysWithValues: recents.map { ($0.stationID, $0) })
```

A duplicate `stationID` is a precondition failure, so Listen Now fatal-errored and Recently Played never appeared.

The store itself never inserts a second row for a station. `mergeDuplicateStations()` runs when the store is created, and the normal play path updates one row, so a single device that only writes through `LibraryStore` should not hit this. Two devices can each record the same station before they sync, and both rows then arrive. The crash is the gap after that import lands and before the next merge, while the view is on screen. `logRecent` kept the gap open: it updated `matches.first` and left the other row.

## Show the latest play

`RecentStation.latestByStationID(_:)` builds the same lookup with `Dictionary(_:uniquingKeysWith:)` and keeps the row with the later `playedAt`:

```swift
static func latestByStationID(_ recents: some Sequence<RecentStation>) -> [String: RecentStation] {
    Dictionary(recents.map { ($0.stationID, $0) }) { first, second in
        first.playedAt >= second.playedAt ? first : second
    }
}
```

`mergeDuplicateRecents()` sorts by `playedAt` descending and keeps the first row it sees for each id, then adds the other play counts onto that row. The lookup picks that same survivor, so the view shows the row it will show after the merge. The view calls it:

```swift
// Not `uniqueKeysWithValues`: since schema version 2 two rows can
// share a station until they are merged (DECISIONS.md 2026-11-22).
let byID = RecentStation.latestByStationID(recents)
return recentlyPlayedTeaser.displayedIDs.compactMap { byID[$0] }
```

The function lives in `Persistence`. `BrowseFeature` depends on `DesignSystem` and cannot be tested on the Mac host, so this one-line call site in `ListenNowView` is untested.

## Playing again merges the counts

`logRecent` collapses every row for the station before it writes the new play. `collapseRecents` keeps the latest `playedAt`, adds the others' `playCount`, and deletes the rest without saving:

```swift
func collapseRecents(_ recents: [RecentStation]) -> RecentStation? {
    guard let keeper = recents.max(by: { $0.playedAt < $1.playedAt }) else { return nil }
    for recent in recents where recent !== keeper {
        keeper.playCount += recent.playCount
        context.delete(recent)
    }
    return keeper
}
```

The keeper then records this play and takes the station's name:

```swift
if let existing = collapseRecents(matches) {
    existing.playedAt = .now
    existing.playCount += 1
    // A genuine new play un-hides it from Listen Now even if it was
    // previously dismissed there.
    existing.isHiddenFromListenNow = false
    existing.name = station.name
```

The test inserts the duplicates after the store has already merged at creation, saves, and then logs a play of KEXP:

```swift
// Arrive after the store merged at creation, as a sync import would.
context.insert(RecentStation(
    stationID: "kexp", name: "Older", genre: "", playedAt: Date(timeIntervalSince1970: 1000), playCount: 3,
))
context.insert(RecentStation(
    stationID: "kexp", name: "Newer", genre: "", playedAt: Date(timeIntervalSince1970: 2000), playCount: 2,
))
```

```swift
store.logRecent(Station(id: "kexp", name: "KEXP", genre: "Eclectic", listenerCount: 0))
```

One row remains, named KEXP, with play count 6. That is the older row's 3, the newer row's 2, and the new play.

```swift
#expect(recents.count == 1)
#expect(recents.first?.name == "KEXP")
#expect(recents.first?.playCount == 6)
```

A second test runs `latestByStationID` on two rows with station id `kexp` (named Old and New) and one named WFMU, in both orders. Both expect two entries, `kexp` pointing at New, and `wfmu` pointing at WFMU.

`swift test --disable-xctest` in `Packages/Persistence` reported 113 tests in 15 suites passed. `xcodebuild` with `-destination 'generic/platform=iOS Simulator'`, `CODE_SIGNING_ALLOWED=NO`, and `build-for-testing` compiled the `ListenNowView` change. SwiftLint 0.65.1 `--strict` and SwiftFormat 0.64.5 `--lint` were clean. The simulator test plan was not run: that machine has no iOS Simulator runtime installed, and CI covers the plan. Nothing here was run on hardware. The issue did not need it.

## What I would repeat

- **`uniqueKeysWithValues` traps on a duplicate key.** After schema V2, two `RecentStation` rows can share an id between a sync import and `mergeDuplicateStations()`. A lookup built with that initializer crashes if Listen Now draws in the gap.
- **Keep the latest `playedAt`.** `Dictionary(_:uniquingKeysWith:)` returns the later play, the same row `mergeDuplicateRecents()` keeps, so the teaser shows the row the merge will leave.
- **Add the other play counts on the write.** `collapseRecents` sums them onto that row and deletes the rest. The test's counts are 3 + 2 + 1 = 6.
