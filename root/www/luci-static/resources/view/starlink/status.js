'use strict';
'require view';
'require rpc';
'require poll';

// ── RPC declarations ──────────────────────────────────────────────────────────

var callStatus = rpc.declare({
	object: 'luci.starlink',
	method: 'status',
	expect: {}
});

var callDish = rpc.declare({
	object: 'luci.starlink',
	method: 'dish',
	expect: {}
});

var callRebootDish = rpc.declare({
	object: 'luci.starlink',
	method: 'reboot_dish',
	expect: {}
});

var callDisableHwOffloading = rpc.declare({
	object: 'luci.starlink',
	method: 'disable_hw_offloading',
	expect: {}
});

var callEnableHwOffloading = rpc.declare({
	object: 'luci.starlink',
	method: 'enable_hw_offloading',
	expect: {}
});

var callStarlinkConfigStatus = rpc.declare({
	object: 'luci.starlink',
	method: 'starlink_config_status',
	expect: {}
});

var callDevices = rpc.declare({
	object: 'luci.starlink',
	method: 'devices',
	expect: {}
});

var callRouterStats = rpc.declare({
	object: 'luci.starlink',
	method: 'router_stats',
	expect: {}
});

var callSetHomePage = rpc.declare({
	object: 'luci.starlink',
	method: 'set_home_page',
	expect: {}
});

var callUnsetHomePage = rpc.declare({
	object: 'luci.starlink',
	method: 'unset_home_page',
	expect: {}
});

var callApplyStarlinkConfig = rpc.declare({
	object: 'luci.starlink',
	method: 'apply_starlink_config',
	expect: {}
});

var callSetDnsDefault = rpc.declare({
	object: 'luci.starlink',
	method: 'set_dns_default',
	expect: {}
});

var callSetDnsStarlink = rpc.declare({
	object: 'luci.starlink',
	method: 'set_dns_starlink',
	expect: {}
});

var callSetDnsFamily = rpc.declare({
	object: 'luci.starlink',
	method: 'set_dns_family',
	expect: {}
});

var callSetDnsMalware = rpc.declare({
	object: 'luci.starlink',
	method: 'set_dns_malware',
	expect: {}
});

var callSetStaticIp = rpc.declare({
	object: 'luci.starlink',
	method: 'set_static_ip',
	params: ['mac', 'ip', 'hostname'],
	expect: {}
});

var callRemoveStaticIp = rpc.declare({
	object: 'luci.starlink',
	method: 'remove_static_ip',
	params: ['mac'],
	expect: {}
});


// Per-device data store — keyed by row index, repopulated on each render
var _deviceData = {};

// Tracks whether "Apply Starlink Config" was clicked and the script is still running.
// Persists across view rebuilds so the button shows a waiting state mid-flight.
var _cfgApplying = false;
var _cfgApplyStartTime = 0;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtBytes(b) {
	b = parseInt(b) || 0;
	if (b === 0) return '0 B';
	var units = ['B', 'KB', 'MB', 'GB', 'TB'];
	var i = 0;
	while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
	return b.toFixed(i > 0 ? 2 : 0) + '\u00a0' + units[i];
}

function fmtBps(bps) {
	bps = parseFloat(bps) || 0;
	if (bps >= 1e9) return (bps / 1e9).toFixed(2) + '\u00a0Gbps';
	if (bps >= 1e6) return (bps / 1e6).toFixed(1) + '\u00a0Mbps';
	if (bps >= 1e3) return (bps / 1e3).toFixed(1) + '\u00a0Kbps';
	return bps.toFixed(0) + '\u00a0bps';
}

function fmtUptime(s) {
	s = parseInt(s) || 0;
	var d = Math.floor(s / 86400);
	var h = Math.floor((s % 86400) / 3600);
	var m = Math.floor((s % 3600) / 60);
	if (d > 0) return d + 'd\u00a0' + h + 'h\u00a0' + m + 'm';
	if (h > 0) return h + 'h\u00a0' + m + 'm';
	return m + 'm';
}

function fmtPct(f) {
	return (parseFloat(f) * 100).toFixed(2) + '%';
}

// ── Tiny HTML helpers ─────────────────────────────────────────────────────────

var BADGE_COLORS = {
	ok:      'background:#1a7f37;color:#fff',
	warn:    'background:#9a6700;color:#fff',
	err:     'background:#cf222e;color:#fff',
	info:    'background:#0550ae;color:#fff',
	muted:   'background:#6e7781;color:#fff',
	off:     'background:#444c56;color:#cdd9e5'
};

function badge(text, type) {
	var s = BADGE_COLORS[type] || BADGE_COLORS.muted;
	return '<span style="' + s + ';padding:1px 8px;border-radius:10px;font-size:0.82em;font-weight:600;white-space:nowrap">' + String(text) + '</span>';
}

function dot(ok) {
	var c = ok ? '#2ea043' : '#cf222e';
	return '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + c + ';margin-right:5px;flex-shrink:0"></span>';
}

function row(label, value) {
	return '<div class="sl-row"><span class="sl-lbl">' + label + '</span><span class="sl-val">' + value + '</span></div>';
}

function card(title, icon, body, extraClass) {
	return '<div class="sl-card' + (extraClass ? ' ' + extraClass : '') + '">' +
		'<div class="sl-card-hd"><span class="sl-card-icon">' + icon + '</span>' + title + '</div>' +
		'<div class="sl-card-bd">' + body + '</div>' +
		'</div>';
}

function alertRow(label, value, isAlert) {
	if (!isAlert) return '';
	return '<div class="sl-alert-row">' + badge('!', 'err') + ' ' + label + ': ' + value + '</div>';
}

// ── CSS ───────────────────────────────────────────────────────────────────────

