# docs/reference/unattended-access.md — running an agent on a desk while you sleep

The agent-drive serve client can only get onto a machine the way a person is let in: someone **presses
Allow** — *unless* the machine's **owner** has deliberately turned on auto-allow for it (off by default;
see the last section). This note is the honest account of what that means for an *unattended* overnight
run, why a naive "just connect automatically" does not work without that opt-in, and the relay change +
habit (or the auto-allow opt-in) that give a real multi-hour window. Facts here are cited to
`tools/ws-server.js` so they can be re-checked.

## The short version

1. A join needs **one human Allow press** — *unless* the machine's owner has turned on **owner
   auto-allow** for it (off by default; last section). That one override aside, the press is the only
   way in.
2. A granted visit is **hard-ended after `SM_JOIN_MINUTES` minutes** (default **60**). Re-approval needs
   another press — impossible if everyone is asleep — *unless* auto-allow is on, which re-approves a
   reconnect within its window.
3. The Allow card only reaches **someone who can SEE the host** (watching its stream, or an owner with a
   viewer open). If nobody is watching, the ask comes back `nobody` and no card ever appears. Auto-allow
   raises no card at all, so it needs no watcher.

So for a true overnight window **without** auto-allow: **raise `SM_JOIN_MINUTES`, restart the relay, keep
a signed-in viewer open on the host, then press Allow once.** Or turn on owner auto-allow (last section)
and none of that is needed. Details below.

## Why a single tap is the default

The join key (`SM_JOIN_KEY`) is only the right to *ask* — it puts a card in front of whoever can see the
machine. The grant itself comes from a person pressing Allow: `ws-server.js` is explicit at the
`join-allow` handler — *"ANYONE WHO CAN SEE THE DESK MAY LET AN AGENT ONTO IT, and the FIRST PRESS
DECIDES"* (around `ws-server.js:24965`). `SM_AUTO_CONFIRM` / `--auto-confirm` does **not** change this:
it governs the *in-session* confirm gate for dangerous actions, never the door. The one deliberate
exception is **owner auto-allow** (last section): it does not route around the consent boundary so much
as let the owner pre-make the decision, per machine, for a machine that is theirs.

## The 60-minute reaper

The grant's lifetime is `JOIN_GRANT_MS` (`ws-server.js:22014`):

```js
const JOIN_GRANT_MS = Math.max(5, Math.min(24 * 60, parseInt(process.env.SM_JOIN_MINUTES, 10) || 60)) * 60 * 1000;
```

So it is `SM_JOIN_MINUTES` minutes — **default 60, floor 5, ceiling 1440 (24 h)**. A timer set when the
grant is made (`ws-server.js:22104`) releases the visit when it fires and sends the client
`access-denied: "that visit has ended"`; the same expiry is also checked on every incoming message. When
it ends, getting back in needs a fresh Allow press — which needs a watcher — **or** owner auto-allow,
which re-approves the reconnect silently within its own (longer) window. This reaper is what silently
ends a long unattended run that has only a single tap behind it (it looks like a mysterious disconnect
~an hour in).

## Keep a viewer open on the host

Because the Allow card is only shown to an operator who can see the host, a host that is online but
**unwatched** answers an agent's join with `nobody` and shows no card at all. Keeping one signed-in
ScreenMirror viewer open on the host fixes two things at once: it guarantees the card has somewhere to
appear (so your one tap can land), and it keeps the host from **drifting between relays** mid-wait (the
drift is what expires a code before a tap reaches it — see `config/connection.md`). With owner auto-allow
on, the card is skipped entirely, so no watcher is needed to get in — but drift is still worth avoiding,
and the agent's own reconnect follows the host across relays (see `agent-drive-auto-reconnect`).

## The recipe for a real overnight window

On the relay host:

```bash
# 1. give grants a long life (8 hours here; max 24h)
export SM_JOIN_MINUTES=480          # or set it in the relay's environment / unit file
sudo systemctl restart sm-relay     # the relay reads this at boot

# 2. keep a signed-in viewer open on the target host (a browser tab or the desktop app, watching it)
# 3. start the agent, surface the code, and press Allow ONCE
```

One Allow then covers the whole night (up to `SM_JOIN_MINUTES`). Without step 1 you get ~60 minutes;
without step 2 the card may have nobody to appear to. **Or** skip steps 2 and 3 entirely with owner
auto-allow (next section), which is the real hands-off path.

## Caution: a known `--auto-confirm` bug (awaiting your review)

