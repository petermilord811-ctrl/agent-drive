'use strict';
// @tool judge a capture's LIVENESS by measuring, not looking: a blank/uniform frame, a frozen one, or real moving pixels
// @run  const live = require('../vision/liveness.js')   (a library; a long loop or recover-a-stuck-session calls it)
// liveness.js -- IS THIS CAPTURE SHOWING LIVE, VALID PIXELS? Answered in integers, with no recognizer.
//
// WHY THIS EXISTS. The capture never reaches the model (see core/agent-eyes.js): the agent reasons from a
// description of a screen it cannot look at, so it cannot NOTICE that the screen has gone blank or frozen.
// Two failures each look exactly like a valid frame, and they are the ones that quietly waste a long
// unattended run -- the agent keeps acting on pixels that are dead or stale:
//   * BLANK  -- the stream is a near-solid colour. Maximising a window blanks the capture (a documented
//               gotcha, docs/reference/gotchas.md); a half-loaded page or a just-cleared canvas do the same.
//               Acting on it clicks into a void and every read is a lie.
//   * FROZEN -- two captures of the same scene are byte-for-byte the same. The socket went quiet and the
//               host is replaying one stale frame; the agent reads a screen that stopped being true.
// Both are caught here by MEASURING, the way agent-eyes measures: dominant-colour coverage for blank, a
// pixel diff for frozen. "Nothing changed" is only EVIDENCE of frozen when change was expected -- so the
// caller supplies that context (a rect around a known-moving element -- a clock, the cursor; or a shot
// taken right after an action that should have changed the screen). Any change at all, however small,
// reads as live: a caret blink or a ticking second is not a freeze.
//
// DECODE-AWARENESS. agent-eyes decodes a PNG only as far down as asked, so a frame still arriving has
// img.rows < img.h, and eyes.clampRect silently shrinks a rect to the decoded front. A verdict taken over
// a region that is not actually decoded would be confident and wrong (a decoded uniform title bar read as
// a blank screen; a not-yet-arrived frame read as frozen). So assess() REFUSES to judge a region the
// current frame does not cover (eyes.covers), returning 'unknown' until enough has arrived.
//
// Pure functions over agent-eyes' decoded picture ({w,h,bpp,px,stride,rows}): no socket, no host, offline.
const eyes = require('../core/agent-eyes.js');

// Dominant-colour coverage of a rectangle, by SAMPLING a grid of points rather than scanning every pixel:
// a blank screen needs no full scan to be recognised, and a photograph would make census (connected
// regions) crawl. Returns the dominant hex, its share of the samples (0..1), how many DISTINCT colours
// were seen, the sample count, and whether the frame actually COVERS the requested rect (a false `covered`
// means the coverage figure describes only the decoded sub-region, not the whole rect you asked about).
function uniformity(img, rect, opts) {
  const o = opts || {};
  if (!img || !img.ready) return { ok: false, why: 'no picture' };
  const r = eyes.clampRect(img, rect || {});
  if (r.w < 1 || r.h < 1) return { ok: false, why: 'empty rectangle', covered: eyes.covers(img, rect) };
  const g = Math.max(2, Math.min(256, o.grid || 48));
  const counts = new Map();
  let samples = 0, top = 0, dom = null;
  for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) {
    const x = r.x + Math.floor((i + 0.5) * r.w / g), y = r.y + Math.floor((j + 0.5) * r.h / g);
    const v = eyes.probe(img, x, y);                 // '#rrggbb', or null outside the DECODED rows
    if (v == null) continue;
    const n = (counts.get(v) || 0) + 1; counts.set(v, n); samples++;
    if (n > top) { top = n; dom = v; }
  }
  if (!samples) return { ok: false, why: 'nothing sampled -- the region is not decoded yet', covered: false };
  return { ok: true, dominant: dom, coverage: top / samples, distinct: counts.size, samples, covered: eyes.covers(img, rect) };
}