var CSS = '<style>' +
':root{--sl-surface:rgba(0,0,0,0.04);--sl-border:rgba(0,0,0,0.12);--sl-text:#24292f;--sl-muted:#57606a;--sl-accent:#0969da;--sl-green:#1a7f37;--sl-yellow:#9a6700;--sl-red:#cf222e;--sl-stripe:rgba(0,0,0,0.07);--sl-inset:rgba(0,0,0,0.05);--sl-warn-bg:rgba(207,34,46,0.08)}' +
'@media (prefers-color-scheme:dark){:root{--sl-surface:#161b22;--sl-border:#30363d;--sl-text:#c9d1d9;--sl-muted:#8b949e;--sl-accent:#58a6ff;--sl-green:#3fb950;--sl-yellow:#d29922;--sl-red:#f85149;--sl-stripe:#21262d;--sl-inset:#1c2128;--sl-warn-bg:#2d1215}}' +
'.sl-wrap{padding:20px;border-radius:8px;min-height:400px}' +
'.sl-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--sl-border)}' +
'.sl-title{font-size:1.3em;font-weight:700;color:var(--sl-accent);display:flex;align-items:center;gap:8px}' +
'.sl-meta{font-size:0.8em;color:var(--sl-muted);display:flex;align-items:center;gap:10px}' +
'.sl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}' +
'.sl-card{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:8px;overflow:hidden}' +
'.sl-card-full{grid-column:1/-1}' +
'.sl-card-hd{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--sl-border);font-size:0.88em;font-weight:600;color:var(--sl-muted);text-transform:uppercase;letter-spacing:.06em}' +
'.sl-card-icon{font-size:1.1em}' +
'.sl-card-bd{padding:12px 14px}' +
'.sl-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--sl-stripe);font-size:0.88em;gap:8px}' +
'.sl-row:last-child{border-bottom:none}' +
'.sl-lbl{color:var(--sl-muted);white-space:nowrap}' +
'.sl-val{font-weight:500;text-align:right;word-break:break-all;color:var(--sl-text)}' +
'.sl-big-row{display:flex;justify-content:space-around;padding:10px 0}' +
'.sl-big-item{text-align:center}' +
'.sl-big-num{font-size:1.5em;font-weight:700;color:var(--sl-text)}' +
'.sl-big-lbl{font-size:0.75em;color:var(--sl-muted);margin-top:2px}' +
'.sl-cfg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}' +
'.sl-cfg-item{background:var(--sl-inset);border:1px solid var(--sl-border);border-radius:6px;padding:8px 10px}' +
'.sl-cfg-k{font-size:0.75em;color:var(--sl-muted);margin-bottom:4px}' +
'.sl-cfg-v{font-size:0.85em;font-weight:600}' +
'.sl-qdisc{font-family:monospace;font-size:0.78em;color:var(--sl-muted);padding:8px;background:var(--sl-inset);border-radius:4px;margin-top:10px;word-break:break-all}' +
'.sl-na{color:var(--sl-muted);font-size:0.85em;font-style:italic;text-align:center;padding:12px 0}' +
'.sl-note{background:var(--sl-inset);border:1px solid var(--sl-border);border-left:3px solid var(--sl-accent);border-radius:0 4px 4px 0;padding:10px 12px;font-size:0.82em;color:var(--sl-muted);margin-top:8px}' +
'.sl-note code{background:var(--sl-stripe);padding:1px 5px;border-radius:3px;font-family:monospace;color:var(--sl-accent)}' +
'.sl-alert-row{margin-top:4px;font-size:0.85em;color:var(--sl-yellow)}' +
'.sl-align-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:4px 0}' +
'.sl-align-item{text-align:center;background:var(--sl-inset);border:1px solid var(--sl-border);border-radius:6px;padding:12px 8px}' +
'.sl-align-val{font-size:1.4em;font-weight:700;color:var(--sl-text);letter-spacing:-0.01em}' +
'.sl-align-lbl{font-size:0.78em;color:var(--sl-muted);margin-top:4px}' +
'.sl-align-ok{font-size:1.1em;font-weight:600;color:var(--sl-green);text-align:center;padding:8px}' +
'.sl-reboot-btn{width:100%;margin-top:12px;padding:8px 0;background:var(--sl-inset);border:1px solid #f0883e;color:#f0883e;border-radius:6px;font-size:0.88em;font-weight:600;cursor:pointer;letter-spacing:.03em}' +
'.sl-reboot-btn:hover{background:rgba(240,136,62,0.12);border-color:#f0883e}' +
'.sl-reboot-btn:disabled{opacity:0.4;cursor:not-allowed}' +
'.sl-al-list{display:grid;grid-template-columns:1fr 1fr;gap:0}' +
'.sl-al-item{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--sl-stripe);font-size:0.87em}' +
'.sl-al-item:nth-child(odd):last-child{grid-column:1/-1}' +
'.sl-al-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}' +
'.sl-al-ok{background:var(--sl-green)}' +
'.sl-al-err{background:var(--sl-red)}' +
'.sl-al-txt-ok{color:var(--sl-text)}' +
'.sl-al-txt-err{color:var(--sl-red);font-weight:600}' +
'.sl-cfg-btn{width:100%;margin-top:12px;padding:8px 0;border:1px solid;border-radius:6px;font-size:0.88em;font-weight:600;letter-spacing:.03em}' +
'.sl-cfg-btn:hover:not(:disabled){opacity:0.85;cursor:pointer}' +
'.sl-cfg-btn:disabled{cursor:default}' +
'.sl-heater-row{display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding:9px 0;border-top:1px solid var(--sl-stripe);font-size:0.88em;color:var(--sl-text)}' +
'.sl-heater-chk{width:16px;height:16px;cursor:pointer;accent-color:#2ea043}' +
'.sl-heater-chk:disabled{cursor:not-allowed;opacity:0.4}' +
'.sl-ipv6-warn{background:var(--sl-warn-bg);border:1px solid var(--sl-red);border-left:3px solid var(--sl-red);border-radius:0 4px 4px 0;padding:10px 12px;font-size:0.84em;color:var(--sl-red);margin-bottom:10px}' +
'.sl-ipv6-warn-title{font-weight:700;margin-bottom:4px}' +
'.sl-ipv6-warn-body{color:var(--sl-text);line-height:1.5}' +
'@keyframes sl-fan-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
'</style>';

// ── Card builders ─────────────────────────────────────────────────────────────

function buildDishCard(d) {
	var body = '';

	if (!d || !d.available) {
		var reason = (d && d.error) ? d.error : 'unavailable';
		body += '<div class="sl-na">Dish API: ' + reason + '</div>';
		body += '<div class="sl-note">For live dish telemetry, install <code>grpcurl</code> (linux/arm64) to <code>/usr/bin/grpcurl</code>.<br>' +
			'Download from <strong>github.com/fullstorydev/grpcurl/releases</strong></div>';
		return card('Dish Telemetry', '📡', body);
	}

	var state    = d.state || 'UNKNOWN';
	var isConn   = state === 'CONNECTED';
	var latency  = parseFloat(d.latency_ms) || 0;
	var drop     = parseFloat(d.drop_rate)  || 0;
	var obst     = parseFloat(d.fraction_obstructed) || 0;
	var elev     = parseFloat(d.elevation_deg) || 0;
	var snrRaw   = d.snr_above_noise || 'unknown';
	var snrOk    = snrRaw === 'true';

	body += row('State',       badge(state, isConn ? 'ok' : 'warn'));
	body += row('PoP Latency', badge(latency.toFixed(1) + ' ms',
		latency < 50 ? 'ok' : latency < 100 ? 'warn' : 'err'));
	body += row('Drop Rate',   badge(fmtPct(drop),
		drop < 0.001 ? 'ok' : drop < 0.01 ? 'warn' : 'err'));
	body += row('Obstruction', badge(fmtPct(obst),
		obst < 0.005 ? 'ok' : obst < 0.05 ? 'warn' : 'err'));
	body += row('SNR OK',      snrRaw === 'unknown'
		? badge('n/a', 'muted')
		: badge(snrOk ? 'yes' : 'no', snrOk ? 'ok' : 'err'));
	body += row('Elevation',   elev.toFixed(1) + '°');

	if (d.gps_sats && parseInt(d.gps_sats) > 0)
		body += row('GPS Sats', parseInt(d.gps_sats));
	if (d.eth_speed_mbps && parseInt(d.eth_speed_mbps) > 0)
		body += row('Ethernet', parseInt(d.eth_speed_mbps) + ' Mbps');
	if (d.attitude)
		body += row('Alignment', badge(d.attitude.replace('FILTER_', ''), 'info'));
	if (d.uptime)
		body += row('Dish Uptime', fmtUptime(d.uptime));

	// Active alerts only
	if (d.alert_thermal  === 'true') body += alertRow('Thermal throttle', 'active', true);
	if (d.alert_motors   === 'true') body += alertRow('Motors stuck',     'active', true);
	if (d.alert_mast     === 'true') body += alertRow('Mast not vertical','active', true);
	if (d.alert_slow_eth === 'true') body += alertRow('Slow ethernet',    'active', true);
	if (d.alert_heating  === 'true') body += alertRow('Snow melt heating','active', true);

	if (d.hardware) body += row('Dish HW',  '<span style="font-size:0.82em">' + d.hardware + '</span>');
	if (d.software) body += row('Firmware', '<span style="font-size:0.82em">' + d.software + '</span>');

	return card('Dish Telemetry', '📡', body);
}

