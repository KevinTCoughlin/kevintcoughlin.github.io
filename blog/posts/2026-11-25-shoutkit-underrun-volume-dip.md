---
published: 2026-11-25T17:19:00Z
description: ShoutKit fades the volume in when a station rejoins. A buffer underrun looked like a rejoin, so the volume dropped to 1/14 and swelled back to full.
tags:
  - audio
  - ios
  - swift
---

# Why my radio app dipped to 1/14 volume on every network blip

In [ShoutKit](https://github.com/cascadiacollections/shoutkit) I fade `player.volume` in from silence when a station rejoins, so the live edge does not arrive as a click. A buffer underrun reports `.playing` again, and the rejoin fade treated that as a fresh start. The stream came back at full volume, the fade waited one step, then set the volume to 1/14 and swelled back to full. [shoutkit#274](https://github.com/cascadiacollections/shoutkit/pull/274) runs the fade only after the player was silenced.

## The rejoin fade

Live radio has no position to resume. After an interruption, a stall, or a dropped connection, playback rejoins the stream at the live edge. The first decoded frames at full volume read as a click or a jump-cut, so since 2026-08-20 `silenceForUpcomingPlayback()` has set `player.volume` to zero in `start`, `resume`, and `replayCurrentStream`, and `fadeInVolume()` has brought it back over 350 ms once AudioStreaming reports `.playing`.

The ramp is fourteen steps. The task sleeps, then sets `player.volume` to `Float(step) / Float(steps)`. The first assignment is 1/14. The last is 1.

```swift
static let volumeRampDuration = Duration.milliseconds(350)
static let volumeRampSteps = 14

let steps = Self.volumeRampSteps
let stepDuration = Self.volumeRampDuration / steps
for step in 1 ... steps {
    try? await Task.sleep(for: stepDuration)
    guard Task.isCancelled == false else { return }
    self.player.volume = Float(step) / Float(steps)
}
```

On a rejoin the volume was just zeroed, so that first step is silence becoming audible. On a player that is already at full volume, the same assignment is a dip.

## A buffer underrun reports .playing

`audioPlayerStateChanged` calls `fadeInVolume()` on every transition into `.playing`:

```swift
case .playing:
    self.fadeInVolume()
    self.reportStatus(.playing, generation: generation)
```

AudioStreaming also enters `.playing` when a buffer underrun ends. Nothing on that path calls `silenceForUpcomingPlayback()`, so the player is already at full volume. The old `fadeInVolume()` still cancelled any ramp in flight, waited one step, set the volume to 1/14, and climbed back to 1. On ordinary network jitter during a long listen, the stream returned and then dipped.

The cancel is its own problem. A `.playing` that arrives while a rejoin fade is still running would stop the task and leave `player.volume` wherever the ramp had reached, then start again at 1/14. Coming back from an underrun has to leave a fade that is already running alone.

## Arm the fade only after silence

`silenceForUpcomingPlayback()` still zeroes the volume, and it is the only call that arms a fade. `fadeInVolume()` runs the fourteen steps only when that arm is set. An unarmed `.playing` returns before it can cancel the task.

```swift
func silenceForUpcomingPlayback() {
    volumeRampTask?.cancel()
    volumeRampTask = nil
    volumeRampArm.arm()
    player.volume = 0
}

func fadeInVolume() {
    guard volumeRampArm.consume() else { return }
    volumeRampTask?.cancel()
    volumeRampTask = Task { @MainActor [weak self] in
        guard let self else { return }
        let steps = Self.volumeRampSteps
        let stepDuration = Self.volumeRampDuration / steps
        for step in 1 ... steps {
            try? await Task.sleep(for: stepDuration)
            guard Task.isCancelled == false else { return }
            self.player.volume = Float(step) / Float(steps)
        }
    }
}
```

`consume()` answers true once, then false until the next `arm()`:

```swift
mutating func consume() -> Bool {
    defer { isArmed = false }
    return isArmed
}
```

`start`, `resume`, and `replayCurrentStream` still call `silenceForUpcomingPlayback()` first, so a real rejoin still fades in. `VolumeRampArmTests` covers the arm: `consume()` is false, true once after `arm()`, and false again. The fade and the arm live in `AudioStreamingPlaybackEngine+VolumeRamp.swift`. The `.playing` case is in `audioPlayerStateChanged`.

## Also in that pull request

A station re-sends the current `StreamTitle` for the whole song, often about once a metadata interval, including while the app is backgrounded. When the lookup had produced neither artwork nor an Apple Music link, each repeat published again. That publication calls `onTrackHeard`, which writes listening history on the main actor, so a song the catalog does not know was a SwiftData fetch and save at that interval. The lookup still retries. An unchanged answer does not write history or the lock screen again. The first miss still publishes, because that `.resolved` push releases the artwork hold taken at the track boundary.

Old Shoutcast responses put their real headers in the body. `ICYInBodyHeaders` runs only when the HTTP response has two headers or fewer. It was ported from AudioStreaming's `IcycastHeadersProcessor` on 2026-11-14, including the part that passed each unfinished chunk straight through as audio. `URLSession` chooses the chunk sizes, so the first callback was often shorter than the block and was played as audio. A body that started with `ICY ` or `HTTP` and never sent a blank line kept every later byte for the rest of the session. The reader now holds bytes only while they might still be a header. A single audio byte that cannot be `ICY ` or `HTTP` is returned immediately. At 8 KB with no blank line, the buffer is released and treated as audio.
