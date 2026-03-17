# luci-app-starlink

LuCI dashboard for Starlink dish telemetry, alignment, alerts, IPv6 connectivity, traffic, and router configuration on OpenWrt 25.x.
Works with Starlink Gen3 and higher dish

![Starlink Dashboard](docs/screenshot.png)

---

## Features

- **Dish Telemetry** — state, uptime, latency, packet drop, obstruction %, throughput, SNR, GPS satellites, Ethernet speed, hardware/software version
- **Alignment** — tilt and rotation guidance (↑↓ / ↻↶) with "well aligned" confirmation when within 0.1°
- **Alerts** — 11 health indicators matching the Starlink app (heating, thermal throttle, shutdown, PSU throttle, motors, mast, slow Ethernet, software update, roaming, obstruction, disabled)
- **IPv6 Connectivity** — WAN address, LAN address, delegated /56 prefix, default route
- **Traffic** — WAN and LAN byte/packet counters
- **Quality** — latency to 8.8.8.8 / 1.0.0.1, conntrack usage, router uptime
- **Configuration** — TCP congestion control, qdisc, flow offloading, MTU fix, DHCPv6-PD lifetime settings
- **Turn Starlink Config On** button — applies full optimal Starlink IPv6 config (DHCPv6-PD, odhcpd lifetime fix, DNS, NTP, firewall, kernel tuning) with one click; shows green "✓ Starlink Config Active" when all settings are verified, reverts if any setting drifts
- **Reboot Dish** button with confirmation dialog

Auto-refreshes every 10 seconds.

Note: The alignment data provided is direct from the dish API and after confirming with star-link support is more accurate than the phone app that incorrectly reports over 6 degrees misalignment and should be ignored if the dish reports its aligned.
---

## One-Click Optimal Starlink IPv6 Configuration

The **Configuration** card includes a **Turn Starlink Config On** button that applies the full recommended OpenWrt setup for Starlink residential with a single click — no SSH or command line needed.

### What it configures

| Area | Setting |
|------|---------|
| **IPv6 WAN** | DHCPv6-PD with `reqprefix=auto`, `ip6assign=64`, `peerdns=0` |
| **odhcpd prefix lifetimes** | `max_preferred_lifetime=3600`, `max_valid_lifetime=7200` — fixes Starlink's ~129s/~279s prefix lifetimes that cause constant IPv6 address churn on LAN clients |
| **DNS** | Cloudflare (1.1.1.1 / 1.0.0.1) + Google (8.8.8.8 / 8.8.4.4), IPv4 and IPv6, peerdns disabled |
| **NTP** | Adds Starlink dish (`192.168.100.1`) as GPS Stratum 1 source (~85–123µs accuracy) |
| **Firewall** | Software flow offloading enabled, hardware offloading disabled (keeps fq_codel active), MSS clamping (`mtu_fix=1`) for both ingress and egress |
| **TCP congestion control** | `hybla` (satellite-optimised, RTT-compensating) with automatic fallback to CDG → BBR → cubic |
| **Kernel / sysctl** | `fq_codel` default qdisc, `tcp_fastopen=3`, `tcp_mtu_probing=2`, `accept_ra=2` (required for IPv6 when forwarding=1), conntrack timeouts from official Starlink Gen2 firmware |

### Button states

| State | Meaning |
|-------|---------|
| 🔵 **Turn Starlink Config On** | Config not yet applied, or a setting has been changed since last apply |
| 🟡 **⟳ Applying…** | Script running in background (~30–45s) |
| 🟢 **✓ Starlink Config Active** | All settings verified correct |

The dashboard checks the configuration on every 10-second refresh. If any watched setting is changed (via LuCI, UCI, or SSH), the button reverts to blue within 10 seconds so you can re-apply.

---

## Related

This package is designed to work alongside [starlink-openwrt-ipv6-optimized](https://github.com/bigmalloy/starlink-openwrt-ipv6-optimized) — a companion guide and configuration reference for setting up OpenWrt as a Starlink bypass router, covering IPv6, odhcpd prefix lifetime fixes, firewall, congestion control, and more.

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| OpenWrt 25.x | Uses `apk` package manager; tested on 25.12.0 |
| Architecture | `aarch64_cortex-a53` (GL-iNet Beryl AX / MT3000) — PKGARCH=all so works anywhere |
| `luci-base` | LuCI web interface |
| `rpcd` | RPC daemon (usually pre-installed) |
| `jsonfilter` | JSON parser for shell scripts |
| `grpcurl` | Required for dish telemetry — **installed automatically by the APK from v1.0.0-r5** (downloaded to `/usr/bin/grpcurl` during `apk add`) |

---

## Installation

Download the latest `.apk` from [Releases](../../releases).

```sh
# Copy to router
scp -O luci-app-starlink-1.0.0-r6.apk root@192.168.1.1:/tmp/

# Install (no key verification needed for local install)
ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/luci-app-starlink-1.0.0-r6.apk'
```

The post-install script automatically downloads and installs `grpcurl`, then restarts `rpcd` and `uhttpd`. Navigate to **Network → Starlink** in the LuCI menu.

> **Note:** From v1.0.0-r5, grpcurl is downloaded and installed automatically during `apk add`. No manual steps required. If the download fails (no internet access), run `/usr/bin/install-grpcurl` manually once connected.
>
> **Note:** From v1.0.0-r6, the **Turn Starlink Config On** button in the Configuration card applies the full recommended Starlink IPv6 setup directly from LuCI — no SSH or manual script execution needed.

---

## Build from Source

Requires Docker.

```sh
git clone https://github.com/bigmalloy/openwrt-starlink-control
cd openwrt-starlink-control
./build-apk-docker.sh
# Output: output/luci-app-starlink-*.apk
```

The build uses the official `openwrt/sdk:aarch64_cortex-a53-25.12.0-rc5` Docker image.

---

## Hardware Tested

| Device | GL-iNet Beryl AX (MT3000) |
|--------|---------------------------|
| SoC | MediaTek MT7981B |
| OpenWrt | 25.12.0 |
| Starlink | Gen3 dish (rev4_panda_prod2) |
| ISP | Starlink Residential (AU) |

---

## Buy me a beer

If this project saved you some time, feel free to shout me a beer!

[![PayPal](https://img.shields.io/badge/PayPal-Buy%20me%20a%20beer-blue?logo=paypal)](https://paypal.me/bergfirmware)

---

## License

MIT