function buildAlignmentCard(d) {
	var body = '';

	if (!d || !d.available) {
		body += '<div class="sl-na">No dish data</div>';
		return card('Alignment', '🎯', body);
	}

	var boreEl  = parseFloat(d.bore_elevation_deg)  || 0;
	var desEl   = parseFloat(d.desired_elevation_deg) || 0;
	var boreAz  = parseFloat(d.bore_azimuth_deg)     || 0;
	var desAz   = parseFloat(d.desired_azimuth_deg)   || 0;
	var tiltNow = parseFloat(d.tilt_angle_deg)        || 0;

	var tiltDiff   = desEl - boreEl;
	var rotateDiff = desAz - boreAz;
	// Normalise azimuth diff to [-180, 180]
	while (rotateDiff >  180) rotateDiff -= 360;
	while (rotateDiff < -180) rotateDiff += 360;

	var tiltAbs   = Math.abs(tiltDiff).toFixed(2);
	var rotateAbs = Math.abs(rotateDiff).toFixed(2);
	var tiltDir   = tiltDiff   < 0 ? '↓' : '↑';
	var rotateDir = rotateDiff > 0 ? '↻' : '↶';

	var aligned = Math.abs(tiltDiff) < 1.0 && Math.abs(rotateDiff) < 1.0;

	if (aligned) {
		body += '<div class="sl-align-ok">✓ Dish is well aligned</div>';
	}

	body += '<div class="sl-align-grid">';
	body += '<div class="sl-align-item">' +
		'<div class="sl-align-val">' + tiltAbs + '°' + tiltDir + '</div>' +
		'<div class="sl-align-lbl">Tilt recommendation</div></div>';
	body += '<div class="sl-align-item">' +
		'<div class="sl-align-val">' + rotateAbs + '°' + rotateDir + '</div>' +
		'<div class="sl-align-lbl">Rotate recommendation</div></div>';
	body += '</div>';

	body += row('Current tilt',    tiltNow.toFixed(2) + '°');
	body += row('Elevation',       boreEl.toFixed(2) + '° → ' + desEl.toFixed(2) + '°');
	body += row('Azimuth',         boreAz.toFixed(2) + '° → ' + desAz.toFixed(2) + '°');
	if (d.attitude) body += row('Attitude', badge(d.attitude.replace('FILTER_', ''), 'info'));

	return card('Alignment', '🎯', body);
}

function alItem(ok, okText, errText) {
	var cls = ok ? 'sl-al-ok' : 'sl-al-err';
	var tcls = ok ? 'sl-al-txt-ok' : 'sl-al-txt-err';
	return '<div class="sl-al-item"><span class="sl-al-dot ' + cls + '"></span>' +
		'<span class="' + tcls + '">' + (ok ? okText : errText) + '</span></div>';
}

function buildAlertsCard(d) {
	if (!d || !d.available) {
		return card('Alerts', '🔔', '<div class="sl-na">No dish data</div>');
	}

	var ok   = function(f) { return f !== 'true'; };
	var swOk = d.sw_update_state === 'IDLE' || d.sw_update_state === '';
	var notObstructed = d.currently_obstructed !== 'true' &&
	                    parseFloat(d.fraction_obstructed || 0) < 0.005;
	var notDisabled   = d.disablement === 'OKAY' || d.disablement === '';

	var body = '<div class="sl-al-list">';
	body += alItem(ok(d.al_heating),     'Not heating',                              'Dish is heating');
	body += alItem(ok(d.al_throttle),    'Normal temperature',                       'Thermal throttle active');
	body += alItem(ok(d.al_shutdown),    'Not in thermal shutdown',                  'Thermal shutdown active');
	body += alItem(ok(d.al_psu_throttle),'External PSU temp OK',                     'PSU thermal throttle');
	body += alItem(ok(d.al_motors),      'Motors healthy',                           'Motors stuck');
	body += alItem(ok(d.al_mast),        'Mast is near vertical',                    'Mast not vertical');
	body += alItem(ok(d.al_slow_eth),    'Normal Ethernet speeds',                   'Slow Ethernet speeds');
	body += alItem(swOk,                 'Software is up to date',                   'Software update: ' + d.sw_update_state);
	body += alItem(ok(d.al_roaming),     'Moving at an acceptable speed',            'Moving too fast (roaming)');
	body += alItem(notObstructed,        'Not obstructed',                           'Dish obstructed');
	body += alItem(notDisabled,          'Not disabled',                             'Disabled: ' + d.disablement);
	body += '</div>';

	// Reboot button
	body += '<button class="sl-reboot-btn" id="sl-reboot-btn" onclick="starlinkRebootDish(this)">⟳ Reboot Dish</button>';

	// Heater status (read-only — dish setConfig requires SpaceX auth)
	var heaterLabel = d.heater_mode === 'ALWAYS_ON'  ? 'always on'  :
	                  d.heater_mode === 'ALWAYS_OFF' ? 'always off' : 'auto';
	var heaterStyle = d.heater_mode === 'ALWAYS_ON'  ? 'warn'  :
	                  d.heater_mode === 'ALWAYS_OFF' ? 'muted' : 'ok';
	body += row('❄ Snow melt heater', badge(heaterLabel, heaterStyle));

	return card('Alerts', '🔔', body);
}

function buildIPv6Card(s, d) {
	var body = '';

	var hasWan    = !!(s.wan_ipv6    && s.wan_ipv6.trim());
	var hasLan    = !!(s.lan_ipv6    && s.lan_ipv6.trim());
	var hasRoute  = !!(s.ipv6_default_route && s.ipv6_default_route.trim());
	var hasPrefix = !!(s.delegated_prefix  && s.delegated_prefix.trim());
	var hasLLA    = !!(s.wan_lla && s.wan_lla.trim());
	var raMaxOk = s.ra_maxinterval === '60';
	var raMinOk = s.ra_mininterval === '20';

	// DHCPv6-PD failure detection
	if (!hasPrefix) {
		if (hasLLA) {
			// WAN interface is up (link-local present) but dish not sending /56
			body += '<div class="sl-ipv6-warn">' +
				'<div class="sl-ipv6-warn-title">⚠ No IPv6 prefix from dish</div>' +
				'<div class="sl-ipv6-warn-body">WAN link is up but no /56 prefix received. ' +
				'Starlink dish firmware updates sometimes break IPv6.</div>' +
				'</div>';
		} else {
			// No link-local either — WAN interface not up
			body += '<div class="sl-ipv6-warn">' +
				'<div class="sl-ipv6-warn-title">⚠ No IPv6 — WAN interface not up</div>' +
				'<div class="sl-ipv6-warn-body">No link-local address on WAN. ' +
				'Check the physical connection to the dish.</div>' +
				'</div>';
		}
	}

	body += row('WAN IPv6',
		dot(hasWan) + (hasWan
			? '<span style="font-size:0.82em;font-family:monospace">' + s.wan_ipv6 + '</span>'
			: badge('None', 'err')));

	body += row('LAN Prefix',
		dot(hasLan) + (hasLan
			? '<span style="font-size:0.82em;font-family:monospace">' + s.lan_ipv6 + '</span>'
			: badge('None', 'err')));

	if (hasPrefix) {
		body += row('Delegated /56',
			'<span style="font-size:0.82em;font-family:monospace">' + s.delegated_prefix + '</span>');
	}

	body += row('Default Route', hasRoute
		? badge('present', 'ok')
		: badge('missing', 'err'));

	body += row('RA interval',
		badge((s.ra_maxinterval || '?') + 's max / ' + (s.ra_mininterval || '?') + 's min',
			(raMaxOk && raMinOk) ? 'ok' : 'warn'));

	return card('IPv6 Connectivity', '🌐', body);
}

