---
published: 2026-11-25T17:18:00Z
tags:
  - gamedev
  - github-actions
  - rust
---

# A draft button that paused, and a shell count that wrapped

Two bugs in [Salt Line](https://github.com/cascadiacollections/saltline) were reachable from ordinary play. On a controller the third draft card was bound to B, which is also pause, and pause is read first, so the press opened the pause screen and the card was never taken. A very long Standing Orders streak could push the shell reserve past `i32::MAX`: a debug build panics onto the crash screen and writes no save, and a release build wraps the count negative, which the run reads as out of shells. I fixed both in [saltline#167](https://github.com/cascadiacollections/saltline/pull/167). Grants saturate. The golden-run digest is unchanged, so `SIM_EPOCH` stays 6.

## The third card was pause

A draft offers three modifiers. The controller defaults were X, A, and B. Keyboard is 1, 2, and 3, and touch taps the card. Keyboard and touch already took the third card.

B is also pause. Play input asks for pause before it asks for a draft pick, and key and pad presses are taken by the action that asks, so the order is the binding:

```rust
/// A run in play: pause, draft picks, then aim, fuse, reposition and fire.
/// Nothing but pause is read while a shot is being replayed or a clear
/// held.
pub(super) fn handle_play_input(&mut self, delta: f64) {
    if self.action_pressed(Action::Back) {
        self.input.touch.cancel_drag();
        self.mode = Mode::Paused;
        return;
    }
    let phase = self.play.run.as_ref().map(|r| r.phase);
    let Some(phase) = phase else { return };

    // A drag only aims on the screen it started on: drafting or a shot in
    // the air forgets it, so it can never drop into a later shot.
    if phase != Phase::Firing || self.play.anim.is_some() || self.play.clear_hold > 0.0 {
        self.input.touch.cancel_drag();
    }

    if phase == Phase::Drafting {
        for (i, action) in [Action::Draft1, Action::Draft2, Action::Draft3]
            .into_iter()
            .enumerate()
        {
            if self.action_pressed(action) {
                let taken = self.play.run.as_mut().and_then(|r| r.take_offer(i));
```

`Draft3` was B, so the press opened pause, the third offer stayed untaken, and the draft stayed open. Y is free while a draft is open. Reposition, replay, and the star read Y on other screens, and the draft branch returns before any of that. The third card is now Y. B still pauses.

The settings screen's DRAFT row lists all three buttons. With a controller in use the prompt is `X A Y  PICK A MODIFIER`.

The test presses B during a draft and checks three things: the mode is paused, the phase is still drafting, and the third offer has no stacks. B again resumes. Y takes that card and leaves the draft.

## The reserve stopped at the top of an i32

Shells are an `i32`. The reserve has no cap unless Forced March imposes one. Taking Forced March drops a reserve of 40 to 15 on the spot. Standing Orders adds the one-shot streak to the shells paid for a clear, and the streak grows by one on every one-shot clear. The grant was a plain add, then the cap:

```rust
self.shells = (self.shells + n).min(self.loadout.cap());
```

Past `i32::MAX` that panics in debug. A panic is the crash screen, and nothing is written after one, so the run on disk stays as it was. In release the add wraps. A negative reserve is out of shells: `shells <= 0` ends the run with `RunOver::OutOfShells`.

The streak counter had the same shape. It was a `u32` incremented with `+= 1`. In debug that panics at `u32::MAX`. In release it wraps to 0. The bonus was `one_shot_streak as i32`, and a streak past `i32::MAX` casts negative in debug and in release.

Grants, the supply screen's +6, and the streak bonus now saturate, and the cap still applies afterwards. With no cap imposed, the cap is `i32::MAX`.

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
if shots <= 1 {
    // Saturating: a streak that has already reached `u32::MAX` must
    // not wrap, and the bonus paid below must not wrap to a negative
    // shell count.
    self.one_shot_streak = self.one_shot_streak.saturating_add(1);
    if self.loadout.standing_orders() {
        let bonus = i32::try_from(self.one_shot_streak).unwrap_or(i32::MAX);
        gain = gain.saturating_add(bonus);
    }
} else {
    self.one_shot_streak = 0;
}
self.grant(gain);
```

A Depot taken at `i32::MAX - 1` stops at `i32::MAX`. Taking Depot once moves a reserve of 10 to 18, so that grant is 8 shells and the old add would have overflowed. A one-shot clear with Standing Orders and a streak of `u32::MAX`, starting from 20 shells and no cap, fills the reserve to `i32::MAX`, leaves the streak at `u32::MAX`, and the run is still going.

Anything a real run has reached is the same, so the golden-run digest did not move and `SIM_EPOCH` stays 6.

## CI compares the Drone Trial digest on its own

[saltline#173](https://github.com/cascadiacollections/saltline/pull/173) adds a second digest to CI. Drone Trial is on the title, and `trial_determinism` already replays 200 seeded rounds and prints a digest. CI compared the artillery digest. A replay break that existed only in the trial would still pass the matrix.

The sim job, the Android emulator job, and the iOS simulator job now run that binary beside the artillery one and upload a second file, `trial-digest-<platform>.txt`, in the same artifact. The determinism job compares the two sets separately. They are different numbers. Each set has to agree with itself: seven copies when the Apple jobs run, and fewer on a gameplay-only pull request, the same count the artillery set already uses.

`just android-digest` on a phone still runs the artillery binary. The emulator covers the trial on bionic.

I ran `cargo run --release -q -p salt-line-sim --bin trial_determinism` locally: 200 replays, 139 hits, zero divergences, `digest: 0xff8e006571cf0da1`, about five seconds. The Android emulator and the iOS simulator steps were left to CI. They spawn the second binary the same way they spawn the artillery digest.
