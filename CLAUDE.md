# CLAUDE.md — openwrt-starlink

Comprehensive OpenWrt knowledge base for Starlink residential on GL-iNet Beryl AX (MT3000).
Distilled from live testing, official Starlink Gen2 firmware source, and OpenWrt documentation.

---

## Hardware

| Item | Value |
|------|-------|
| Device | GL-iNet Beryl AX (MT3000) |
| SoC | MediaTek MT7981B (Filogic 820) |
| CPU | 2× ARM Cortex-A53 @ 1.3 GHz |
| RAM | 512 MB |
| Flash | 128 MB NAND |
| Wi-Fi | MT7976C — 2.4 GHz 2×2 + 5 GHz 3×3 802.11ax |
| WAN device | `eth0` |
| LAN bridge | `br-lan` |

---

## Software

| Item | Value |
|------|-------|
| OpenWrt version | 25.12.0 |
| Target | mediatek/filogic |
| Architecture | aarch64_cortex-a53 |
| Kernel | 6.12.71 |
| Firewall | fw4 (nftables) |
| Package manager | `apk` (primary on 25.x; `opkg` still works) |
| Default qdisc | fq_codel (set via sysctl) |

---

## ISP — Starlink Residential (AU)

| Item | Value |
|------|-------|
| ASN | AS14593 |
| IPv4 | CGNAT (100.64.0.0/10) |
| IPv6 delegation | DHCPv6-PD /56 |
| AU prefix block | 2406:2d40::/32 |
| Example /56 | 2406:2d40:8aae::/56 |
| Example LAN /64 | 2406:2d40:8aae:1008::/64 |
| SLAAC | M=0, O=1 (SLAAC + stateless DHCPv6 for DNS) |
| Privacy extensions | RFC 4941 enabled on clients |
| DHCPv6-PD valid_lft | ~279s (very short — router must override for LAN) |
| DHCPv6-PD preferred_lft | ~129s (very short) |
| Gen3 dish gRPC | `192.168.100.1:9200` — SpaceX.API.Device.Device/Handle |

---

## Network Topology

```
Starlink dish
    |
    | delegates /56 via DHCPv6-PD
    v
OpenWrt WAN (eth0, wan6)
    proto=dhcpv6, reqprefix=auto, ip6assign=64
    |
    | sub-assigns /64 from /56
    v
br-lan (LAN bridge)
    odhcpd: RA server, max_preferred_lifetime=3600, max_valid_lifetime=7200
    |
    | SLAAC + stateless DHCPv6 (M=0, O=1)
    v
LAN clients
    e.g. 2406:2d40:8aae:1008:xxxx:xxxx:xxxx:xxxx/64
```

---

## Network Configuration (UCI)

### wan6 interface

```sh
uci set network.wan6=interface
uci set network.wan6.device='@wan'
uci set network.wan6.proto='dhcpv6'
uci set network.wan6.reqaddress='try'
uci set network.wan6.reqprefix='auto'
uci set network.wan6.peerdns='0'
uci set network.lan.ip6assign='64'
uci commit network
```

**ip6assign must be `64`, not `60`.** The Starlink Gen2 firmware uses `60` internally in
`config_generate` but that is irrelevant — it is the Starlink firmware managing its own
prefix assignment. An OpenWrt bypass router receives a /56 via DHCPv6-PD and needs to
sub-assign a /64 directly to the LAN. `60` would introduce an unnecessary intermediary layer.

### DNS (disable Starlink resolvers)

```sh
uci set network.wan.peerdns='0'
uci set network.wan.dns='1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4'
uci set network.wan6.peerdns='0'
uci set network.wan6.dns='2606:4700:4700::1111 2606:4700:4700::1001 2001:4860:4860::8888 2001:4860:4860::8844'
uci commit network
```

**Do not use 1.1.1.1 for ping monitoring** — the Starlink LAX4 CDN intercepts traffic to
1.1.1.1. Use 1.0.0.1 or 8.8.8.8 as ping targets in luci-app-statistics.

---

## odhcpd — Starlink Prefix Lifetime Fix

This is the most important fix. Starlink sends DHCPv6-PD prefix lifetimes of ~279s valid /
~129s preferred. Without intervention, odhcpd forwards these verbatim to LAN clients, causing
constant IPv6 address churn (addresses expire and regenerate every few minutes).