function buildTrafficCard(s, d) {
	var body = '';

	// Instantaneous throughput from dish gRPC (if available)
	if (d && d.available && (d.downlink_bps || d.uplink_bps)) {
		body += '<div class="sl-big-row">';
		body += '<div class="sl-big-item"><div class="sl-big-num">\u2193 ' + fmtBps(d.downlink_bps) + '</div><div class="sl-big-lbl">Downlink (dish)</div></div>';
		body += '<div class="sl-big-item"><div class="sl-big-num">\u2191 ' + fmtBps(d.uplink_bps)   + '</div><div class="sl-big-lbl">Uplink (dish)</div></div>';
		body += '</div>';
	}

	if (s.wan_stats) {
		body += row('WAN\u00a0RX', fmtBytes(s.wan_stats.rx_bytes));
		body += row('WAN\u00a0TX', fmtBytes(s.wan_stats.tx_bytes));
		body += row('WAN\u00a0RX\u00a0pkts', (parseInt(s.wan_stats.rx_packets) || 0).toLocaleString());
		body += row('WAN\u00a0TX\u00a0pkts', (parseInt(s.wan_stats.tx_packets) || 0).toLocaleString());
	}
	if (s.lan_stats) {
		body += row('LAN\u00a0RX', fmtBytes(s.lan_stats.rx_bytes));
		body += row('LAN\u00a0TX', fmtBytes(s.lan_stats.tx_bytes));
	}

	return card('Traffic', '📊', body);
}

function buildQualityCard(s, d) {
	var body = '';

	// Dish PoP latency
	if (d && d.available && d.latency_ms) {
		var l = parseFloat(d.latency_ms);
		body += row('Dish \u2192 PoP',
			badge(l.toFixed(1) + ' ms', l < 50 ? 'ok' : l < 100 ? 'warn' : 'err'));
	}

	// Router ping to well-known targets
	if (s.ping_8888) {
		var p8 = parseFloat(s.ping_8888);
		body += row('Ping 8.8.8.8',
			badge(p8.toFixed(1) + ' ms', p8 < 60 ? 'ok' : p8 < 150 ? 'warn' : 'err'));
	}
	if (s.ping_1001) {
		var p1 = parseFloat(s.ping_1001);
		body += row('Ping 1.0.0.1',
			badge(p1.toFixed(1) + ' ms', p1 < 60 ? 'ok' : p1 < 150 ? 'warn' : 'err'));
	}

	// Conntrack
	if (s.conntrack_count && s.conntrack_max) {
		var ct = parseInt(s.conntrack_count);
		var mx = parseInt(s.conntrack_max);
		var pct = mx > 0 ? Math.round(ct / mx * 100) : 0;
		body += row('Conntrack',
			ct.toLocaleString() + ' / ' + mx.toLocaleString() +
			' ' + badge(pct + '%', pct < 70 ? 'ok' : pct < 90 ? 'warn' : 'err'));
	}

	if (s.uptime) {
		body += row('Router Uptime', fmtUptime(s.uptime));
	}

	return card('Quality', '📶', body);
}

// ── Router stats helpers ──────────────────────────────────────────────────────

function svgGauge(pct, label, sublabel) {
	var r    = 40;
	var circ = 2 * Math.PI * r;
	var arc  = Math.min(Math.max(pct, 0), 100) / 100 * circ;
	var color = pct > 85 ? 'var(--sl-red)' : pct > 65 ? 'var(--sl-yellow)' : 'var(--sl-green)';
	return '<svg viewBox="0 0 100 100" style="width:130px;height:130px;display:block">' +
		'<circle cx="50" cy="50" r="' + r + '" style="fill:none;stroke:var(--sl-stripe)" stroke-width="12"/>' +
		'<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="12"' +
		' stroke-dasharray="' + arc.toFixed(2) + ' ' + circ.toFixed(2) + '"' +
		' stroke-linecap="round" transform="rotate(-90 50 50)"/>' +
		'<text x="50" y="47" text-anchor="middle" font-size="18" font-weight="700" style="fill:var(--sl-text)">' + Math.round(pct) + '%</text>' +
		'<text x="50" y="62" text-anchor="middle" font-size="10" style="fill:var(--sl-muted)">' + label + '</text>' +
		(sublabel ? '<text x="50" y="74" text-anchor="middle" font-size="8.5" style="fill:var(--sl-muted)">' + sublabel + '</text>' : '') +
		'</svg>';
}

function loadBar(load, maxLoad, label) {
	var pct   = Math.min(load / maxLoad * 100, 100);
	var color = pct > 85 ? 'var(--sl-red)' : pct > 65 ? 'var(--sl-yellow)' : 'var(--sl-green)';
	return '<div style="margin:5px 0">' +
		'<div style="display:flex;justify-content:space-between;font-size:0.8em;margin-bottom:3px">' +
		'<span style="color:var(--sl-muted)">' + label + '</span>' +
		'<span style="font-weight:600">' + load.toFixed(2) + '</span>' +
		'</div>' +
		'<div style="height:6px;background:var(--sl-stripe);border-radius:3px;overflow:hidden">' +
		'<div style="height:100%;width:' + pct.toFixed(1) + '%;background:' + color + ';border-radius:3px;transition:width .6s ease"></div>' +
		'</div></div>';
}

function fmtKB(kb) {
	var mb = kb / 1024;
	return mb >= 1024 ? (mb / 1024).toFixed(1) + '\u00a0GB' : Math.round(mb) + '\u00a0MB';
}

function fanIcon(state, maxState) {
	var on  = state > 0;
	var pct = on ? state / maxState : 0;
	// Duration: 0.4s at full, 2.5s at state 1
	var dur = on ? (2.5 - pct * 2.1).toFixed(2) + 's' : '0s';
	var c   = on ? (pct > 0.6 ? 'var(--sl-red)' : pct > 0.3 ? 'var(--sl-yellow)' : 'var(--sl-green)') : 'var(--sl-muted)';
	var anim = on ? ('sl-fan-spin ' + dur + ' linear infinite') : 'none';
	return '<svg viewBox="0 0 24 24" width="18" height="18" ' +
		'style="vertical-align:middle;animation:' + anim + ';flex-shrink:0;color:' + c + '">' +
		'<circle cx="12" cy="12" r="2.8" fill="currentColor"/>' +
		'<path d="M12 2c2 0 3.5 4 1 8C10.5 6 10 2 12 2z" fill="currentColor"/>' +
		'<path d="M22 12c0 2-4 3.5-8 1 4-2.5 6-3 8-1z" fill="currentColor"/>' +
		'<path d="M12 22c-2 0-3.5-4-1-8 2.5 4 3 6 1 8z" fill="currentColor"/>' +
		'<path d="M2 12c0-2 4-3.5 8-1-4 2.5-6 3-8 1z" fill="currentColor"/>' +
		'</svg>';
}

