---
published: 2026-11-30T16:00:00Z
title: Unset scope made a mouse the computer's battery
description: Some Linux drivers never write power_supply scope, so a wireless mouse was read as the computer's battery. A desktop with only that supply was capped.
tags:
  - gamedev
  - tips
---

# A mouse battery with no scope was the computer's battery

[godot-device-power#29](https://github.com/KevinTCoughlin/godot-device-power/pull/29) skips a Linux supply whose sysfs `scope` is `Device`. A missing `scope` still counted as the machine. That is how a laptop battery and a mains adapter usually appear, and it is how a wireless mouse or controller was read when its driver wrote no `scope`. A desktop whose only battery was that mouse was held to the battery cap, and a charging peripheral could make a laptop on battery look plugged in. The follow-up is [godot-device-power#34](https://github.com/KevinTCoughlin/godot-device-power/pull/34) ([`8d84335`](https://github.com/KevinTCoughlin/godot-device-power/commit/8d843358fc3cdb2fa6a9a280295f966603fb2993)).

## A missing scope still counted

`power_source_from_supplies()` dropped a supply when `scope` was `Device`. `System` and `Unknown` counted, and so did a supply with no `scope` file. Drivers that leave `scope` unset, on older kernels and out-of-tree, never hit that check.

[#34](https://github.com/KevinTCoughlin/godot-device-power/pull/34) passes the supply's name into one check, `is_peripheral()`. A `present` of `0` still drops the supply.

```gdscript
		var supply_name: String = key if key is String else ""
		if is_peripheral(supply_name, supply) or _field(supply, "present") == "0":
			continue
```

`Device` is still a peripheral. `System` is the machine's, taken at its word: `hidpp_battery_0` on the hid bus with `scope` of `System` stays the computer's battery. No `scope`, or `Unknown`, is a peripheral when the parent bus or the driver name says so. Anything else is still the machine's.

## The bus, then the name

The bus is the main signal. A laptop pack or adapter hangs off ACPI, platform, i2c or a USB-C port controller, not `hid`, `bluetooth` or `usb`. `_read_supplies()` stores that bus on a new `subsystem` field. The value is the last part of the parent `device/subsystem` link, so `../../bus/hid` is `hid`. Empty when there is no parent or the link is unreadable.

```gdscript
static func _read_subsystem(base: String) -> String:
	var device := DirAccess.open(base.path_join("device"))
	if device == null or not device.is_link("subsystem"):
		return ""
	return device.read_link("subsystem").get_file()
```

The name is the fallback when that link cannot be read. The prefixes are the ones the kernel's HID battery drivers use: hid-input, Logitech HID++, Sony and PlayStation controllers, Nintendo controllers, Wacom tablets, Wiimotes and Steam controllers.

```gdscript
const _PERIPHERAL_BUSES := {"hid": true, "bluetooth": true, "usb": true}
## Name prefixes the kernel's HID battery drivers use, for a supply whose
## [code]device[/code] link cannot be read: hid-input, Logitech HID++,
## Sony and PlayStation controllers, Nintendo controllers, Wacom tablets,
## Wiimotes and Steam controllers.
const _PERIPHERAL_NAME_PREFIXES: Array[String] = [
	"hid-",
	"hidpp_battery",
	"sony_controller_battery",
	"ps-controller-battery",
	"nintendo_switch_controller",
	"wacom_",
	"wiimote_",
	"steam-controller-",
]
```

`wacom_` also matches the tablet's own mains adapter. `wacom_ac_0` online, beside a discharging `BAT1`, stays on battery. The adapter is not the machine's mains.

```gdscript
static func is_peripheral(supply_name: String, supply: Dictionary) -> bool:
	var scope := _field(supply, "scope")
	if scope == "Device":
		return true
	if scope == "System":
		return false
	if _PERIPHERAL_BUSES.has(_field(supply, "subsystem")):
		return true
	for prefix: String in _PERIPHERAL_NAME_PREFIXES:
		if supply_name.begins_with(prefix):
			return true
	return false
```

UPower's DisplayDevice was the other way to separate a peripheral from the computer. It needs D-Bus and a daemon. This backend reads only sysfs, so I left DisplayDevice out.

## What the suite ran

`./scripts/run_tests.sh` reported 128 passed, 0 failed, on Godot 4.7.2 (macOS universal build, headless). With the bus and name checks removed, 3 of the 128 fail.

The new cases cover an unscoped supply on the hid, bluetooth, usb, acpi and platform buses, a match by name, a tablet's `wacom_ac_*` adapter, `Unknown` on hid, and `System` winning over both the bus and the name. One test builds a tree of `device` and `subsystem` symlinks under `/tmp` and writes no `scope` file. The mouse's bus reads as `hid` and the pack's as `acpi`. An unscoped charging mouse beside that discharging pack stays on battery. The mouse alone is unknown.

The buses and the names come from kernel driver sources. I have not checked them against a live `/sys/class/power_supply`.

## What I would repeat

- **A missing `scope` still needs a second look.** `Device` is a peripheral. `System` is the machine's, even when the bus is hid and the name is a controller's. No file, or `Unknown`, follows the bus and then the name.
- **Read the bus first.** `hid`, `bluetooth` and `usb` mark a peripheral. The name prefixes apply when the `device` link cannot be read.
- **The 128 did not open a live sysfs.** They passed on Godot 4.7.2's macOS build, headless. Removing the bus and name checks fails 3 of them.
