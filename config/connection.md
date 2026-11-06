# config/connection.md — getting (and keeping) a session

## Connect

```bash
SM_JOIN_KEY=<secret> node core/agent-join.js \
  --relay wss://<relay>.sslip.io --host <number> \
  --agent claude --task "<the job>" --control --serve ./work
```

- **Defaults from `.env`.** Put `SM_JOIN_KEY` and `SM_RELAY` in **`agent-drive/.env`** (copy
  `.env.example` and fill it) and they're read automatically at startup — then the command is just
  `node core/agent-join.js --host <number> --control --serve ./work`. An env var set inline still wins,
  and `--env <file>` / `SM_ENV_FILE` picks another file. `.env` is gitignored (it holds the secret) —
  **never commit it**; `.env.example` is the committed, value-less template.
- **`SM_JOIN_KEY`** is the right to *ask*, not the authorization. The relay must hold the same secret
  or it naks `off`.
- **`--control`** asks for keyboard + mouse at the door (needed for `--serve`). The person at the
  machine sees the task text and a code, and must press **Allow**.
- Surface the printed **code** to the operator and wait — it expires in ~2 minutes.

### Reading the handshake

The client says which stage it reached. Naks from `join-begin`:

| nak | meaning |
|-----|---------|
| `off` | the relay has no `SM_JOIN_KEY` set — joining is switched off |
| `no` | wrong key |
| `no-host` | no such machine here — offline, unreachable, or **on a different relay** (indistinguishable) |
| `nobody` | nobody who can see that machine is connected, so no one to ask |
| `denied` | a person refused |
| `slow-down` | too many requests — wait |

`let in … → machine … is open → serving WxH …` means you're driving. Note the `WxH`: **all
coordinates are pixels at that size.** If the *screen* (not the window) resizes mid-session, every
click is wrong and the client refuses — reconnect.

## The relay drifts — the client handles it

A host registers on one relay and **moves between them continuously**. `relay.example.com` is the
default domain; the live one has been `203-0-113-10.sslip.io`, `203-0-113-20.sslip.io`, and others.

- A `no-host` nak often means "the host moved", not "the host is off". Always use the sslip **name**
  (`203-0-113-20.sslip.io`), never the raw IP — TLS rejects the IP.
- **Connecting tries every relay in order** — `--relay` / `SM_RELAY` first, then each of `SM_RELAYS`
  (comma-separated). It re-asks on the relays the host is not on (`no-host` / `nobody` / `slow-down`)
  and gives up only on a reason retrying can't fix (`off` / `no` / `denied`).
- **…and it now finds a drifted host by itself.** When a relay doesn't have the host, its `no-host`
  answer carries that relay's **federation siblings** (for a key-holding caller — relay topology only, not
  which host is where), and the client adds them to the list and tries them. So a desk that is online but
  sat on a relay the default domain isn't pointing at right now is still found with just
  `--relay wss://relay.example.com` — you no longer have to know the current relay or fill `SM_RELAYS` by
  hand. (`SM_RELAYS` is still a useful seed when the default relay itself is unreachable.) Needs the relay
  deployed with the federation hint (ws-server.js); against an older relay, fall back to `SM_RELAYS`.

## When the socket drops — auto-reconnect (serve mode)

A live session does **not** ride a relay move: the socket goes stale and captures stop getting a reply.
In `--serve` mode the client now **reconnects by itself** — it notices the dead socket, redials the
relay list, asks for a fresh Allow, and resumes the command loop. The work dir, the notes board and the
frame size all survive, so your plan picks up where it paused. It does **not** reconnect after a person
*revokes* the grant (that's a decision, not a glitch): then it writes `stopped.json` and ends.

What appears in the work dir while it happens:

| file | meaning |
|------|---------|
| `reconnecting.json` | the socket dropped; the client is redialing and waiting for a new Allow |
| `reconnect.json` | `{code, relay}` — **surface this code to the operator**, same as the first connect |
| `ready.json` with `reconnected: N` | back in; commands flow again (the Nth reconnect) |
| `stalled.json` | gave up (no relay had the host, or the code expired) — a human is needed |

So when a command seems to hang, **read `reconnecting.json` / `reconnect.json` first.** If a code is
there, give it to the operator and wait — the command you sent runs once you're back in. Only if
`stalled.json` appears is manual help needed: ask the operator for the current relay, add it to
`SM_RELAYS`, and relaunch.

## Hand it back

When the task is done, end cleanly: `node drive/drive.js ./work '{"do":"quit"}'` (or Ctrl+C the client).
Don't sit holding control you aren't using.
