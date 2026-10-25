---
published: 2026-01-18T18:15:54Z
---

# Network-Aware Minecraft Server on macOS

I wanted my Minecraft server to automatically start when I connect to my home WiFi, gracefully shut down when I leave, and perform daily maintenance restarts like production game servers. Here's how I set it up on macOS.

## The Problem

Running a Minecraft server 24/7 on a laptop isn't practical. I wanted it to:

- Auto-start when connected to my home network ("HomeWiFi")
- Gracefully save and stop when disconnecting
- Restart daily with player warnings (like real game servers)
- Clean up old logs and crash reports automatically
- Work without manual intervention

## The Solution

A shell script (`mc-server-manager`) with LaunchAgents for network monitoring and scheduled restarts.

## WiFi Detection Gotcha

The commonly recommended approach:

```bash
networksetup -getairportnetwork en0
```

**Returns "not associated" on 6GHz WiFi networks**, even when connected. This is a known bug on newer macOS versions with WiFi 6E.

The fix is to use `system_profiler` instead:

```bash
system_profiler SPAirPortDataType | \
    awk '/Current Network Information:/{getline; gsub(/^[[:space:]]+|:$/,""); print; exit}'
```

This correctly returns the SSID regardless of which band you're connected to.

## Configuration

All settings live in `~/.config/mc-server/config`:

```bash
# Network
TARGET_SSID="HomeWiFi"

# Server
SERVER_DIR="$HOME/Development/minecraft/minecraft-server/server"
SESSION_NAME="minecraft-server"

# JVM Memory
MIN_RAM="4G"
MAX_RAM="4G"

# Scheduled restart (24h format, local time)
RESTART_ENABLED="true"
RESTART_HOUR="00"
RESTART_MINUTE="00"
RESTART_TIMEZONE="America/Los_Angeles"

# Warning intervals before restart (seconds)
RESTART_WARNINGS="300 60 30 10 5"
```

## JVM Optimization

The script uses modern Aikar's flags optimized for Paper 1.20+ on Java 21:

```bash
build_jvm_flags() {
    local flags=(
        "-Xms${MIN_RAM}" "-Xmx${MAX_RAM}"

        # G1GC optimized for Minecraft's allocation patterns
        "-XX:+UseG1GC"
        "-XX:+ParallelRefProcEnabled"
        "-XX:MaxGCPauseMillis=200"
        "-XX:+UnlockExperimentalVMOptions"
        "-XX:+DisableExplicitGC"
        "-XX:+AlwaysPreTouch"

        # G1GC region sizing
        "-XX:G1NewSizePercent=30"
        "-XX:G1MaxNewSizePercent=40"
        "-XX:G1HeapRegionSize=8M"
        "-XX:G1ReservePercent=20"
        "-XX:G1HeapWastePercent=5"
        "-XX:G1MixedGCCountTarget=4"

        # G1GC tuning
        "-XX:InitiatingHeapOccupancyPercent=15"
        "-XX:G1MixedGCLiveThresholdPercent=90"
        "-XX:G1RSetUpdatingPauseTimePercent=5"
        "-XX:SurvivorRatio=32"
        "-XX:MaxTenuringThreshold=1"
        "-XX:+PerfDisableSharedMem"

        # Debug helpers (no perf impact)
        "-XX:+HeapDumpOnOutOfMemoryError"
        "-XX:HeapDumpPath=$DATA_DIR/heapdump.hprof"
    )
    echo "${flags[*]}"
}
```

Key points:

- **G1GC** is ideal for Minecraft's bursty allocation patterns
- **AlwaysPreTouch** pre-allocates memory for consistent latency
- **HeapDumpOnOutOfMemoryError** saves a dump for debugging if OOM occurs
- Match min/max RAM to avoid heap resizing during gameplay

## Scheduled Restarts

Like production game servers, the script supports scheduled restarts with player warnings:

```bash
restart_server() {
    local reason="${1:-Scheduled maintenance}"

    # Warnings at 5m, 1m, 30s, 10s, 5s
    for secs in 300 60 30 10 5; do
        server_say "[RESTART] Server restarting in $(format_duration $secs) - $reason"
        sleep_until_next_warning
    done

    server_cmd "save-all"
    server_say "[RESTART] Restarting NOW!"
    server_cmd "stop"

    # Wait for graceful shutdown, then cleanup and restart
    cleanup_server
    start_server
}
```

The `cleanup_server` function handles maintenance:

- Removes logs older than 7 days
- Removes crash reports older than 30 days
- Clears stale session locks

## LaunchAgents

Two LaunchAgents handle automation:

### Network Monitor

`com.user.minecraft-server-network` - Triggers on WiFi changes:

```xml
<key>WatchPaths</key>
<array>
    <string>/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist</string>
    <string>/Library/Preferences/SystemConfiguration/NetworkInterfaces.plist</string>
</array>
<key>StartInterval</key>
<integer>60</integer>
```

### Scheduled Restart

`com.user.minecraft-server-restart` - Daily at midnight:

```xml
<key>StartCalendarInterval</key>
<dict>
    <key>Hour</key>
    <integer>0</integer>
    <key>Minute</key>
    <integer>0</integer>
</dict>
```

## Usage

```bash
mc-server-manager status    # Show server state, network, config
mc-server-manager start     # Start server
mc-server-manager stop      # Graceful stop with save
mc-server-manager restart   # Full restart with 5m/1m/30s/10s/5s warnings
mc-server-manager quick     # Quick restart (10s warning)
mc-server-manager attach    # Attach to console (Ctrl+B,D to detach)
mc-server-manager config    # Print current config
mc-server-manager cleanup   # Run maintenance manually
mc-server-manager logs      # Tail manager log
```

Example output from `status`:

```
=== Minecraft Server ===
Server running: yes
Network: HomeWiFi (target: HomeWiFi)
Session: minecraft-server
Attach: tmux attach -t minecraft-server

=== Scheduled Restart ===
Enabled: true
Time: 00:00 (America/Los_Angeles)
Warnings: 300 60 30 10 5

=== Config ===
File: ~/.config/mc-server/config
JVM: 4G - 4G
```

## Why tmux over screen?

macOS ships with screen 4.00.03 from 2006. It lacks features like `-Logfile` and has quirks with detached sessions. tmux is actively maintained, has better scripting support, and integrates well with the rest of my workflow.

## Files

| File                                                             | Purpose                      |
| ---------------------------------------------------------------- | ---------------------------- |
| `~/.local/bin/mc-server-manager`                                 | Management script (v1.1.0)   |
| `~/.config/mc-server/config`                                     | Configuration                |
| `~/Library/LaunchAgents/com.user.minecraft-server-network.plist` | Network monitor              |
| `~/Library/LaunchAgents/com.user.minecraft-server-restart.plist` | Scheduled restart            |
| `~/.local/share/minecraft-server/manager.log`                    | Manager logs                 |
| `~/.local/share/minecraft-server/heapdump.hprof`                 | OOM heap dump (if triggered) |

## Setup

```bash
# Load the agents
launchctl load ~/Library/LaunchAgents/com.user.minecraft-server-network.plist
launchctl load ~/Library/LaunchAgents/com.user.minecraft-server-restart.plist

# Generate a config file
mc-server-manager config > ~/.config/mc-server/config

# Edit to taste
vim ~/.config/mc-server/config
```

Now the server manages itself: starts on home WiFi, stops when leaving, restarts nightly with cleanup, and warns players before any restart.
