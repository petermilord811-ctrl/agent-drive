#!/usr/bin/env node
/**
 * Build think/type pacing so autofill lands inside the bio time window.
 *
// @tool Build answer.pace.json timing for Part B autofill
 * @run node skills/take-dataannotation-assessment/pace-plan.js --bio-min 30 --bio-max 60 --fetch-min 10 --gen-min 10 --fields 24
// @tool Build answer.pace.json timing for Part B autofill
 * @run node skills/take-dataannotation-assessment/pace-plan.js --bio-min 30 --bio-max 60 --fetch-min 10 --gen-min 10 --fill path/answer.fill.json --out path/answer.pace.json
 *
 * Chemistry example: bio 30–60, fetch 10, gen 10 → remaining 10–40 for fill.
 * First field per step: ~10–30s think. Later fields on same step: ~5–15s.
 */
const fs = require('fs');
const path = require('path');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] != null) return process.argv[i + 1];
  return fallback;
}

function num(name, fallback) {
  const v = arg(name, null);
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse bio cues like "30-60 minutes", "60–90", "1 hour or more" */
function parseBioCue(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/–|—/g, '-').replace(/~/g, '-');
  const range = t.match(/(\d+)\s*(?:min(?:ute)?s?)?\s*-\s*(\d+)\s*(?:min(?:ute)?s?|hour)/i);
  if (range) {
    let a = +range[1];
    let b = +range[2];
    if (/hour/.test(range[0]) && b <= 5) b *= 60;
    if (/hour/.test(range[0]) && a <= 5 && !/min/.test(range[0])) a *= 60;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const hours = t.match(/(\d+(?:\.\d+)?)\s*hour/);
  if (/or more|at least|1 hour or more/.test(t) && hours) {
    const m = Math.round(parseFloat(hours[1]) * 60);
    return { min: m, max: m + 30 };
  }
  if (hours) {
    const m = Math.round(parseFloat(hours[1]) * 60);
    return { min: m, max: m };
  }
  const single = t.match(/(\d+)\s*min/);
  if (single) return { min: +single[1], max: +single[1] };
  return null;
}

let bioFrom = parseBioCue(arg('bio', ''));
const bankArg = arg('bank', '');
if (!bioFrom && bankArg && fs.existsSync(bankArg)) {
  const md = fs.readFileSync(bankArg, 'utf8');
  bioFrom =
    parseBioCue(md) ||
    (/1 hour or more/i.test(md) ? { min: 60, max: 90 } : null) ||
    (() => {
      const m = md.replace(/[—–]/g, '-').match(/(\d+)\s*-\s*(\d+)\s*minutes/i);
      return m ? { min: +m[1], max: +m[2] } : null;
    })();
}
const bioMin = num('bio-min', bioFrom ? bioFrom.min : 30);
const bioMax = num('bio-max', bioFrom ? bioFrom.max : 60);
const fetchMin = num('fetch-min', 0);
const genMin = num('gen-min', 0);
const fillPath = arg('fill', '');
const outPath = arg('out', '');
const seed = num('seed', Date.now() % 100000);

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);

function estimateTypeMs(value, type) {
  const s = Array.isArray(value) ? value.join(' ') : String(value || '');
  const chars = s.length;
  if (type === 'radio' || type === 'checkbox' || type === 'agree' || type === 'drag' || type === 'skip') {
    return type === 'drag' ? 8000 + chars * 20 : 1500;
  }
  // ScreenMirror auto-type ~70 wpm (normal) ≈ 5.8 chars/s → ms
  const cps = 5.5;
  return Math.round((chars / cps) * 1000) + 400;
}

let actions = [];
if (fillPath) {
  if (!fs.existsSync(fillPath)) {
    console.error('fill file not found: ' + fillPath);
    process.exit(2);
  }
  const fill = JSON.parse(fs.readFileSync(fillPath, 'utf8'));
  actions = Array.isArray(fill.actions) ? fill.actions : [];
} else {
  const n = num('fields', 12);
  for (let i = 0; i < n; i++) {
    actions.push({
      id: 'field_' + (i + 1),
      step: Math.floor(i / 2) + 1,
      type: i % 2 === 0 ? 'radio' : 'textarea',
      value: i % 2 === 0 ? 'choice' : 'x'.repeat(120),
      firstInStep: i % 2 === 0,
    });
  }
}

// Annotate firstInStep if missing
let prevStep = null;
for (const a of actions) {
  const step = a.step != null ? a.step : a.stepKey || '';
  if (a.firstInStep == null) a.firstInStep = step !== prevStep;
  prevStep = step;
}