function buildRouterStatsCard(rs, s) {
	if (!rs || !rs.mem_total) {
		return card('Router Stats', '⚡', '<div class="sl-na">No data</div>');
	}

	var memTotal  = parseInt(rs.mem_total)       || 1;
	var memFree   = parseInt(rs.mem_free)         || 0;
	var memAvail  = parseInt(rs.mem_available)    || 0;
	var memCache  = (parseInt(rs.mem_cached) || 0) + (parseInt(rs.mem_buffers) || 0) + (parseInt(rs.mem_sreclaimable) || 0);
	var memUsed   = memTotal - memAvail;
	var memUsedPct = memUsed / memTotal * 100;
	var memCachePct = Math.min(memCache / memTotal * 100, 100 - memUsedPct);

	var load1  = parseFloat(rs.load1)  || 0;
	var load5  = parseFloat(rs.load5)  || 0;
	var load15 = parseFloat(rs.load15) || 0;
	var numCpu = parseInt(rs.num_cpus) || 1;
	var cpuPct = Math.min(load1 / numCpu * 100, 100);

	var swapTotal = parseInt(rs.swap_total) || 0;
	var swapFree  = parseInt(rs.swap_free)  || 0;
	var swapUsed  = swapTotal - swapFree;

	var body = '';

	// ── Fan + CPU temp ───────────────────────────────────────────────────────
	var fanState = parseInt(rs.fan_state);
	var fanMax   = parseInt(rs.fan_max)   || 7;
	var cpuTemp  = rs.cpu_temp || '';
	if (fanState >= 0) {
		var fanOn  = fanState > 0;
		var fanPct = Math.round(fanState / fanMax * 100);
		var fanLabel = fanOn ? fanState + '\u00a0/\u00a0' + fanMax + '\u00a0(' + fanPct + '%)' : 'off';
		body += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 2px 10px;border-bottom:1px solid var(--sl-stripe);margin-bottom:10px">';
		body += '<span style="display:flex;align-items:center;gap:8px;font-size:0.88em;color:var(--sl-muted)">' +
			fanIcon(fanState, fanMax) +
			'<span>Fan</span></span>';
		body += '<span style="display:flex;align-items:center;gap:10px">';
		body += '<span style="font-size:0.88em;font-weight:500">' + fanLabel + '</span>';
		if (cpuTemp) {
			var t = parseFloat(cpuTemp);
			body += badge(cpuTemp + '\u00b0C', t >= 80 ? 'err' : t >= 70 ? 'warn' : 'ok');
		}
		body += '</span></div>';
	}

	// ── SVG gauges ──────────────────────────────────────────────────────────
	body += '<div style="display:flex;justify-content:space-around;align-items:center;padding:4px 0 10px">';
	body += svgGauge(memUsedPct, 'Memory', fmtKB(memUsed) + ' / ' + fmtKB(memTotal));
	body += svgGauge(cpuPct,     'CPU Load', load1.toFixed(2) + ' (' + numCpu + '\u00a0core' + (numCpu > 1 ? 's' : '') + ')');
	body += '</div>';

	// ── Memory stacked bar ──────────────────────────────────────────────────
	body += '<div style="font-size:0.78em;color:var(--sl-muted);margin-bottom:4px;letter-spacing:.03em">MEMORY BREAKDOWN</div>';
	body += '<div style="height:8px;background:var(--sl-stripe);border-radius:4px;overflow:hidden;margin-bottom:6px">' +
		'<div style="display:flex;height:100%">' +
		'<div style="width:' + memUsedPct.toFixed(1) + '%;background:var(--sl-green);transition:width .6s ease"></div>' +
		'<div style="width:' + memCachePct.toFixed(1) + '%;background:#388bfd;transition:width .6s ease"></div>' +
		'</div></div>';
	body += '<div style="display:flex;gap:14px;font-size:0.8em;margin-bottom:10px;flex-wrap:wrap">';
	body += '<span><span style="display:inline-block;width:9px;height:9px;background:var(--sl-green);border-radius:2px;margin-right:4px;vertical-align:middle"></span>Used\u00a0' + fmtKB(memUsed) + '</span>';
	body += '<span><span style="display:inline-block;width:9px;height:9px;background:#388bfd;border-radius:2px;margin-right:4px;vertical-align:middle"></span>Cache\u00a0' + fmtKB(memCache) + '</span>';
	body += '<span><span style="display:inline-block;width:9px;height:9px;background:var(--sl-stripe);border:1px solid var(--sl-border);border-radius:2px;margin-right:4px;vertical-align:middle"></span>Free\u00a0' + fmtKB(memFree) + '</span>';
	body += '</div>';

	// Swap (only if present)
	if (swapTotal > 0) {
		var swapPct = swapUsed / swapTotal * 100;
		body += row('Swap', badge(fmtKB(swapUsed) + ' / ' + fmtKB(swapTotal), swapPct > 50 ? 'warn' : 'ok'));
	}

	// ── Load average bars ───────────────────────────────────────────────────
	body += '<div style="font-size:0.78em;color:var(--sl-muted);margin-bottom:4px;letter-spacing:.03em">LOAD AVERAGE</div>';
	body += loadBar(load1,  numCpu, '1\u00a0min');
	body += loadBar(load5,  numCpu, '5\u00a0min');
	body += loadBar(load15, numCpu, '15\u00a0min');

	// HW offloading toggle
	var hwOn = s && s.hw_offloading === '1';
	body += '<label class="sl-heater-row" for="sl-hwoff-chk" style="cursor:pointer">' +
		'<span>Hardware flow offloading</span>' +
		'<input type="checkbox" class="sl-heater-chk" id="sl-hwoff-chk"' +
		(hwOn ? ' checked' : '') +
		' onchange="starlinkToggleHwOffloading(this)">' +
		'</label>';
	var targetNpu = {
		'mediatek/filogic': 'MediaTek Filogic NPU',
		'mediatek/mt7622':  'MediaTek MT7622 NPU',
		'mediatek/mt7621':  'MediaTek MT7621',
		'ipq807x':          'Qualcomm IPQ807x NPU',
		'ipq40xx':          'Qualcomm IPQ40xx NPU',
		'mvebu/cortexa9':   'Marvell hardware engine',
		'bcm4908':          'Broadcom Runner NPU',
		'bcm27xx':          'Broadcom NPU',
	};
	var target  = (s && s.board_target) ? s.board_target : '';
	var socName = targetNpu[target] || (target ? target + ' NPU' : 'hardware NPU');
	body += '<div style="font-size:0.78em;color:var(--sl-muted);padding:4px 2px 0">' +
		(hwOn
			? '⚠ Hardware offloading active — fq_codel bypassed (' + socName + ' handles routing)'
			: 'Enable if CPU consistently hits 100% — offloads routing to the ' + socName + '. Disables fq_codel AQM.') +
		'</div>';

	return card('Router Stats', '⚡', body);
}