// BLANK = one colour OVERWHELMS the frame (>= 99.9% of sampled points by default) with very few other
// colours. The defaults target a SOLID capture -- the maximise-blanked-it frame reads ~1.0 coverage over
// one colour (PNG is lossless, so a true blank has no sub-quantisation noise to inflate the colour count).
// A page with even a little content falls below 99.9% and is NOT blank; a near-empty page (content under
// ~0.1% of the frame) can still read blank, so lower `blank` only if such a false negative would matter.
// Tune with {blank, maxDistinct, grid}. `covered` is passed through so a caller knows if the frame was
// only partially decoded over the rect.
function isBlank(img, rect, opts) {
  const o = opts || {}, u = uniformity(img, rect, opts);
  if (!u.ok) return Object.assign({ blank: false }, u);
  const blank = u.coverage >= (o.blank != null ? o.blank : 0.999) &&
                u.distinct <= (o.maxDistinct != null ? o.maxDistinct : 4);
  return { ok: true, blank, coverage: u.coverage, dominant: u.dominant, distinct: u.distinct, samples: u.samples, covered: u.covered };
}

// FROZEN = two captures of the same scene that are identical over the compared region. By DEFAULT that
// means zero pixels changed (a byte-for-byte replay); any change at all, however small, is not a freeze
// (so a caret blink or a ticking clock on an otherwise still screen reads live, not frozen). Pass {min} to
// accept a small SHARE of changed pixels as frozen instead, or {minPx} for an absolute changed-pixel floor.
// A width OR height difference means the frames are not comparable (ok:false) -- that is a resize, not a
// freeze.
function isFrozen(prev, cur, rect, opts) {
  const o = opts || {};
  if (prev && cur && prev.ready && cur.ready && (prev.w !== cur.w || prev.h !== cur.h))
    return { ok: false, frozen: false, why: 'frames are different sizes' };
  const d = eyes.diff(prev, cur, rect);
  if (!d.ok) return { ok: false, frozen: false, why: d.why };
  const frozen = o.min != null ? d.share <= o.min : d.px <= (o.minPx != null ? o.minPx : 0);
  return { ok: true, frozen, share: d.share, px: d.px, box: d.box };
}

// THE COMBINED VERDICT a caller acts on. `cur` is the latest capture; `prev` (optional) is an earlier one
// of the same scene for the frozen check. Returns a state, whether it is SAFE to read/act on (`ok`), the
// evidence, and plain advice:
//   'blank'   one colour overwhelms it              ok:false  restore the window / new tab / resync, re-check
//   'frozen'  prev & cur identical over the region  ok:false  nudge the cursor or resync; re-check vs a clock
//   'live'    content, and prev -> cur changed       ok:true   good
//   'static'  content, but no comparable prev frame  ok:true   readable; motion unverified
//   'unknown' no current picture, or it is not decoded far enough for the region   ok:false
// assess REFUSES a verdict over a region the current frame does not cover (a partial decode), returning
// 'unknown' rather than a confident-but-wrong blank/frozen.
function assess(prev, cur, opts) {
  const o = opts || {}, rect = o.rect;
  if (!cur || !cur.ready) return { state: 'unknown', ok: false, why: 'no current picture' };
  if (!eyes.covers(cur, rect)) return { state: 'unknown', ok: false, why: 'the current capture is not decoded far enough for this region -- fetch more, then re-check' };
  const b = isBlank(cur, rect, o);
  if (b.blank) return { state: 'blank', ok: false, coverage: b.coverage, dominant: b.dominant, distinct: b.distinct,
    advice: 'the capture is a near-solid ' + b.dominant + ' -- likely blanked (a maximised window is the usual cause) or still loading; restore the window / open a new tab / resync, then look again' };
  if (prev && prev.ready && eyes.covers(prev, rect)) {
    const f = isFrozen(prev, cur, rect, o);
    if (f.ok && f.frozen) return { state: 'frozen', ok: false, share: f.share, px: f.px, coverage: b.coverage,
      advice: 'the two captures are identical over this region (' + f.px + ' pixels changed) -- the stream may be stale; nudge the cursor or resync, then re-check against a known-moving element such as a clock' };
    if (f.ok) return { state: 'live', ok: true, share: f.share, px: f.px, coverage: b.coverage };
    // diff could not compare the two (a width OR height change -- a resize) -- not a freeze; single-frame.
    return { state: 'static', ok: true, coverage: b.coverage, note: 'could not compare to the earlier frame (' + f.why + ')' };
  }
  return { state: 'static', ok: true, coverage: b.coverage, note: 'content present; no comparable earlier frame, so motion is unverified' };
}

module.exports = { uniformity, isBlank, isFrozen, assess };