```sh
uci set dhcp.lan.ra='server'
uci set dhcp.lan.dhcpv6='server'
uci set dhcp.lan.ra_default='1'
uci set dhcp.lan.ra_lifetime='600'
uci set dhcp.lan.ra_maxinterval='60'
uci set dhcp.lan.ra_mininterval='30'
uci set dhcp.lan.max_preferred_lifetime='3600'
uci set dhcp.lan.max_valid_lifetime='7200'
# Clean up incorrect names from old configs (silently ignored by odhcpd):
uci -q delete dhcp.lan.preferred_lft || true
uci -q delete dhcp.lan.valid_lft || true
uci commit dhcp
service odhcpd restart
```

### Critical: correct odhcpd UCI option names

| Correct (works) | Wrong (silently ignored) |
|-----------------|--------------------------|
| `max_preferred_lifetime` | `preferred_lft` |
| `max_valid_lifetime` | `valid_lft` |

`preferred_lft` and `valid_lft` are NOT valid odhcpd UCI options. They are silently dropped,
meaning the fix is never applied. This was the root cause of address churn in earlier configs.

### RA interval rationale

- `ra_maxinterval=60` — fast Starlink renumbering propagation (default 600s is too slow)
- `ra_mininterval=30` — proportionally reduced minimum
- `ra_lifetime=600` — must be ≥ 3 × ra_maxinterval per RFC 9096 (3 × 60 = 180 minimum; 600 is safe)

### Lifetime fix scope

`max_preferred_lifetime` / `max_valid_lifetime` cap the lifetimes *advertised to LAN clients*
regardless of what Starlink sends the router. The router renews the prefix internally on
Starlink's schedule while clients see stable 1h/2h lifetimes.

This does NOT prevent renumbering if Starlink genuinely assigns a new prefix (dish reboot,
beam handoff). In that case LAN clients will get new addresses regardless.

---

## Firewall (fw4)

### Flow offloading

Hardware flow offloading (MediaTek NPU) bypasses the Linux qdisc layer entirely — fq_codel
is inactive when hardware offloading is enabled.

```sh
uci set firewall.@defaults[0].flow_offloading='1'
uci set firewall.@defaults[0].flow_offloading_hw='0'
uci commit firewall
```

Software offloading keeps packets in the Linux stack via a fast conntrack path; qdiscs apply.
The MT7981 handles 400–500 Mbps with software offloading — sufficient for Starlink residential.

### MSS clamping

**Bug:** `openwrt/openwrt#12112` — on OpenWrt 23.05 and earlier, `mtu_fix 1` only generated
an ingress MSS clamp rule (mangle_forward). Outbound TCP SYN packets left unclamped, causing
large downloads to stall on Starlink's encapsulated link (overhead reduces effective MTU below
1500).

**Fix:** firewall4 commit 698a533 (merged OpenWrt 24.10+). On 24.10 / 25.x, both rules are
generated automatically when `mtu_fix 1` is set.

```sh
uci set firewall.@defaults[0].mtu_fix='1'
uci commit firewall
service firewall restart
```

**Verify:**
```sh
nft list chain inet fw4 mangle_postrouting | grep maxseg   # egress
nft list chain inet fw4 mangle_forward | grep maxseg       # ingress
```

Both should show `tcp option maxseg size set rt mtu`. `rt mtu` uses the routing table MTU
dynamically — no hardcoded value needed.

### Drop-in nftables files are broken on 25.12

fw4 on 25.12 renders its entire ruleset as a single inline nftables script. A drop-in file
containing a top-level `table inet fw4 { }` block causes a syntax conflict — `service firewall
restart` fails with "unexpected table" errors. Do NOT use drop-in files on 25.12. Use `mtu_fix 1`.

On 23.05, if you must add the egress rule manually, use a nftables drop-in with a chain-only
block (no top-level table), but this is not needed on 24.10+.

---

## Kernel / sysctl

### Congestion control

The sysctl setting only affects TCP sessions *terminating at the router* (WireGuard, OpenVPN,
a local proxy, etc.). It has no effect on flows from LAN clients passing through NAT.

**Preference order:** hybla > cdg > bbr > cubic

```sh
AVAIL=$(cat /proc/sys/net/ipv4/tcp_available_congestion_control)
# Check what is available before setting
```

