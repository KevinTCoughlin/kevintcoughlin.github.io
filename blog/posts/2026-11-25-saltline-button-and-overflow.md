---
published: 2026-11-25T17:20:00Z
tags:
  - rust
  - tips
---

# The third draft card was pause, and the shell reserve could wrap

Two bugs in [Salt Line](https://github.com/cascadiacollections/saltline), both fixed in [saltline#167](https://github.com/cascadiacollections/saltline/pull/167) ([`d5d720c`](https://github.com/cascadiacollections/saltline/commit/d5d720c0e9566cb01c568ed3b6332ba7501657db)). On a controller the third draft card shared B with pause, and pause is the first thing play asks for, so the press opened the pause screen. The shell reserve is an `i32` with no cap unless Forced March imposes one, and a Standing Orders streak pays a bonus that grows on every one-shot clear. Past `i32::MAX` that add panics in a debug build and wraps negative in a release build. A negative reserve is out of shells.

## The press was taken by pause

A press is taken by the first action that asks for it. Two actions bound to the same button in the same mode never both fire. `input.rs` says the order the core asks in is part of the behaviour, and `take_pad` removes the press it reports.

`handle_play_input` asks for pause, then for a draft pick, then for aim and fire. Pause wins, and the function returns:

```rust
/// A run in play: pause, draft picks, then aim, fuse, reposition and fire.
pub(super) fn handle_play_input(&mut self, delta: f64) {
    if self.action_pressed(Action::Back) {
        self.input.touch.cancel_drag();
        self.mode = Mode::Paused;
        return;
    }
```

The draft ask is the next block, over `Draft1`, `Draft2` and `Draft3`, and it returns too. Back's default pad button is B. Draft 3's was B too. Keys 1, 2 and 3, and a tap on the card, never went through that button.

```rust
Action::Draft1 => ("1", "X"),
Action::Draft2 => ("2", "A"),
Action::Draft3 => ("3", "B"),
Action::Back => ("ESCAPE", "B"),
```

Pad A is also fire. That one works: the draft is asked before fire, the pick is taken, and the function returns. Pad B lost, because pause is asked before the draft and the function returns there. The third offer stayed on the table, and the pause screen opened over a draft that was still open.

Draft 3 is now Y. The comment on the binding is the reason Y is free while a draft is up:

```rust
// Y, not B. Pause is B and is read before a draft pick, so a third
// offer bound to B never took: the press opened the pause screen.
// Y is free on the draft (reposition, replay and star read it on
// other screens).
Action::Draft3 => ("3", "Y"),
```

B still pauses. The settings screen used to show a draft as two buttons, one row of an action plus an optional second, so it listed X and A and left the third off. The draft row now carries all three actions, which with the defaults reads X/A/Y. With a controller in use, before the draft has been learned, the prompt is `X A Y  PICK A MODIFIER`. A touchscreen still says `TAP A CARD  PICK A MODIFIER`. The README row is `1 / 2 / 3`, `X / A / Y`, tap a card, and B still pauses.

`in_a_draft_pad_b_pauses_and_y_takes_the_third_card` presses B, sees `Mode::Paused` with the phase still `Drafting` and zero stacks of the third offer, presses B again to resume, then presses Y. The loadout has that offer and the phase has left the draft.

## The reserve stopped at the top of an `i32`

`Loadout::cap` is `i32::MAX` unless a modifier imposes one. Forced March drops it to 15. The comment on `cap` keeps the default open on purpose: a 40-shell ceiling would eat most of a Depot on the first draft, and Depot, Storm Front and Quartermaster would stop being worth taking. Standing Orders reads "One-shot clears grant +1 per consecutive streak." The streak is a `u32`. A one-shot clear increments it and adds that count to the shells paid for the screen.

The old grant was a plain add, then the cap:

```rust
self.shells = (self.shells + n).min(self.loadout.cap());
```

and the streak was a plain increment, then a cast:

```rust
self.one_shot_streak += 1;
if self.loadout.standing_orders() {
    gain += self.one_shot_streak as i32;
}
```

`i32` addition panics on overflow in debug and wraps in release. A reserve at or below zero is `Phase::Over(RunOver::OutOfShells)`, checked when a shot fails to clear and again when the run advances after a clear. That is the only way a run ends. Casting a streak above `i32::MAX` wraps too, so the bonus itself could arrive negative. A streak already at `u32::MAX` wraps to 0 on `+= 1` in release, and panics in debug.

A debug panic is the error screen. The hook writes `user://crash.txt`, and the next frame draws `SOMETHING BROKE` / `THE GAME STOPPED RATHER THAN CARRY ON WRONG.` Anything that writes, moves or deletes a file is dropped after a panic, so the half-updated run is not saved over the last good one. The report is the last file that session writes.

Grants now saturate, then the cap still applies. The supply screen's +6 goes through `grant` too, instead of its own `shells + 6`. The streak saturates at `u32::MAX`, and the bonus is the streak as an `i32`, or `i32::MAX` when it does not fit:

```rust
fn grant(&mut self, n: i32) {
    // An uncapped reserve plus Standing Orders grows without a ceiling.
    // A wrapping add would panic in debug and, in release, turn a huge
    // reserve negative and end the run. Stop at `i32::MAX`, then apply
    // the cap (`i32::MAX` when nothing has imposed one).
    self.shells = self.shells.saturating_add(n).min(self.loadout.cap());
}
```

```rust
self.one_shot_streak = self.one_shot_streak.saturating_add(1);
if self.loadout.standing_orders() {
    let bonus = i32::try_from(self.one_shot_streak).unwrap_or(i32::MAX);
    gain = gain.saturating_add(bonus);
}
```

`the_reserve_stops_at_i32_max_instead_of_wrapping` takes a Depot, which grants 8 shells, at `i32::MAX - 1` and stops at `i32::MAX`. `a_huge_one_shot_streak_does_not_wrap_the_reserve` starts from 20 shells with Standing Orders and `one_shot_streak` already `u32::MAX`, clears the screen in one shot, and expects `i32::MAX` shells, the streak still at `u32::MAX`, and the run not over.

## The golden-run digest stayed

`SIM_EPOCH` versions the sim's outcomes. A change that alters a replay bumps it. `tests/golden_runs.rs` hashes the golden-run corpus and requires that epoch's digest. Epoch 6's is `0x0e22_2e08_a33e_af8a`. This fix leaves the epoch at 6. Adds that stay inside the type are the same values as before, and the pull request records that the golden-run digest did not move.

Same standard as the [track solver](/blog/track-solver-a-third-faster-same-answers/) the same day. There, a faster proof was only allowed through if every timer and every failure stayed put, and a saved digest was the check.

The artillery digest is a different number from the Drone Trial digest. [saltline#173](https://github.com/cascadiacollections/saltline/pull/173) runs `trial_determinism` in the sim job, the Android emulator job and the iOS simulator job, and uploads `trial-digest-<platform>.txt` beside the artillery file. Each set is compared with itself. The pull request records a local run of that bin: 200 replays, 139 hits, zero divergences, `digest: 0xff8e006571cf0da1`. `just android-digest` on a phone still runs the artillery binary only.