function buildDevicesCard(devData, s) {
	var raw  = (devData && devData.devices) ? devData.devices : [];

	// Deduplicate by MAC — prefer IPv4 over IPv6, then active over stale
	var byMac = {};
	for (var i = 0; i < raw.length; i++) {
		var d   = raw[i];
		var isV4 = d.ip.indexOf(':') === -1;
		if (!byMac[d.mac]) {
			byMac[d.mac] = d;
		} else {
			var cur    = byMac[d.mac];
			var curIsV4 = cur.ip.indexOf(':') === -1;
			if (isV4 && !curIsV4) byMac[d.mac] = d;        // prefer IPv4
			else if (isV4 === curIsV4 && d.active && !cur.active) byMac[d.mac] = d; // prefer active
		}
	}
	var list = [];
	for (var mac in byMac) { if (byMac.hasOwnProperty(mac)) list.push(byMac[mac]); }

	// Sort: active first, then alphabetically by hostname/IP
	list.sort(function(a, b) {
		if (a.active !== b.active) return a.active ? -1 : 1;
		var na = (a.hostname || a.ip).toLowerCase();
		var nb = (b.hostname || b.ip).toLowerCase();
		return na < nb ? -1 : na > nb ? 1 : 0;
	});

	var activeCount = 0;
	for (var i = 0; i < list.length; i++) { if (list[i].active) activeCount++; }

	var titleBadge = badge(activeCount + ' active', activeCount > 0 ? 'ok' : 'muted') +
		'&nbsp;' + badge(list.length + ' total', 'info');

	var body = '';

	var staticLeases = (devData && devData.static_leases) ? devData.static_leases : {};

	if (list.length === 0) {
		body += '<div class="sl-na">No devices detected on LAN</div>';
		return card('Connected Devices', '🖥️', body, 'sl-card-full');
	}

	_deviceData = {};
	body += '<div style="max-height:400px;overflow-y:auto;margin:-4px -2px">';
	for (var j = 0; j < list.length; j++) {
		var d    = list[j];
		var name = d.hostname ? d.hostname : d.ip;
		var sub  = d.hostname ? d.ip : '';
		var dotC   = d.active ? 'var(--sl-green)' : 'var(--sl-muted)';
		var stateC = d.active ? 'ok' : 'off';
		var macKey = d.mac.toLowerCase();
		var staticIp = staticLeases[macKey] || '';
		var rowKey = 'sl-dev-' + j;
		_deviceData[rowKey] = { mac: d.mac, ip: d.ip, hostname: d.hostname || '', static_ip: staticIp };

		body += '<div class="sl-row" style="padding:6px 2px">';

		// Left: dot + name + IP sub-label
		body += '<span style="display:flex;align-items:center;gap:7px;min-width:0">' +
			'<span style="width:8px;height:8px;border-radius:50%;background:' + dotC + ';flex-shrink:0"></span>' +
			'<span style="min-width:0">' +
			'<span style="font-weight:500">' + name + '</span>' +
			(sub ? '<span style="color:var(--sl-muted);font-size:0.8em;margin-left:5px">' + sub + '</span>' : '') +
			'</span></span>';

		// Right: MAC + state badge + static IP button
		var pinStyle = staticIp
			? 'background:var(--sl-inset);border:1px solid var(--sl-green);color:var(--sl-green)'
			: 'background:var(--sl-inset);border:1px solid var(--sl-border);color:var(--sl-muted)';
		var pinLabel = staticIp ? ('📌\u00a0' + staticIp) : '📌\u00a0Static IP';
		body += '<span style="display:flex;align-items:center;gap:6px;flex-shrink:0">' +
			'<span style="color:var(--sl-muted);font-size:0.78em;font-family:monospace">' + d.mac + '</span>' +
			badge(d.state, stateC) +
			'<button onclick="starlinkSetStaticIp(\'' + rowKey + '\')" ' +
			'style="' + pinStyle + ';padding:2px 8px;border-radius:4px;font-size:0.78em;cursor:pointer;white-space:nowrap">' +
			pinLabel + '</button>' +
			'</span>';

		body += '</div>';
	}
	body += '</div>';

	// DHCP range
	var lanIp     = s ? (s.lan_ip     || '').trim() : '';
	var dhcpStart = s ? (parseInt(s.dhcp_start) || 0) : 0;
	var dhcpLimit = s ? (parseInt(s.dhcp_limit) || 0) : 0;
	if (lanIp && dhcpStart && dhcpLimit) {
		var subnet   = lanIp.replace(/\.\d+$/, '');
		var firstIp  = subnet + '.' + dhcpStart;
		var lastIp   = subnet + '.' + (dhcpStart + dhcpLimit - 1);
		body += '<div style="margin-top:10px;font-size:0.78em;color:var(--sl-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 0 2px">DHCP Range</div>';
		body += row('Range', '<span style="font-family:monospace">' + firstIp + ' – ' + lastIp + '</span>');
		body += row('Pool size', dhcpLimit + ' addresses');
	}

	return card('Connected Devices &nbsp;' + titleBadge, '🖥️', body, 'sl-card-full');
}