| Algorithm | Notes |
|-----------|-------|
| **hybla** | Satellite-optimised. Normalises congestion window growth against 25ms reference RTT, removing the structural RTT penalty that cubic/reno impose on high-latency links. Loss-based and fair. Install: `apk add kmod-tcp-hybla` |
| **cdg** | Delay-gradient. Theoretically good. **Not compiled into the mediatek/filogic kernel on OpenWrt 25.12.0** — unavailable on this target. |
| **bbr** | Bandwidth+RTT based. Probes aggressively; can be unfair toward cubic/reno flows on a shared bottleneck. Available as `kmod-tcp-bbr` but not preferred. |
| **cubic** | Default fallback. Standard loss-based. Penalises satellite RTT structurally. |

### Available congestion control modules (OpenWrt 25.x apk, mediatek/filogic)

- `kmod-tcp-hybla` — satellite-optimised RTT normalisation ✓ recommended
- `kmod-tcp-bbr` — bandwidth+RTT based
- `kmod-tcp-scalable` — high-speed cubic variant

### Full sysctl block

```
# TCP optimisation for satellite
net.core.default_qdisc = fq_codel
net.ipv4.tcp_congestion_control = hybla
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_mtu_probing = 2

# IPv6 — required for Starlink router mode
# accept_ra=2: Linux ignores RAs when forwarding=1; =2 overrides this so the
# router receives its upstream default route from Starlink via RA.
net.ipv6.conf.all.accept_ra = 2
net.ipv6.conf.default.accept_ra = 2
net.ipv6.conf.all.forwarding = 1
net.ipv6.conf.default.forwarding = 1

# Conntrack — timeouts from official Starlink Gen2 firmware sysctl.conf
net.netfilter.nf_conntrack_max = 65536
net.netfilter.nf_conntrack_tcp_timeout_established = 7440
net.netfilter.nf_conntrack_tcp_timeout_syn_sent = 60
net.netfilter.nf_conntrack_tcp_timeout_syn_recv = 60
net.netfilter.nf_conntrack_tcp_timeout_fin_wait = 120
net.netfilter.nf_conntrack_tcp_timeout_time_wait = 120
net.netfilter.nf_conntrack_tcp_timeout_close_wait = 60
net.netfilter.nf_conntrack_tcp_timeout_last_ack = 30
net.netfilter.nf_conntrack_udp_timeout = 60
net.netfilter.nf_conntrack_udp_timeout_stream = 180
net.netfilter.nf_conntrack_icmp_timeout = 30
net.netfilter.nf_conntrack_generic_timeout = 600
```

**Why `default.forwarding` as well as `all.forwarding`:** the `default` key applies to
interfaces created after boot, ensuring they inherit IPv6 forwarding automatically.

**Why `accept_ra=2`:** Linux suppresses RA processing when `forwarding=1` (to avoid acting
as both a host and a router). Setting `=2` overrides this so the WAN interface still accepts
the RA-delivered default route from Starlink.

### fq_codel vs CAKE

Both need back pressure to counter bufferbloat. On Starlink the bottleneck is at the satellite
link, not the LAN ethernet port where BQL applies — so a software shaper is needed on WAN for
either to work. `fq_codel` preferred over CAKE because:
- Works without bandwidth configuration (adapts automatically as Starlink throughput varies)
- Lower CPU overhead when running without a shaper
- CAKE's advantages (BLUE AQM, per-IP fairness) only apply if bandwidth is configured accurately

If you add a SQM/shaper layer, CAKE becomes the stronger choice.

---

## Router Solicitation Keepalive (DHCPv6-PD /56 vs /64)

Starlink delegates a /56 only while the router is sending ICMPv6 Router Solicitation packets.
If RS packets stop for too long, Starlink falls back to a /64 (not sub-delegatable).

This is a **keepalive failure**, not a plan tier issue. Standard residential Starlink gives a /56.

- **OpenWrt 25.x:** `odhcp6c` handles RS natively — no extra package needed.
- **OpenWrt 23.05 / 24.10:** install `ndisc6` (provides `rdisc6`) to maintain RS keepalive.
  `ndisc6` is NOT in the 25.x apk repo.

