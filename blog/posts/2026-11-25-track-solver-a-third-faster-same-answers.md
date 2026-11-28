---
published: 2026-11-25T07:00:00Z
description: Every generated track is proven drivable before a player sees it. A late track costs about four million physics ticks.
tags:
  - performance
  - rust
---

# I Made My Track Solver a Third Faster Without Changing One Answer

I'm building a racing game in Rust and Godot, a sibling to [Salt Line](https://github.com/cascadiacollections/saltline). Every track in it is generated, and every generated track is proven drivable before a player sees it. Proving is slow: a late track costs about four million physics ticks, and a phone does that while the player looks at a menu.

I took 36 percent off the proving time. The solver accepts the same tracks, sets the same timers and reports the same failures as before, bit for bit. Here's how I found the time, and how I know nothing moved.

## The Short Version

|                                | Before   | After     |
| ------------------------------ | -------- | --------- |
| Batch of 54 tracks, one thread | 9.15 s   | 5.8 s     |
| Mean per track (360 tracks)    | 164 ms   | 106 ms    |
| Slowest track (360 tracks)     | 1,183 ms | 724 ms    |
| Custom layout proof, median    | 36 ms    | 21 ms     |
| Solver results                 |          | identical |

Those are from a 4-core x86-64 cloud machine, release build. I haven't measured a phone yet.

## What "Proven" Costs

A human-like bot drives the track sixteen times to set the checkpoint timer. A perfect bot drives it to find the best possible time, searching which corners to drift. A grip-only bot checks that each drift corner really needs a drift. Then the human-like bot drives it sixteen more times on every car the player could own by that point. A track that fails any of this is redrawn and the whole thing starts again.

The sim is deterministic across Linux, macOS, Windows and phones, and a daily run has to be the same tracks for everyone. So the rule for this work was strict: an optimisation that moves one timer by a quarter second isn't an optimisation. It's a different game.

## Save the Answers Before the First Edit

Before I touched anything, I saved the outputs I'd later diff against:

- the full report of a 40-seed batch: 360 tracks, with every accepted draw, rejection reason and margin
- the bundled courses, re-proven
- a survey of custom layouts
- the cross-platform determinism digest

After every change I ran them again and diffed, ignoring only the timing columns. That turned "I think this is equivalent" into a check that takes seconds.

## Where the Time Went

I profiled with callgrind, since `perf` wasn't available on the machine. The split was nearly even: 52 percent in the perfect bot's drift search, 46 percent in human trials. Per tick, three things stood out:

- **21 percent** building the list of obstacles ahead of the car.
- **9.5 percent** in `floor`. On x86-64 without SSE4.1, `f64::floor` is a library call, and finding the road segment under the car made it several times a tick.
- The human bot's look-ahead took a square root for every segment it could see, about thirty a tick.

## Cheaper Ticks

### A floor that wasn't needed

The segment index is `floor(z / 4)`, clamped to the track. At or past the first segment boundary, truncating to an integer is the floor. Below it, the answer is zero.

```rust
let q = z / SEG_LEN;
if q < 1.0 {
    0
} else {
    (q as u32 as usize).min(self.segments.len() - 1)
}
```

The cast goes through `u32` on purpose. Rust's float-to-integer casts saturate, and the saturating cast to `usize` is a longer instruction sequence than the one to `u32`. The clamp to the track length hides the difference.

A test checks the new form against the old one at every segment edge, at NaN, at both infinities and past 2⁶³.

### Stop dividing

A track is stored as small integers: milliradians of curve, centimetres of width. That's what makes it identical everywhere and cheap to hash. But the car, the race and the bots were converting those integers to metres on every tick. The track now keeps the converted floats beside the integers. They're the same expressions, computed once, so they're the same bits.

This was the change the profiler undersold. Callgrind counts instructions, and a division is one instruction. The stopwatch said 6 percent.

### One square root instead of thirty

The human bot wants the lowest of `sqrt(limit² + 2·decel·d)` over the road it can see. IEEE-754 square root is exactly rounded, and an exactly rounded function of one variable is monotonic: it can't reorder two values. So the root of the lowest is the lowest root, bit for bit. I take the minimum of the squares and then one root.

## Fewer Ticks

### Don't choose from one

Before setting the timer, the solver finds the weakest car the track can be met with, by running the perfect bot's full drift search on each. On the first two tracks of a run, and on every custom layout, there is exactly one car. The search ran anyway.

### Don't search twice

With several cars, the weakest one's search ran before the track had a timer, and then again after. The bot never reads the timer. So a timer can change a search in only one way: by stopping one of its drives, which then ranks last.

I record how late the search's drives reached each checkpoint. If the calibrated timer would have stopped none of them, a second search would make the same drives and pick the same plan, so I skip it and drive the plan once. If it would have stopped one, I search again as before. A test runs both paths against a full search on generated tracks, with timers from barely enough to generous.

### Don't re-plan the plan you have

At each corner the search tries drifting and gripping. The grip branch rebuilt the whole speed profile, which was already the grip profile.

## The Bug the Speed-Up Found

One test failed along the way. A layout walled off with rocks must fail to prove, and the test asserts that finding this out cost some ticks. It now reported zero.

A failed calibration had never reported the ticks it spent. The redundant search in front of it had been covering for that. Removing the waste exposed the gap, and I fixed it.

## What I Left Alone

After a drift search, the winning plan is driven once more to record its trace. Often that drive repeats the winning branch exactly, and I could prove when. But carrying a trace on every branch of the search costs about what skipping the drive saves.

The sixteen human trials per car are independent, so they'd thread. Track building already runs one proof per core, so I left them alone.

And arm64 has a `floor` instruction, so the first change will count for less on a phone. The rest doesn't care about the architecture.

## What I'd Check in Any Solver

- **Save the outputs you'll diff against before the first edit.** If the results are meant to be identical, make that a command, not a belief.
- **Measure instructions and time.** The profiler ranked the divisions and the cast low. The stopwatch ranked them high.
- **Prefer changes you can argue for in a sentence.** "Square root is monotonic", "truncation is the floor from 1 up" and "the bot never reads the timer" each fit in a code comment, and each is in one.
- **Look for work done to choose between one option.** It's easy to write a loop over candidates and never notice the list is usually one long.
- **Treat a test that breaks when you delete waste as a finding.** Redundant work hides bugs.
