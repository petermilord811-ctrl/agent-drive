'use strict';
// @tool remember each relay's last IP and dial it when the relay's NAME stops resolving (TLS still checks the name)
// @run  const ra = require('./relay-addr.js'); ra.fallbacks(host, file); ra.remember(host, ip, file)   (core/agent-join.js uses it)
// relay-addr -- A RELAY WHOSE NAME STOPPED RESOLVING IS NOT A RELAY THAT IS DOWN.
//
// Every reconnect that gave up so far gave up on DNS: all 4 give-ups and all 4 stalled.json files, and 59 of the
// 80 failed redials, were "getaddrinfo ENOTFOUND" for relay.example.com or 203-0-113-30.sslip.io -- while the
// relay itself was up. So the address a relay's name resolved to is remembered whenever a dial gets in, and when
// the name does not resolve the client dials that address instead. An sslip.io / nip.io name carries its own IP.
//
// The NAME is never replaced, only the lookup: it still goes in the TLS handshake (SNI) and the certificate is
// still checked against it, so a remembered IP that now belongs to someone else fails the handshake instead of
// being trusted. Pure apart from the small JSON file it keeps (work/relay-ips.json by default; never committed).
const fs = require('fs'), path = require('path'), net = require('net');

const DEFAULT_FILE = path.join(__dirname, '..', 'work', 'relay-ips.json');

// the errors that mean "the name did not resolve", as opposed to "the relay refused / timed out"
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA', 'EAI_NONAME']);
const dnsFailed = (e) => !!e && DNS_CODES.has(String(e.code || ''));

// 203-0-113-30.sslip.io, 10.0.0.1.nip.io, app.10-0-0-1.sslip.io -> the IP inside the name
function ipFromName(host) {
  const m = /(?:^|[.-])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})\.(?:sslip\.io|nip\.io)\.?$/i.exec(String(host || ''));
  if (!m) return '';
  const p = m.slice(1, 5).map(Number);
  return p.every((n) => n >= 0 && n <= 255) ? p.join('.') : '';
}

function load(file) {
  try { const j = JSON.parse(fs.readFileSync(file || DEFAULT_FILE, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; }
  catch (_) { return {}; }
}

// A dial got in: remember where the name pointed. IP literals and loopback are not worth remembering.
function remember(host, ip, file) {
  host = String(host || '').toLowerCase(); ip = String(ip || '').replace(/^::ffff:/i, '');
  if (!host || !ip || net.isIP(host) || !net.isIP(ip) || host === 'localhost') return false;
  const f = file || DEFAULT_FILE, j = load(f);
  if (Object.prototype.hasOwnProperty.call(j, host) && j[host] && j[host].ip === ip) return false;
  j[host] = { ip, at: new Date().toISOString() };
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 1)); return true; } catch (_) { return false; }
}

// Where to dial when `host` does not resolve: the address it last resolved to, then the one its name carries.
function fallbacks(host, file) {
  host = String(host || '').toLowerCase();
  const j = load(file), out = [];
  const known = Object.prototype.hasOwnProperty.call(j, host) && j[host] && j[host].ip;
  if (known && net.isIP(known)) out.push(known);
  const own = ipFromName(host);
  if (own && !out.includes(own)) out.push(own);
  return out;
}

module.exports = { dnsFailed, ipFromName, remember, fallbacks, DEFAULT_FILE };