If stuck with a /64 after confirming keepalive is working: NDP proxy allows LAN clients to
share the WAN /64 (limited to ~250 hosts, no DHCPv6 on LAN).

---

## Package Manager (OpenWrt 25.x)

OpenWrt 25.x uses `apk` as primary package manager. `opkg` still works but `apk` is preferred.

```sh
# Install a package
apk add kmod-tcp-hybla

# Search
apk search kmod-tcp

# List installed
apk list --installed
```

For older versions (23.05 / 24.10):
```sh
opkg update && opkg install kmod-tcp-hybla
```

---

## luci-app-statistics / collectd

### Key settings on this router

- **Ping hosts:** `8.8.8.8`, `1.0.0.1` (avoid 1.1.1.1 — intercepted by broken Starlink LAX4 CDN)
- **Interface plugin:** `br-lan` and `eth0` (WAN)
- **RRD data:** `/mnt/usb/rrd/` — USB drive (`/dev/sda1`, ext4, ~14 GB), auto-mounted
- **USB mount:** `/etc/config/fstab` → `/mnt/usb`
- **Interval:** 30 seconds

### Graph titles — hostname substitution

Graph titles use `%H` (replaced with router hostname at render time). Set:

```sh
uci set system.@system[0].hostname='Starlink'
uci commit system
```

### Editing LuCI JS graph definition files on 25.12

**Do NOT** use `sed -i` or `cat >` heredocs to edit files in `/www/luci-static/...`:
- Shell quoting mangles JS content
- `sed -i` breaks the overlayfs inode (link count drops to 0, LuCI cannot load the file)

**Correct approach:** edit locally, then `scp -O` to the overlay path:

```sh
scp -O ./ping.js root@192.168.1.1:/overlay/upper/www/luci-static/resources/statistics/rrdtool/definitions/ping.js
```

After copying:
```sh
rm -rf /tmp/rrdimg/* && /etc/init.d/uhttpd restart
```

Graph definition files:
`/www/luci-static/resources/statistics/rrdtool/definitions/<plugin>.js`

---

## LuCI Themes

**Do NOT install `luci-theme-argon` on OpenWrt 25.12.**

It depends on the Lua LuCI stack being phased out in 25.12. Installing it pulls in
`libubus-lua` which requires a libubox version that does not exist on this build — LuCI
breaks entirely.

Safe themes: `luci-theme-bootstrap` (default), `luci-theme-material`.

---

## Official Starlink Gen2 Firmware Reference

Source: `github.com/SpaceExplorationTechnologies/starlink-wifi-gen2`
Hardware: MT7629 SoC, dual-band 3×3 802.11ac, ARM Cortex-A7, kernel 4.4

### What the Gen2 firmware tells us

- **conntrack timeouts** — adopted directly: established=7440, udp=60, udp_stream=180
- **ip6assign '60'** — internal firmware only; meaningless for a bypass router
- **No BBR/hybla/CDG** — cubic default, no non-default CC in their kernel config
- **dnsmasq pins** `my.starlink.com` → `34.120.255.244`
- **Captive portal** redirects all DNS to `34.120.255.244`, exempts `wifi-update.starlink.com`
- **wifi_control** — SpaceX proprietary Go binary, runs as a cron watchdog (`* * * * *`)
- **Firewall** — iptables (kernel 4.4, not nftables)
- **Packages shipped:** 6in4, 6rd, 6to4, ds-lite, map (MAP-E/T), odhcp6c, thc-ipv6
- **thc-ipv6** is an internal security/testing toolkit, not used in residential production

### Gen3 router

The Gen3 Starlink router runs custom SpaceX Go firmware (not OpenWrt).

- Dish: `192.168.100.1`, gRPC API port 9200
- Router: `192.168.1.1`, SSH port 22 (SpaceX Router CA, pubkey-only), HTTP port 80 (wifi_control UI)
- gRPC port 9200 is closed from LAN
- `wifi_get_config` / `get_network_interfaces` return Unimplemented — auth-gated or cloud-only
- Query dish status: `grpcurl -plaintext -d '{"get_status":{}}' 192.168.100.1:9200 SpaceX.API.Device.Device/Handle`
- Dish hardware: `rev4_panda_prod2`, firmware `2026.03.08.mr75503`
- Router firmware: `2026.03.05.mr72456`

---

## Known Bugs and Gotchas

