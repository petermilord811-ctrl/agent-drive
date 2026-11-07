# Click position rules (DataAnnotation roles UI)

Live miss on host **34123** (2026-11-07): guessed `Continue` at look `~833,375` while the
real button mid was **`834,312`** (~60 px too low). Clicks “succeeded” but the page did not
change. Operator: *fix position calc before fetching problems*.

## Hard rules

1. **Always `look` first**, then measure from **that** PNG. Never reuse coords from an earlier role/page.
2. Prefer **`click {lx, ly}`** from the current look (serve scales). Do not invent screen `x,y`.
3. **Do not guess.** Run:

```bash
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> continue
python -I skills/take-dataannotation-assessment/locate-click.py <look.png> role "Software Engineer"
```

4. On 34123, **`find` / OCR is unreliable** for “Continue” (often fails). Use `locate-click.py continue`
   (largest wide blue button in the right panel). For role titles, `find` one distinctive word then
   click `at`, or use `locate-click.py role` only as a coarse grid hint.
5. After every click: **look again**. Same URL + same layout = miss → re-measure, do not nudge by habit.
6. Blue-pixel “whole sidebar” averages are wrong — require button shape: **w≥80, 22≤h≤70, w/h≥2.2**.

## Proven

| Target | look mid | Result |
|--------|----------|--------|
| SE `Continue` | `834,312` | opened assessment intro (“Start assessment”) |
| SE card (via `find` “Software”) | serve `at` | opened role overview |

## Bank

Captures go to `skills/take-dataannotation-assessment/problems/problems-{role-slug}.md` only
(**103** roles = Browse **All 103**).