`--auto-confirm` / `SM_AUTO_CONFIRM` (shipped in commit `98b7ab4`, in `core/agent-join.js`) has a
consent-safety flaw found this session: a **socket drop during a confirm window is read as silence and
auto-approves** the dangerous action. It is deliberately **not** silent-patched, because the fix is a
consent decision for the operator. Until it is reviewed, do not treat `--auto-confirm` as a safe
unattended gate across a flaky link — a dropped socket mid-confirm can approve something you did not see.

## Agent auto-allow (BUILT — off by default)

A hands-off operator wants an agent to join without a per-join Allow press. That lowers the "someone
present must consent each time" protection, so it is OFF by default and only the relay operator turns it
on, with `SM_AGENT_AUTOALLOW`. It has two levels — pick the trade you want.

### `SM_AGENT_AUTOALLOW=1` (or `on` / `all`) — allow-all

The simple one, and what a single-owner fleet usually wants. A valid join key is enough to join **any
non-private host** with no card and no watcher — no per-host setup at all. The relay still mints the grant
under a real account that holds the host (an owner, else an admin), so `viewerAccess` scopes it exactly as
that person's Allow press would; it just doesn't ask them.

The trade is blunt and worth stating: **the key becomes the whole authorisation for the non-private
fleet.** Anyone holding `SM_JOIN_KEY` gets no-tap control of every non-private host on the relay. So use a
**dedicated, rotatable** `SM_JOIN_KEY`, and rotate it to revoke everything at once.

### `SM_AGENT_AUTOALLOW=policy` — per-host

The granular one. Nothing auto-allows until an account that holds a machine stores a per-host
pre-authorisation for it:

```bash
# on the relay box (same shell-on-the-machine trust anchor as --adduser / --allow):
node ws-server.js --agent-allow <owner-account> <host-id> <agent-key> \
                  [--control] [--shell] [--minutes N] [--label name]
node ws-server.js --agent-allows [<owner-account>]              # list what is pre-authorised
node ws-server.js --agent-revoke <owner-account> [<host-id>]    # remove it
```

The `<agent-key>` is the key the agent presents (its `SM_JOIN_KEY`); only its SHA-256 hash is stored. The
owner must already hold `<host-id>`. Powers default to watch-only; `--control` / `--shell` add those, and a
join may never request more than was pre-authorised. Policy mode keeps all of:

1. Set only by an account that **holds the machine**, read LIVE — a suspended owner authorises nothing.
2. **Per host**, powers a **subset** of what was granted — a bigger request falls back to the card.
3. **Time-boxed** — default 12 h, max 30 days; no / zero / past expiry is dead, not eternal.
4. **Covers reconnects** inside the window, so the `SM_JOIN_MINUTES` reaper does not end a long run.

### Either way

A join is checked **before** any card is raised: the anchor is `autoAllowMatch` beside `joinAskWho`
(`ws-server.js`), called from the `join-begin` handler. On a match it synthesises the grant through
`joinGrant` under the chosen account and logs it; on no match it falls straight through to the human card.
And in both modes:

- A **private host is never auto-joinable** (the handler refuses it upstream, before auto-allow is reached).
- Every auto-grant is **audited** — an `agent-auto-granted` row (distinct from a human `agent-granted`,
  carrying `mode: all | policy`) and a loud `AUTO-joined host …` log line, so it is never silent.
- A live visit is **revocable at once** by the dashboard **stop button** (`join-revoke`), auto or not;
  turning the switch off (and restarting) stops all new auto-joins.

The relay reads `SM_AGENT_AUTOALLOW` at boot and the account store at (re)start, so set the switch (and
any policy entries), then start the relay. The switch is **per relay** — in a federation, set it on every
relay a host may drift to, not just one. (The `--agent-allow` entries live in the shared database and are
seen fleet-wide; the code + the switch are per-relay.)

**Still deferred:** an owner **notification** (Slack/push) on each auto-allowed join — the audit row + log
line cover "never silent" today, but a per-join DM is a clean follow-up. The policy setter is the relay
CLI; a dashboard control is a nice-to-have on top.

**Tested:** `tests/agent_autoallow.js` — `autoAllowMatch` across all three modes in a vm (off; allow-all
scoping + private/unknown refusals; policy fail-closed on wrong key, expiry, powers-not-a-subset,
suspended / non-owner, private, no-entry), plus a live relay proving an allow-all no-tap join with nobody
watching, that it is fleet-wide, that a wrong key is still refused, and that the stop button ends an
auto-granted visit.