### Starlink LAX4 CDN bug

`customer.lax4.mc.starlinkisp.net` (206.214.227.88/89) is unresponsive.
- Causes Google Play Store downloads to fail for affected customers
- Intercepts traffic to 1.1.1.1 and google.com from this subnet
- Starlink infrastructure fault — not fixable by router config
- Workaround: VPN on affected devices
- Do not use 1.1.1.1 as a ping/monitoring target — use 1.0.0.1 or 8.8.8.8

### /64 instead of /56

Almost always a Router Solicitation keepalive failure, not a plan restriction.
See RS keepalive section above.

### fq_codel inactive despite being set

Hardware flow offloading is on. Disable it (`flow_offloading_hw='0'`).

### IPv6 not up after script

Normal — DHCPv6-PD takes 10–30 seconds after `service network restart`.
Check with `ip -6 addr show dev br-lan` after waiting.

### odhcpd max_preferred_lifetime not taking effect

Wrong option name. Use `max_preferred_lifetime` / `max_valid_lifetime`, not
`preferred_lft` / `valid_lft`. Clean up: `uci -q delete dhcp.lan.preferred_lft`.

### Hybla / CDG not available

CDG is not compiled into the mediatek/filogic kernel on OpenWrt 25.12.0.
Install hybla: `apk add kmod-tcp-hybla`. Use the auto-detection pattern (check
`/proc/sys/net/ipv4/tcp_available_congestion_control`) rather than hardcoding.

---

## Verification Commands

```sh
# WAN IPv6 address from Starlink
ip -6 addr show dev eth0

# LAN delegated prefix
ip -6 addr show dev br-lan

# IPv6 default route
ip -6 route show default

# Connectivity
ping6 -c 3 ipv6.google.com

# Congestion control (expect: hybla)
sysctl net.ipv4.tcp_congestion_control

# Default qdisc (expect: fq_codel)
sysctl net.core.default_qdisc

# Active qdisc on WAN
tc qdisc show dev eth0

# MSS clamp rules
nft list chain inet fw4 mangle_postrouting | grep maxseg
nft list chain inet fw4 mangle_forward | grep maxseg

# odhcpd lifetime config
uci get dhcp.lan.max_preferred_lifetime
uci get dhcp.lan.max_valid_lifetime

# DHCPv6-PD prefix on WAN
ip -6 route show | grep ::/56

# Full IPv6 test
# https://test-ipv6.com — should score 10/10
```

On a LAN client, `ip -6 addr show` should show a `2xxx:` global address with
`valid_lft` ~7200 and `preferred_lft` ~3600.

---

## Service Restart Order

```sh
service network restart
service odhcpd restart
service dnsmasq restart
service firewall restart
```

---

## luci-app-starlink

LuCI dashboard for Starlink dish telemetry, IPv6 status, traffic, alignment, alerts, and router config.
Source: `openwrt-starlink-apk/` on the dev machine.

### Cards

| Card | Data source |
|------|-------------|
| Dish Telemetry | gRPC `getStatus` — state, latency, drop, obstruction, SNR, throughput, uptime |
| Alignment | `alignmentStats` — tilt/rotate recommendation, current vs desired boresight |
| Alerts | All `alerts.*` booleans + `softwareUpdateState`, `currentlyObstructed`, `disablementCode` |
| IPv6 Connectivity | `ip -6 addr/route`, odhcpd UCI lifetime config |
| Traffic | `getStatus` instantaneous throughput + `/proc/net/dev` cumulative bytes |
| Quality | `popPingLatencyMs`, router ping to 8.8.8.8/1.0.0.1, conntrack, router uptime |
| Configuration | TCP CC, default qdisc, MSS clamp, SW/HW offloading, active WAN qdisc |

Dashboard auto-refreshes every 10 seconds. Reboot Dish button in Alignment card.

### Gen3 dish gRPC — actual response notes

- **`state` field absent** when CONNECTED (proto3 omits zero-value enums). Derive from
  `disablementCode === 'OKAY'` + `readyStates.rf === true`.
