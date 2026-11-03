---
published: 2026-10-26T14:17:02Z
updated: 2026-11-01T19:03:06Z
---

# Fixing a Black HDMI Picture on My LG C2 After Installing CleanYourTV

I customized my downstairs LG C2 with CleanYourTV. The next morning, my Apple TV would turn on, but selecting its HDMI input left me staring at a black screen.

The TV could see the Apple TV. It could see a video signal. It still wasn't putting that video on the screen.

Here's what I checked over SSH, what restored the picture, and the boot workaround I installed afterward.

**Update:** The boot workaround has held through a cold boot. I also went back and traced the stale subscription live, and tried to bring back the black screen without the workaround. See [Tracing the stale subscription](#tracing-the-stale-subscription) for what that did and didn't prove.

## The Setup

- LG C2, model OLED77C2AUA
- Firmware 33.31.68
- webOS SDK 10.3.1
- CleanYourTV replacing LG's Home launcher
- Apple TV connected to HDMI 1
- Existing root SSH access to the TV

These details matter. This is a report from one TV and one firmware combination, not a fix for every LG black screen.

[CleanYourTV](https://github.com/lasharor/cleanyourtv-WebOS) customizes a rooted webOS TV. Its Home takeover uses writable files and temporary mounts, and on the configuration installed on my TV, it restarts LG's system app manager, SAM. The project's [TV changes documentation](https://github.com/lasharor/cleanyourtv-WebOS/blob/main/docs/tv-changes.md) explains the boot setup. Check your installed scripts too; upstream code can change.

## First, Wake the Apple TV

The first SSH check said the Apple TV was connected, but its CEC power state was `Off` and there was no HDMI signal.

Pressing Home on the Apple TV remote changed that:

```json
{
  "hdmiPlugIn": true,
  "hdmiSignalExist": true,
  "cecPower": "On"
}
```

So a sleeping Apple TV wasn't the problem, or at least not all of it. The screen was still black.

## Check More Than the Selected Input

The following commands run **on the TV**, after logging in through your existing root SSH connection. The `</dev/null` redirect keeps `luna-send` from waiting on SSH's standard input.

```sh
# Connected devices and HDMI signal state
luna-send -n 1 -w 5000 \
  luna://com.webos.service.eim/getAllInputStatus '{}' </dev/null

# Which app LG considers foreground
luna-send -n 1 -w 5000 \
  luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null

# Media pipelines and their foreground state
luna-send -n 1 -w 5000 \
  luna://com.webos.media/getActivePipelines '{}' </dev/null

# What is actually connected to the display's video output
luna-send -n 1 -w 5000 \
  luna://com.webos.service.videooutput/getStatus '{}' </dev/null

# Mute state for each media context
luna-send -n 1 -w 5000 \
  luna://com.webos.service.avmutemanager/getMuteInfo '{}' </dev/null
```

The results disagreed with each other:

| Check                | Before recovery                  | After recovery                           |
| -------------------- | -------------------------------- | ---------------------------------------- |
| Apple TV power       | On                               | On                                       |
| HDMI 1 signal        | Present                          | Present                                  |
| Foreground app       | `com.webos.app.hdmi1`            | `com.webos.app.hdmi1`                    |
| HDMI media pipelines | Not foreground                   | Foreground                               |
| Main video output    | Disconnected, no source assigned | HDMI 1, 3840 × 2160, 60 Hz, Dolby Vision |
| HDMI picture mute    | Active                           | Unmuted (current context)                |

The selected input wasn't the whole story. LG's app manager considered HDMI 1 foreground, but the media service still treated its pipelines as background sessions, and the video output had nothing routed to its main display sink.

## The Recovery That Worked

I restarted the media service and reopened HDMI 1. Substitute the correct HDMI app if your source uses another port.

```sh
systemctl restart umediaserver
sleep 3

luna-send -n 1 -w 5000 \
  luna://com.webos.applicationManager/closeByAppId \
  '{"id":"com.webos.app.hdmi1"}' </dev/null

sleep 2

luna-send -n 1 -w 5000 \
  luna://com.webos.applicationManager/launch \
  '{"id":"com.webos.app.hdmi1"}' </dev/null
```

This interrupts media playback. It doesn't reset the TV or erase its settings.

Afterward, the main output was connected to HDMI 1 at **3840 × 2160, 60 Hz, Dolby Vision**. The media pipelines became foreground sessions, and the mute manager reported the current session's picture and audio unmuted.

I checked the screen. Apple TV was back.

One diagnostic gotcha: `videooutput/getStatus` still showed its own `muted` flag as true. Older media contexts also remained in the mute manager's list. Match mute information to the **current output context**, and confirm the picture on the TV. One boolean isn't enough.

## What Happened

The CleanYourTV boot log (`/tmp/cleanyourtv-boot.log`, timestamps in seconds since boot) showed:

```text
24.37 home: mounting the launcher over LG's Home, restarting sam
24.67 home: sam restarted
25.68 after-sam: webOS SDK 10.3.1, Home 'com.webos.app.home flutter', services: none
```

Each process's start time is field 22 of `/proc/<pid>/stat`, in clock ticks since boot (100 per second here):

```sh
cut -d ' ' -f 1,2,22 /proc/$(pidof umediaserver)/stat /proc/$(pidof sam)/stat
```

```text
2551 (umediaserver) 1022
3940 (sam) 2466
```

The media service started about 10.2 seconds after boot. SAM's current instance started at 24.66 seconds, matching the restart in the boot log. So the media service was the original process from before the SAM restart, still running more than an hour and a half later when I investigated. Restarting that service and reopening the input repaired the disagreement between app foreground state and media routing.

That matches what I saw: the media service never heard about the SAM restart, and it kept treating HDMI as background even after SAM brought HDMI 1 to the foreground.

### Tracing the stale subscription

A week later I went back to find the specific subscription. `ls-monitor -s` lists every subscription on webOS's Luna bus, and `ls-monitor -l` maps bus names to processes. Inside `umediaserver`, a client called `com.webos.media.appobserver` subscribes to two SAM methods:

```text
com.webos.applicationManager foregroundAppsEx  <- com.webos.media.appobserver  {"extraInfo":true, "subscribe":true}
com.webos.applicationManager getAppLifeStatus  <- com.webos.media.appobserver  {"subscribe":true}
```

`foregroundAppsEx` is how the media service learns which app is in the foreground. I briefly turned the workaround off, restarted only SAM, and listed subscriptions again:

```text
com.webos.applicationManager getAppLifeStatus  <- com.webos.media.appobserver  {"subscribe":true}
```

The app observer re-subscribed to `getAppLifeStatus` but never to `foregroundAppsEx`. A minute later it still hadn't. Restarting `umediaserver` brought both subscriptions back.

That is the stale subscription: after a SAM restart, the media service stops receiving foreground-app updates until it is restarted itself.

### Trying to bring the black screen back

Next I tried to recreate the original failure with the workaround off. For each test I checked the media pipelines and the main video output over SSH, and looked at the screen:

| Test                                                                                                         | `foregroundAppsEx` | HDMI 1 picture |
| ------------------------------------------------------------------------------------------------------------ | ------------------ | -------------- |
| Restart only SAM, reopen HDMI 1                                                                              | Missing            | Fine           |
| Reboot (same boot order as the incident: media service at 10.3 s, SAM restarted at 33.9 s), switch to HDMI 1 | Missing            | Fine           |
| From that boot: TV off with the LG remote, wake with the Apple TV remote over CEC                            | Missing            | Fine           |

The stale subscription showed up every time, including on a real boot. The black screen never did. The last test is the closest match to the original morning: the TV sat in standby with a stale media service, and the Apple TV woke it. Standby doesn't restart webOS, so the same `umediaserver` process carried through.

So here's where it stands:

- **Proven:** a SAM restart leaves `umediaserver` without its `foregroundAppsEx` subscription, and only restarting `umediaserver` restores it. Every CleanYourTV boot on this TV restarts SAM.
- **Proven:** on the morning of the incident, restarting `umediaserver` and reopening HDMI 1 fixed a disconnected main output.
- **Not proven:** that the missing subscription caused the black screen by itself. In my tests the TV handled HDMI without it, so something else was also involved that morning. A long standby, a particular CEC handshake, or a timing race are all possible, but I couldn't reproduce it on demand.

That also changes how to read the cold-boot result. HDMI came up fine with the workaround, but it came up fine without it too. I'm keeping the workaround anyway. It's cheap, it makes the stale subscription impossible, and it's the same restart that fixed the real failure. I've only seen this on SDK 10.3.1, and it doesn't mean every CleanYourTV installation is affected.

## Preparing for the Next Boot

The installed CleanYourTV version already had an `after-sam.sh` hook. It asks `tvprofile.js` which running services need restarting after SAM.

On this TV, that decision returned an empty string. I changed the `afterSam` rule in `/media/developer/cleanyourtv/tvprofile.js` to return `umediaserver` for **SDK 10.3.1 only**:

```js
// before
afterSam: (major > 0 && major < 7) || /\snative$/.test(homeKind) ? 'eim webapp-mgr preload-manager memorymanager' : '',

// after
afterSam: f.sdk === '10.3.1' ? 'umediaserver' : (major > 0 && major < 7) || /\snative$/.test(homeKind) ? 'eim webapp-mgr preload-manager memorymanager' : '',
```

Other SDK decisions and the existing legacy service rule stay intact. The existing boot hook then restarts the media service before opening Home. This changes a file under `/media/developer/cleanyourtv`, not the read-only firmware.

I saved the original profile first. Rolling back means restoring that copy; the rollback takes effect on the next boot.

The updated JavaScript passed a syntax check using the TV's own runtime, and the TV returned the expected boot decision.

Since then, the TV has cold-booted with the workaround in place and HDMI came up normally (though, as the tests above show, that alone doesn't prove the workaround is what prevents the failure). Restarting a shared media service can affect other boot media clients, so I kept the workaround specific to the SDK I observed.

A CleanYourTV update can replace the modified profile. After updating, check whether the upstream version addresses the issue before reapplying a local change.

## What I'd Check Next Time

1. Wake the source and verify there is an HDMI signal.
2. Check the foreground app.
3. Compare that with the media pipelines and main video output.
4. If the signal is present but routing is disconnected, restart `umediaserver` and reopen the input (see above).
5. Confirm the picture physically before calling it fixed.

I used Codex to collect the SSH diagnostics, work through the recovery, and prepare the local boot workaround. What cracked it was comparing what each service believed: the input was selected; the video just wasn't being routed to the screen.
