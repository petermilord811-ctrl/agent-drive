// relay_addr.js — core/relay-addr.js: a relay whose NAME stopped resolving is dialled at the
// address it last had (every reconnect that gave up so far gave up on getaddrinfo ENOTFOUND while the relay was up).
// Offline; a temp file stands in for work/relay-ips.json.
//   node tests/relay_addr.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const ra = require(path.join(__dirname, '..', 'core', 'relay-addr.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL: ' + m); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-addr-'));
const file = path.join(dir, 'sub', 'relay-ips.json');

try {
  // which errors are DNS
  ok(ra.dnsFailed({ code: 'ENOTFOUND' }) && ra.dnsFailed({ code: 'EAI_AGAIN' }), 'ENOTFOUND / EAI_AGAIN are a lookup failure');
  ok(!ra.dnsFailed({ code: 'ECONNREFUSED' }) && !ra.dnsFailed({ code: 'ETIMEDOUT' }) && !ra.dnsFailed(null), 'a refusal or a timeout is not');

  // the IP an sslip.io / nip.io name carries
  ok(ra.ipFromName('203-0-113-30.sslip.io') === '203.0.113.30', '203-0-113-30.sslip.io');
  ok(ra.ipFromName('10.0.0.1.nip.io') === '10.0.0.1', '10.0.0.1.nip.io');
  ok(ra.ipFromName('relay.203-0-113-30.sslip.io') === '203.0.113.30', 'a sub-name of sslip.io');
  ok(ra.ipFromName('relay.example.com') === '' && ra.ipFromName('999-1-1-1.sslip.io') === '' && ra.ipFromName('') === '', 'no IP in other names');

  // nothing remembered yet: only what the name carries
  ok(JSON.stringify(ra.fallbacks('relay.example.com', file)) === '[]', 'an unknown name has no fallback');
  ok(JSON.stringify(ra.fallbacks('203-0-113-30.sslip.io', file)) === '["203.0.113.30"]', 'an sslip.io name falls back to its own IP');

  // a dial got in: remembered (the folder is made), IPv4-mapped addresses unwrapped
  ok(ra.remember('Relay.Example.COM', '::ffff:203.0.113.30', file) === true, 'a successful dial is remembered');
  ok(JSON.stringify(ra.fallbacks('relay.example.com', file)) === '["203.0.113.30"]', '...and is the fallback for that name (case-insensitive)');
  ok(ra.remember('relay.example.com', '203.0.113.30', file) === false, 'the same address is not rewritten');
  ok(ra.remember('relay.example.com', '203.0.113.99', file) === true && ra.fallbacks('relay.example.com', file)[0] === '203.0.113.99', 'a moved relay updates');
  ra.remember('203-0-113-30.sslip.io', '203.0.113.30', file);
  ok(JSON.stringify(ra.fallbacks('203-0-113-30.sslip.io', file)) === '["203.0.113.30"]', 'remembered and carried IPs are not listed twice');

  // never remembered: IP literals, localhost, junk
  ok(!ra.remember('127.0.0.1', '127.0.0.1', file) && !ra.remember('localhost', '127.0.0.1', file) && !ra.remember('x.org', 'not-an-ip', file), 'IP literals, localhost and junk are not remembered');

  // a broken file is an empty memory, never a crash
  fs.writeFileSync(file, '{not json');
  ok(JSON.stringify(ra.fallbacks('relay.example.com', file)) === '[]', 'an unreadable file is an empty memory');
  fs.writeFileSync(file, JSON.stringify({ toString: { ip: '203.0.113.4' } }));
  ok(JSON.stringify(ra.fallbacks('constructor', file)) === '[]', 'prototype names are not entries');
} finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

console.log((fail ? 'FAIL' : 'ok') + ' relay_addr: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