- **`snrAboveNoiseFloor`** is a float on older firmware; Gen3 uses `isSnrAboveNoiseFloor` (bool).
- **Alert booleans** are omitted when false — absent means healthy.
- **`deviceState.uptimeS`** (Gen3) vs `deviceInfo.upTimeS` (older firmware).
- **Delegated /56** appears in routing table as `from <prefix>/56` source rule, not as `$1`.
  Extract with: `awk 'match($0, /[0-9a-f:]+\/56/) {print substr($0,RSTART,RLENGTH); exit}'`

### grpcurl

Installed at `/usr/bin/grpcurl` (linux/arm64, v1.9.3, ~23 MB). Overlay has 198 MB free.
Dish supports server reflection — no `.proto` files needed.

```sh
# Dish status
grpcurl -plaintext -d '{"getStatus":{}}' 192.168.100.1:9200 SpaceX.API.Device.Device/Handle

# Reboot dish
grpcurl -plaintext -d '{"reboot":{}}' 192.168.100.1:9200 SpaceX.API.Device.Device/Handle
# Response: {"apiVersion":"42","reboot":{}}

# Diagnostics (includes alignmentStats, hardwareSelfTest)
grpcurl -plaintext -d '{"getDiagnostics":{}}' 192.168.100.1:9200 SpaceX.API.Device.Device/Handle
```

### Firewall — no rule needed for 192.168.100.1

The router initiates connections to the dish (grpcurl runs on the router). fw4's default
output policy for the `wan` zone is `ACCEPT` — no explicit rule required. LAN clients can
also reach the dish by default via normal LAN→WAN forwarding.

### Deploy

```sh
# From dev machine (openwrt-starlink-apk/ directory):
sh install.sh 192.168.1.1

# Or update individual files:
scp -O root/usr/libexec/rpcd/luci.starlink root@192.168.1.1:/usr/libexec/rpcd/luci.starlink
ssh root@192.168.1.1 "chmod 755 /usr/libexec/rpcd/luci.starlink && /etc/init.d/rpcd restart"

# JS view must go to overlay path (avoids overlayfs inode breakage):
scp -O root/www/luci-static/resources/view/starlink/status.js \
    root@192.168.1.1:/overlay/upper/www/luci-static/resources/view/starlink/status.js
ssh root@192.168.1.1 "rm -rf /tmp/luci-modulecache /tmp/luci-indexcache; /etc/init.d/uhttpd restart"
```

### rpcd methods

| Method | Timeout | Description |
|--------|---------|-------------|
| `status` | 20s | System data: WAN/LAN IPv6, interface stats, conntrack, qos config, pings |
| `dish` | 10s | gRPC dish data: all telemetry, alignment, alerts |
| `reboot_dish` | 15s | Sends `reboot` gRPC to dish. Returns `{"success":true}` |

ACL: `read` → status, dish. `write` → reboot_dish.

---

## File Paths Reference

| Path | Purpose |
|------|---------|
| `/etc/config/network` | UCI network config (WAN, LAN, wan6) |
| `/etc/config/dhcp` | UCI DHCP/odhcpd config |
| `/etc/config/firewall` | UCI firewall config (mtu_fix, offloading) |
| `/etc/sysctl.conf` | Persistent kernel parameters |
| `/proc/sys/net/ipv4/tcp_available_congestion_control` | What CC modules are loaded |
| `/etc/nftables.d/` | nftables drop-in dir (exists = fw4 present) |
| `/overlay/upper/` | OverlayFS upper layer — write LuCI JS files here |
| `/www/luci-static/resources/statistics/rrdtool/definitions/` | collectd graph JS |
| `/mnt/usb/rrd/` | RRD data on USB drive |
| `/etc/config/fstab` | USB auto-mount config |
| `/usr/libexec/rpcd/luci.starlink` | Starlink dashboard rpcd backend |
| `/usr/share/luci/menu.d/luci-app-starlink.json` | Starlink menu entry |
| `/usr/share/rpcd/acl.d/luci-app-starlink.json` | Starlink rpcd ACL |
| `/overlay/upper/www/luci-static/resources/view/starlink/status.js` | Starlink dashboard JS view |
| `/usr/bin/grpcurl` | gRPC client for dish API (linux/arm64 v1.9.3) |

---

## Project Conventions

- **README files** — always include a "Buy me a beer" section linking to `https://paypal.me/bergfirmware` before the License section.
- **Git commits** — do NOT add `Co-Authored-By: Claude` or any Claude attribution to commit messages.
