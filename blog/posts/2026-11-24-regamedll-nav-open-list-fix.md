---
published: 2026-11-24T16:18:32Z
tags:
  - containers
  - tips
---

# The ReGameDLL nav crash was an uninitialized open-list marker

The `SIGSEGV` in `CNavArea::UpdateOnOpenList()` comes from three fields `Initialize()` never sets. A leftover `m_openMarker` equal to the live generation makes a new area look open, and the pathfinder follows `m_prevOpen`. The upstream pull request is still open. My server image rebuilds the library with those fields set.

[A crash I've seen three times, and a core dump I didn't expect to have](/blog/small-findings/#a-crash-ive-seen-three-times-and-a-core-dump-i-didnt-expect-to-have) named the function and left the cause open. The bad pointer is in [ReGameDLL](https://github.com/rehlds/ReGameDLL_CS). This is why.

## A new area can already look open

`CNavArea::Initialize()` sets `m_marker` and the hash links. It leaves `m_nextOpen`, `m_prevOpen`, and `m_openMarker` untouched. Areas come from `new CNavArea`, so those three fields keep whatever the allocation held.

`IsOpen()` is `m_openMarker == m_masterMarker`. `m_masterMarker` starts at 1 and counts up by one per search, so early in a server's life the live value is a small integer. Leftover memory holding that same integer is not rare. When it matches, `NavAreaBuildPath` takes the "already on the open list" branch and `UpdateOnOpenList()` follows the uninitialized `m_prevOpen`.

[rehlds/ReGameDLL_CS#1202](https://github.com/rehlds/ReGameDLL_CS/pull/1202) had the same signature, from hostage path-finding on a server with no bots. It was closed as apparently fixed by later commits. `master` (`1f16a7f`) still has this code. That pull request also unlinked areas in the destructor, cleared the open list in `DestroyNavigationMap()`, and returned immediately from `UpdateOnOpenList()` when `IsOpen()` was false. The crash is `IsOpen()` being true, so that early return never runs for it. The initialization is the fix. [rehlds/ReGameDLL_CS#1210](https://github.com/rehlds/ReGameDLL_CS/pull/1210) keeps only that.

## Set the fields to a value the marker never holds

[#1210](https://github.com/rehlds/ReGameDLL_CS/pull/1210) is open and unmerged. It writes the three fields in `Initialize()`, which every constructor calls. `0` is never a live marker: `m_masterMarker` starts at 1 and `MakeNewMarker()` skips 0. A new area stays off the list until `AddToOpenList()`.

```cpp
	// 0 is not a live generation: m_masterMarker starts at 1 and MakeNewMarker() skips 0.
	m_nextOpen = nullptr;
	m_prevOpen = nullptr;
	m_openMarker = 0;
```

The test `NavOpenList::ConstructedAreaIsNotOpen`, in `regamedll/unittests/nav_openlist_tests.cpp`, makes that deterministic. It allocates `sizeof(CNavArea)`, fills the block with the live marker value `1`, constructs a `CNavArea` in that memory, and checks `IsOpen()` is false. The object is left alive, because `~CNavArea()` calls `TheCSBots()`.

```cpp
TEST(ConstructedAreaIsNotOpen, NavOpenList, 1000)
{
	void *mem = std::malloc(sizeof(CNavArea));
	CHECK("allocation", mem != nullptr);
	if (!mem)
		return;

	unsigned int live = 1;
	auto *bytes = static_cast<unsigned char *>(mem);
	for (size_t i = 0; i + sizeof(live) <= sizeof(CNavArea); i += sizeof(live))
		std::memcpy(bytes + i, &live, sizeof(live));

	CNavArea *area = new (mem) CNavArea();
	CHECK("a new area is not on the open list", !area->IsOpen());
}
```

I ran the Linux `Unittests` build the way `build.yml` does, in `debian:11-slim`. Without the fix the log is `Failure in test 'ConstructedAreaIsNotOpen' : a new area is not on the open list`. With the fix it is `There were no test failures; Tests executed: 6`.

## The image rebuilds the library anyway

[cs-server#127](https://github.com/KevinTCoughlin/cs-server/pull/127) ([`a2b8175`](https://github.com/KevinTCoughlin/cs-server/commit/a2b8175df0b5859a59af7b909ce445058aa88732)) clones tag 5.30.0.814, applies `scripts/regamedll-nav-openlist.patch`, and installs the rebuilt `cs.so` over the copy from the release zip. The patch value-initializes the same three fields on the class:

```cpp
	// Not on the list until AddToOpenList. m_masterMarker starts at 1 and
	// MakeNewMarker() never returns to 0, so 0 is not a live generation.
	// Leaving these uninitialized makes IsOpen() true for leftover heap
	// and UpdateOnOpenList() follows that m_prevOpen (cs-server#122).
	CNavArea *m_nextOpen = nullptr;	// only valid if m_openMarker == m_masterMarker
	CNavArea *m_prevOpen = nullptr;
	unsigned int m_openMarker = 0;
```

Default member initializers run before the constructor body. `Initialize()` leaves them as they are, so a new area starts with null links and `m_openMarker` 0. The Containerfile runs that build at the end of the builder stage. The script and the patch are bind-mounted, so editing the patch re-runs the compile and the copy of `/hlds`, and the SteamCMD download stays cached:

```dockerfile
RUN --mount=type=bind,source=scripts/build-regamedll.sh,target=/usr/local/src/cs-server/build-regamedll.sh \
    --mount=type=bind,source=scripts/regamedll-nav-openlist.patch,target=/usr/local/src/cs-server/regamedll-nav-openlist.patch \
    . /usr/local/share/cs-server/game.env && \
    [ "${GAME_REGAMEDLL}" != 1 ] || bash /usr/local/src/cs-server/build-regamedll.sh \
        "${REGAMEDLL_VERSION}" \
        "/hlds/${GAME}/dlls/cs.so" \
        /usr/local/src/cs-server/regamedll-nav-openlist.patch
```

Before it compiles, the script requires the patched header to contain the initializer:

```bash
grep -q -F 'unsigned int m_openMarker = 0;' \
    "${src}/regamedll/game_shared/bot/nav_area.h" \
    || die "patch did not apply to nav_area.h"
```

## The unit test is the evidence

I have been running 5.30.0.814 rebuilt with this change on a live server since yesterday without problems. That is too short to say anything about a crash this rare. The unit test is the evidence. Upstream `master` keeps the bug until [#1210](https://github.com/rehlds/ReGameDLL_CS/pull/1210) merges.

A generation compared for equality is safe when a new object starts at a value the counter can never hold. Fill the allocation with the live marker and construct the object in that memory, and the uninitialized field fails on every run. On the server the same crash showed up three times in a few hundred starts.