function buildDNSCard(s) {
	var body = '';

	var peerdnsOff4 = s.wan_peerdns  === '0';
	var peerdnsOff6 = s.wan6_peerdns === '0';

	// peerdns status rows
	body += row('peerdns (IPv4)', badge(peerdnsOff4 ? 'disabled' : 'enabled (using ISP DNS)',
		peerdnsOff4 ? 'ok' : 'err'));
	body += row('peerdns (IPv6)', badge(peerdnsOff6 ? 'disabled' : 'enabled (using ISP DNS)',
		peerdnsOff6 ? 'ok' : 'err'));

	// IPv4 DNS servers
	var dns4 = (s.wan_dns || '').trim();
	var dns4Label = peerdnsOff4 ? 'configured' : 'ISP';
	var dns4Color = peerdnsOff4 ? 'ok' : 'info';
	if (dns4) {
		var servers4 = dns4.split(/\s+/);
		body += '<div style="margin-top:8px;font-size:0.78em;color:var(--sl-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 0 2px">IPv4 DNS Servers</div>';
		for (var i = 0; i < servers4.length; i++) {
			var s4 = servers4[i];
			body += row(s4, badge(dns4Label, dns4Color));
		}
	} else {
		body += row('IPv4 DNS', badge('none configured', 'err'));
	}

	// IPv6 DNS servers
	var dns6 = (s.wan6_dns || '').trim();
	var dns6Label = peerdnsOff6 ? 'configured' : 'ISP';
	var dns6Color = peerdnsOff6 ? 'ok' : 'info';
	if (dns6) {
		var servers6 = dns6.split(/\s+/);
		body += '<div style="margin-top:8px;font-size:0.78em;color:var(--sl-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 0 2px">IPv6 DNS Servers</div>';
		for (var j = 0; j < servers6.length; j++) {
			var s6 = servers6[j];
			body += row('<span style="font-family:monospace;font-size:0.9em">' + s6 + '</span>',
				badge(dns6Label, dns6Color));
		}
	} else {
		body += row('IPv6 DNS', badge('none configured', 'err'));
	}

	// DNS mode detection.
	// peerdns=1 means no static DNS override — router accepts ISP-assigned servers.
	// Check this FIRST: when peerdns is on, wan_dns may contain runtime ISP servers
	// read from resolv.conf.auto (not static UCI config), so content-matching would
	// wrongly classify it as Custom.
	var dnsMode = null;
	if (s.wan_peerdns !== '0') {
		dnsMode = 'starlink';
	} else {
		// peerdns off — match static DNS against known presets.
		// Normalise whitespace so comparison is stable regardless of UCI storage.
		var wan_dns  = (s.wan_dns  || '').trim().replace(/\s+/g, ' ');
		var wan6_dns = (s.wan6_dns || '').trim().replace(/\s+/g, ' ');
		var DNS_PRESETS = {
			'default': {
				v4: '1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4',
				v6: '2606:4700:4700::1111 2606:4700:4700::1001 2001:4860:4860::8888 2001:4860:4860::8844'
			},
			'family': {
				v4: '1.1.1.3 1.0.0.3',
				v6: '2606:4700:4700::1113 2606:4700:4700::1003'
			},
			'malware': {
				v4: '1.1.1.2 1.0.0.2',
				v6: '2606:4700:4700::1112 2606:4700:4700::1002'
			}
		};
		var presetOrder = ['family', 'malware', 'default'];
		for (var pi = 0; pi < presetOrder.length; pi++) {
			var pk = presetOrder[pi];
			var p = DNS_PRESETS[pk];
			var v4ok = wan_dns  === p.v4 || wan_dns  === '';
			var v6ok = wan6_dns === p.v6 || wan6_dns === '';
			if (v4ok && v6ok && (wan_dns !== '' || wan6_dns !== '')) {
				dnsMode = pk;
				break;
			}
		}
		if (!dnsMode) {
			dnsMode = (wan_dns !== '' || wan6_dns !== '') ? 'custom' : 'default';
		}
	}

	var dnsModeLabels = {
		'default':  'Default (Cloudflare + Google)',
		'starlink': 'Starlink (ISP DNS)',
		'family':   'Family Filter (Cloudflare for Families)',
		'malware':  'Malware Filter (Cloudflare)',
		'custom':   'Custom (managed externally)',
	};
	var dnsModeNotes = {
		'family':  'Blocks malware &amp; adult content — <code>1.1.1.3</code> / <code>1.0.0.3</code>',
		'malware': 'Blocks malware only — <code>1.1.1.2</code> / <code>1.0.0.2</code>',
		'custom':  'Custom DNS detected — configure via CLI or LuCI &rarr; Network &rarr; Interfaces. This panel will not overwrite your settings.',
	};

	body += '<div style="margin-top:12px;font-size:0.78em;color:var(--sl-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 0 2px">DNS Mode</div>';
	body += '<select id="sl-dns-mode" onchange="starlinkSetDnsMode(this)" ' +
		'style="width:100%;padding:7px 10px;background:var(--sl-inset);border:1px solid var(--sl-border);' +
		'border-radius:6px;color:var(--sl-text);font-size:0.88em;cursor:pointer;outline:none">';
	var modeKeys = ['default', 'starlink', 'family', 'malware', 'custom'];
	for (var mi = 0; mi < modeKeys.length; mi++) {
		var mk = modeKeys[mi];
		// 'custom' is read-only: disable it when not currently active so it
		// can't be selected from another mode (it would be a no-op anyway).
		var disabled = (mk === 'custom' && dnsMode !== 'custom') ? ' disabled' : '';
		body += '<option value="' + mk + '"' + (dnsMode === mk ? ' selected' : '') + disabled + '>' +
			dnsModeLabels[mk] + '</option>';
	}
	body += '</select>';
	if (dnsModeNotes[dnsMode]) {
		body += '<div class="sl-note">' + dnsModeNotes[dnsMode] + '</div>';
	}

	return card('DNS Servers', '🔒', body);
}

function buildConfigCard(s, cs) {
	var body = '<div class="sl-cfg-grid">';

	var tcp_cc = s.tcp_cc || 'unknown';
	var qdisc  = s.default_qdisc || 'unknown';
	var mtu    = s.mtu_fix === '1';
	var swOff  = s.sw_offloading === '1';
	var hwOff  = s.hw_offloading === '1';

	// HW offloading requires flow_offloading=1 (SW) as a UCI prerequisite, so when
	// HW is on both UCI values are 1. Show effective mode as a single row.
	var offloadMode = hwOff ? 'hardware' : swOff ? 'software' : 'none';
	var offloadClass = hwOff ? 'warn' : swOff ? 'ok' : 'muted';

	var cfgItems = [
		['TCP CC',        badge(tcp_cc,    tcp_cc === 'hybla' ? 'ok' : tcp_cc === 'cubic' ? 'warn' : 'info')],
		['Default qdisc', badge(qdisc,     qdisc === 'fq_codel' && !hwOff ? 'ok' : 'warn')],
		['MSS clamping',  badge(mtu ? 'enabled' : 'disabled', mtu ? 'ok' : 'warn')],
		['Offloading',    badge(offloadMode, offloadClass)],
		['WAN device',    badge(s.wan_dev || 'unknown', s.wan_dev ? 'ok' : 'warn')],
	];

	for (var i = 0; i < cfgItems.length; i++) {
		body += '<div class="sl-cfg-item"><div class="sl-cfg-k">' + cfgItems[i][0] + '</div>' +
			'<div class="sl-cfg-v">' + cfgItems[i][1] + '</div></div>';
	}

	body += '</div>';

	if (s.wan_qdisc) {
		body += '<div class="sl-qdisc">Active qdisc: ' + s.wan_qdisc + '</div>';
	}

	// Config warnings
	if (s.tcp_cc && s.tcp_cc !== 'hybla') {
		body += '<div class="sl-note">ℹ TCP congestion control is <strong>' + s.tcp_cc + '</strong>. For satellite links, hybla is preferred: <code>apk add kmod-tcp-hybla</code></div>';
	}


	// ── Set as default home page button ──────────────────────────────────────
	var isHome = s.luci_home === '1';
	var homeStyle = isHome
		? 'background:#1a7f37;border-color:#2ea043;color:#fff'
		: 'background:var(--sl-inset);border-color:var(--sl-muted);color:var(--sl-muted)';
	var homeText = isHome ? '🏠 Default Home Page (click to revert)' : '🏠 Set as Default Home Page';
	body += '<button class="sl-cfg-btn" style="' + homeStyle + ';margin-top:8px" ' +
		'data-ishome="' + (isHome ? 'true' : 'false') + '" ' +
		'onclick="starlinkToggleHome(this)">' + homeText + '</button>';

	// ── Starlink config apply button ─────────────────────────────────────────
	var cfgActive = cs && cs.active === true;

	// If active just became true, or 90s timeout elapsed, clear the applying flag
	if (cfgActive) {
		_cfgApplying = false;
		_cfgApplyStartTime = 0;
	} else if (_cfgApplying && _cfgApplyStartTime && (Date.now() - _cfgApplyStartTime) > 90000) {
		_cfgApplying = false;
		_cfgApplyStartTime = 0;
	}

	var btnText, btnStyle, btnDisabled;
	if (cfgActive) {
		btnText     = '✓ Starlink Config Active';
		btnStyle    = 'background:#1a7f37;border-color:#2ea043;color:#fff';
		btnDisabled = 'disabled';
	} else if (_cfgApplying) {
		btnText     = '⟳ Applying… (updates in ~30s)';
		btnStyle    = 'background:#9a6700;border-color:#d29922;color:#fff';
		btnDisabled = 'disabled';
	} else {
		btnText     = 'Turn Starlink Config On';
		btnStyle    = 'background:var(--sl-inset);border-color:#388bfd;color:#388bfd';
		btnDisabled = '';
	}

	body += '<button class="sl-cfg-btn" ' + btnDisabled +
		' style="' + btnStyle + '" onclick="starlinkApplyConfig(this)">' +
		btnText + '</button>';

	// Show drift detail when sentinel exists but values changed
	if (cs && !cfgActive && cs.sentinel === true && cs.issues) {
		body += '<div class="sl-note">⚠ Config was applied but some settings have changed: <code>' +
			cs.issues.replace(/,$/, '') + '</code></div>';
	}

	return card('Configuration — Active Optimal Starlink IPv6 Config &amp; Settings', '⚙️', body);
}

