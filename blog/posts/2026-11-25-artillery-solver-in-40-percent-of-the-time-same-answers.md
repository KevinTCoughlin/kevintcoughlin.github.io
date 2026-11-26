---
published: 2026-11-25T09:00:00Z
tags:
  - performance
  - rust
---

# The Same Audit on a Second Game Found More: Salt Line's Solver in 40 Percent of the Time

Earlier today I wrote about [making my racing game's track solver a third faster without changing one answer](/blog/track-solver-a-third-faster-same-answers/). [Salt Line](https://github.com/cascadiacollections/saltline), its artillery sibling, has the same kind of prover, so I ran the same audit on it.

It came out better. The proof now takes about 40 percent of the time it did. It accepts the same screens, lists the same shots and reports the same flight times as before, bit for bit.

## The Short Version

|                                     | Before      | After     |
| ----------------------------------- | ----------- | --------- |
| Batch of 5,000 screens, one thread  | 10.4–11.2 s | 4.1–4.2 s |
| Generation gate, 4,000 screens      | 0.800 s     | 0.316 s   |
| Prove one screen solvable           | 28–109 µs   | 11–48 µs  |
| Generate one screen, proof included | 59–163 µs   | 31–69 µs  |
| Resolve one shot                    | 925 ns      | 566 ns    |
| Solver results                      |             | identical |

Those are from one pinned core of a 4-core x86-64 cloud machine, release build. The machine is noisy, so read the ratios and not the third digit. I haven't measured a phone, or arm64 at all.

## What "Proven" Costs

Salt Line never shows a screen it hasn't proven clearable. For each target, a solver sweeps forty flight times, solves each for the angle and power that would land there, and snaps the answer to what the player's dials can actually set. Then it flies every candidate through the game's own fixed-step integrator and applies the game's own damage code, because the closed form knows nothing about wind changes, ricochets or tunnelling. A screen needs three distinct shots per target. One that fails is redrawn, down a ladder that ends on level ground.

The sim is deterministic across Linux, macOS, Windows and phones, and a daily seed has to be the same game for everyone. So the rule was the same as last time: a speed-up that moves one result is a bug, not a trade-off.

## Save the Answers Before the First Edit

Before I touched anything, I saved everything that prints a solver result:

- the batch reports, for the default build and each of the five build shapes
- the balance reports and the salvage probe
- both determinism runs, with all 200 run hashes
- a throwaway dump of 57,675 lines: for 75 loadouts, the screen hash, the rung, and every candidate's shot with the exact bits of its flight times, on fresh screens and again after three shots of damage

The batch report had no per-screen detail, so I wrote the dump for the audit. After every change I ran all twelve files again and diffed them, ignoring one timing line.

## Where the Time Went

In the generation gate, 89 percent was the solver and 11 percent was building terrain. Inside the solver, 77 percent was flights, which I expected. I didn't expect this: **36 percent of the whole run was flying shots the solver had just flown.**

## Fewer Ticks

### Don't fly the same shot twice

The solver flew each candidate once to see whether it landed anywhere near the target. If it did, it handed the shot to the game's damage code on a scratch copy of the screen, so the proof could never drift from what the game does. That code flew the shot again.

The copy is identical to the screen until the damage is applied, and a flight depends only on the screen, the shot, the loadout and the fuse. The second flight could only repeat the first. I split "fire a shot" into "fly it" and "apply what flew" and gave the copy the flight the solver already had. That one change took about 45 percent off the full candidate count.

### Don't find every answer to use one

The attract demo, the autopilot and the challenge hint arcs all asked the solver for every shot that fells a target, then used the first. There can be over a hundred. The search visits shots in the same order whatever the limit, so stopping at the first gives the same shot. That went from about 600 µs to between 2 and 13 µs.

## Cheaper Ticks

### The same floor

The terrain lookup under the shell called `floor` on every step, and on x86-64 without SSE4.1 that's a library call. By the time the lookup reaches it, the position is known to be positive and inside the field, where truncating is the floor. Same lead as the racing game, same fix.

### Boxes the shell is nowhere near

Every step was swept against every target's box. Most steps are far from all of them. Skipping those took another fifth off the full count, and it was the one change I couldn't make the easy way. More on that below.

### Trig on 1,801 angles

The barrel has 1,801 positions. The solver's angle search asked for the sine and cosine of the same ones several thousand times per screen. They now come from a table that's filled on first use by the same computation.

### The same two hashes

Terrain noise hashed two lattice values for every sample. The terrain is sampled once per pixel column and a lattice cell is tens to hundreds of columns wide, so nearly every sample hashed the pair the one before it had. Each noise layer now remembers its last pair. A hash is a pure function of its inputs, so the remembered value is the value.

## The Change That Wasn't Obviously Safe

Skipping the box sweep sounds trivial. If a step is outside the bounding box of all the boxes, it can't hit one.

In exact arithmetic that's true. In floating point it isn't quite. The segment test divides two rounded differences, and for a step that ends within a rounding error of a box edge it can report a hit that exact arithmetic wouldn't. A plain bounding-box check would disagree with it there. It would be vanishingly rare, and it would break the rule.

So the skip only applies when both ends of the step are more than one unit clear of every box, and every number involved is below 2⁴⁰. With that much room, the segment test's own first failing clip has to reject the step: the two differences can't round to the same value, and the quotient can't underflow to zero. The argument is in a comment beside the code. A test checks it against the real segment test on the edges and their neighbouring floats, on NaN and infinities, and on 360,000 ordinary steps.

## The Bug My Own Test Found

In the racing game, removing waste exposed an old bug. Here the bug was mine.

My first draft of the terrain lookup panicked on a NaN position over a one-column field, where the old code returned NaN. Nothing in the game can produce that input. The test that compares the new lookup to the old one on awkward values produced it anyway, and the rule has no exception for inputs I think are impossible.

## What I Threw Away

Each of these looked good in the profiler and failed on the stopwatch.

- A hand-written `floor` with no library call removed 6.5 percent of instructions and no measurable time over forty runs.
- Inlining the terrain lookup was lost in the noise.
- Skipping the ground test when the shell is above all terrain made the run about 50 percent slower. Finding the highest ground for each shell cost more than the tests it saved.

## What I Left Alone

Nothing was reordered, no trial count or cap changed, and the solver is still single-threaded.

And as before, arm64 has a `floor` instruction, so the truncation will count for less on a phone. The rest doesn't care about the architecture.

## What Doing It Twice Taught Me

- **The biggest win was the same kind of thing both times.** Two pieces of code each did the careful thing without knowing the other had. A profiler finds that in minutes.
- **If the tool that prints your results has no detail, write one that does.** I couldn't have trusted a summary histogram to notice one changed shot.
- **"Obviously equivalent" is a claim about real numbers.** The bounding-box skip is true in maths and false in floats. A margin made it true in both.
- **Test the new form against the old on values you'd never pass.** That's where mine differed.
- **Believe the stopwatch over the profiler.** Two changes that removed instructions removed no time, and a third made the run slower.