const remainingMinLow = Math.max(0, bioMin - fetchMin - genMin);
const remainingMinHigh = Math.max(remainingMinLow, bioMax - fetchMin - genMin);
const targetFillMin =
  remainingMinLow + rand() * Math.max(0.001, remainingMinHigh - remainingMinLow);
const targetFillMs = Math.round(targetFillMin * 60 * 1000);

const typeMsTotal = actions.reduce(
  (sum, a) => sum + estimateTypeMs(a.value, a.type),
  0
);
let thinkBudget = Math.max(0, targetFillMs - typeMsTotal);

const firstCount = actions.filter((a) => a.firstInStep && a.type !== 'skip').length;
const laterCount = actions.filter((a) => !a.firstInStep && a.type !== 'skip').length;

// Preferred think band (ms). Soft max lets leftover bio time stretch so fill is not too soon.
const FIRST_LO = 10000;
const FIRST_HI = 30000;
const FIRST_SOFT = 90000;
const LATER_LO = 5000;
const LATER_HI = 15000;
const LATER_SOFT = 45000;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Weight first fields ~2x later fields
const weightSum = firstCount * 2 + laterCount * 1 || 1;
const unit = thinkBudget / weightSum;

const paced = actions.map((a) => {
  if (a.type === 'skip') {
    return { ...a, thinkMs: 0, typeMs: 0, pauseMs: 0 };
  }
  const typeMs = estimateTypeMs(a.value, a.type);
  let thinkMs;
  if (a.firstInStep) {
    thinkMs = clamp(Math.round(unit * 2 * (0.85 + rand() * 0.3)), FIRST_LO, FIRST_SOFT);
  } else {
    thinkMs = clamp(Math.round(unit * 1 * (0.85 + rand() * 0.3)), LATER_LO, LATER_SOFT);
  }
  return { ...a, thinkMs, typeMs, pauseMs: thinkMs };
});

// Rescale thinks toward budget (prefer preferred band; allow soft max when ahead of pace)
function rescaleThinks(scale) {
  for (const a of paced) {
    if (a.type === 'skip') continue;
    const lo = a.firstInStep ? FIRST_LO : LATER_LO;
    const hi = a.firstInStep ? FIRST_SOFT : LATER_SOFT;
    a.thinkMs = clamp(Math.round(a.thinkMs * scale), lo, hi);
    a.pauseMs = a.thinkMs;
  }
}

let thinkSum = paced.reduce((s, a) => s + a.thinkMs, 0);
if (thinkSum > 0 && thinkBudget > 0) {
  const scale = thinkBudget / thinkSum;
  if (scale < 0.95 || scale > 1.05) rescaleThinks(scale);
  thinkSum = paced.reduce((s, a) => s + a.thinkMs, 0);
  // leftover after soft caps → between-step dwell on firstInStep actions
  let leftover = Math.max(0, thinkBudget - thinkSum);
  if (leftover > 2000 && firstCount > 0) {
    const add = Math.floor(leftover / firstCount);
    for (const a of paced) {
      if (a.firstInStep && a.type !== 'skip') {
        a.thinkMs += add;
        a.pauseMs = a.thinkMs;
      }
    }
  }
}

const totalThink = paced.reduce((s, a) => s + a.thinkMs, 0);
const totalType = paced.reduce((s, a) => s + a.typeMs, 0);
const totalMs = totalThink + totalType;

const result = {
  ok: true,
  seed,
  bioMinutes: { min: bioMin, max: bioMax },
  spentBeforeFillMinutes: { fetch: fetchMin, generate: genMin },
  remainingMinutes: { min: remainingMinLow, max: remainingMinHigh },
  targetFillMinutes: Math.round(targetFillMin * 10) / 10,
  totals: {
    actions: paced.length,
    thinkMs: totalThink,
    typeMs: totalType,
    fillMs: totalMs,
    fillMinutes: Math.round((totalMs / 60000) * 10) / 10,
  },
  rules: {
    firstFieldThinkMs: [FIRST_LO, FIRST_HI],
    firstFieldSoftMaxMs: FIRST_SOFT,
    laterFieldThinkMs: [LATER_LO, LATER_HI],
    laterFieldSoftMaxMs: LATER_SOFT,
    typing: 'ScreenMirror keys auto-type (never human:0)',
  },
  actions: paced.map((a) => ({
    id: a.id,
    step: a.step,
    type: a.type,
    firstInStep: !!a.firstInStep,
    thinkMs: a.thinkMs,
    typeMs: a.typeMs,
    pauseMs: a.pauseMs,
  })),
};

const text = JSON.stringify(result, null, 2);
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, text + '\n', 'utf8');
}
process.stdout.write(text + '\n');