// ── Reboot handler (global so inline onclick can reach it) ───────────────────

window.starlinkRebootDish = function(btn) {
	if (!window.confirm('Reboot the Starlink dish?\n\nThe dish will be offline for ~60 seconds.'))
		return;
	btn.disabled = true;
	btn.textContent = '⟳ Rebooting…';
	callRebootDish().then(function(r) {
		if (r && r.success) {
			btn.textContent = '✓ Reboot sent — dish offline ~60s';
			btn.style.borderColor = 'var(--sl-green)';
			btn.style.color = 'var(--sl-green)';
		} else {
			btn.textContent = '✗ Reboot failed';
			btn.style.borderColor = 'var(--sl-red)';
			btn.style.color = 'var(--sl-red)';
			btn.disabled = false;
		}
	}).catch(function() {
		btn.textContent = '✗ RPC error';
		btn.disabled = false;
	});
};

// ── Static IP handler ────────────────────────────────────────────────────────

window.starlinkSetStaticIp = function(rowKey) {
	var dev = _deviceData[rowKey];
	if (!dev) return;
	var label = dev.hostname || dev.mac;
	var current = dev.static_ip || dev.ip;
	var hint = dev.static_ip ? ' (clear to remove)' : '';
	var newIp = window.prompt('Static IP for ' + label + hint + ':', current);
	if (newIp === null) return; // cancelled
	newIp = newIp.trim();
	if (newIp === '') {
		if (!dev.static_ip) return; // nothing to remove
		callRemoveStaticIp(dev.mac).then(function(r) {
			if (!r || !r.success) window.alert('Failed to remove static IP');
		}).catch(function() {
			window.alert('RPC error');
		});
	} else {
		callSetStaticIp(dev.mac, newIp, dev.hostname).then(function(r) {
			if (!r || !r.success) window.alert('Failed to set static IP');
		}).catch(function() {
			window.alert('RPC error');
		});
	}
};

// ── HW offloading toggle handler ─────────────────────────────────────────────

window.starlinkToggleHwOffloading = function(chk) {
	chk.disabled = true;
	var fn = chk.checked ? callEnableHwOffloading : callDisableHwOffloading;
	fn().then(function(r) {
		if (!r || !r.success) chk.checked = !chk.checked;
		chk.disabled = false;
	}).catch(function() {
		chk.checked = !chk.checked;
		chk.disabled = false;
	});
};

// ── Apply config handler (global so inline onclick can reach it) ─────────────

window.starlinkApplyConfig = function(btn) {
	if (btn.disabled) return;
	_cfgApplying = true;
	_cfgApplyStartTime = Date.now();
	btn.disabled = true;
	btn.textContent = '⟳ Applying…';
	callApplyStarlinkConfig().then(function(r) {
		if (!r || !r.started) {
			_cfgApplying = false;
			_cfgApplyStartTime = 0;
		}
	}).catch(function() {
		_cfgApplying = false;
		_cfgApplyStartTime = 0;
	});
};

// ── DNS mode selector handler ─────────────────────────────────────────────────

window.starlinkSetDnsMode = function(sel) {
	var mode = sel.value;
	var prev = sel.getAttribute('data-prev') || mode;
	sel.disabled = true;
	sel.setAttribute('data-prev', mode);
	var calls = {
		'default':  callSetDnsDefault,
		'starlink': callSetDnsStarlink,
		'family':   callSetDnsFamily,
		'malware':  callSetDnsMalware,
	};
	var fn = calls[mode];
	if (!fn) { sel.disabled = false; return; }
	fn().then(function(r) {
		if (!r || !r.success) sel.value = prev; // revert on failure
		sel.disabled = false;
	}).catch(function() {
		sel.value = prev;
		sel.disabled = false;
	});
};

// ── Toggle home page handler ──────────────────────────────────────────────────

window.starlinkToggleHome = function(btn) {
	if (btn.disabled) return;
	btn.disabled = true;
	var isHome = btn.getAttribute('data-ishome') === 'true';
	var call = isHome ? callUnsetHomePage() : callSetHomePage();
	call.then(function() {
		var nowHome = !isHome;
		btn.setAttribute('data-ishome', nowHome ? 'true' : 'false');
		btn.textContent = nowHome ? '🏠 Default Home Page (click to revert)' : '🏠 Set as Default Home Page';
		btn.style.background  = nowHome ? '#1a7f37' : 'var(--sl-inset)';
		btn.style.borderColor = nowHome ? '#2ea043' : 'var(--sl-muted)';
		btn.style.color       = nowHome ? '#fff'    : 'var(--sl-muted)';
		btn.disabled = false;
	}).catch(function() {
		btn.disabled = false;
	});
};

// ── View ──────────────────────────────────────────────────────────────────────

return view.extend({
	handleSaveApply: null,
	handleSave:      null,
	handleReset:     null,

	load: function() {
		return Promise.all([ callStatus(), callDish(), callStarlinkConfigStatus(), callDevices(), callRouterStats() ]);
	},

	render: function(data) {
		var self = this;
		var container = E('div');
		this._updateView(container, data[0] || {}, data[1] || {}, data[2] || {}, data[3] || {}, data[4] || {});

		poll.add(function() {
			return Promise.all([ callStatus(), callDish(), callStarlinkConfigStatus(), callDevices(), callRouterStats() ]).then(function(d) {
				var s = d[0] || {};
				self._updateView(container, s, d[1] || {}, d[2] || {}, d[3] || {}, d[4] || {});
			});
		}, 10);

		return container;
	},

	_updateView: function(container, s, d, cs, devData, rs) {
		var dishState = (d && d.available) ? (d.state || 'UNKNOWN') : null;
		var isConn    = dishState === 'CONNECTED';
		var now       = new Date().toLocaleTimeString();

		var html = CSS;
		html += '<div class="sl-wrap">';

		// Header
		html += '<div class="sl-header">';
		html += '<div class="sl-title">🛸 Starlink Control</div>';
		html += '<div class="sl-meta">';
		if (dishState) {
			html += badge(dishState, isConn ? 'ok' : 'warn') + ' ';
		}
		html += '<span style="color:var(--sl-muted)">Updated ' + now + '</span>';
		html += '<a href="https://github.com/bigmalloy/openwrt-starlink-control" target="_blank" rel="noopener" ' +
			'style="color:var(--sl-muted);text-decoration:none;display:flex;align-items:center;gap:4px" ' +
			'title="GitHub">' +
			'<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0">' +
			'<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 ' +
			'0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 ' +
			'1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 ' +
			'0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 ' +
			'2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 ' +
			'3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>' +
			'</svg>' +
			'</a>';
		html += '</div></div>';

		// Cards grid
		html += '<div class="sl-grid">';
		html += buildDishCard(d);
		html += buildAlignmentCard(d);
		html += buildAlertsCard(d);
		html += buildIPv6Card(s, d);
		html += buildTrafficCard(s, d);
		html += buildQualityCard(s, d);
		html += buildRouterStatsCard(rs, s);
		html += buildDNSCard(s);
		html += buildConfigCard(s, cs);
		html += buildDevicesCard(devData, s);
		html += '</div>';

		html += '</div>';
		container.innerHTML = html;
	}
});
