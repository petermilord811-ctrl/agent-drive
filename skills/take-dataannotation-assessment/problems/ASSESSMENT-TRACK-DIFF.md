# Cross-track assessment differences (host 34123)

**Rule:** Same *category* (e.g. Medical) can host **different major Starters**. Never copy leaves across tracks without leaf-by-leaf verify. Only **Software Engineer** + **Generalist** are operator-`verified` as of 2026-11-08.

## Major Starters observed

| Track line | Assessment | task_response_id | Branch A | Branch B | Specialization leaf? | Background wording |
|------------|------------|------------------|----------|----------|----------------------|--------------------|
| Medical Projects | Medical Starter | `01a1b7f8` | ~18 | ? | ? | domain-specific (pending re-verify) |
| Radiologists Projects | Radiology Starter V4.1 | `01a1bcf2` | **17** (credentials) | **16** (Conversation) | **No** | generic / Radiology domain Conversation |
| Surgical Medicine Projects | Surgical+Perioperative Starter V4.1 | `01a1bd0d` | **19** | **17** (Conversation; keeps Specialization) | **Yes** — Anesthesiology / Orthopedics / Otolaryngology / Surgery / None (**5**) | **Surgical or Perioperative-related** |
| Internal Medicine Projects | Internal Medicine Starter V4.1 | `01a1bd1a` | **19** | pending | **Yes** — Critical Care / Endocrine / Geriatrics / ID / IM / Nephrology / Onc-Heme / Primary Care / Rheum / None | **Internal Medicine-related** |

## Shared across Expert Domain starters (not major-specific)

- **Section 1 intro card** (above Q1): “Why does this assessment include general questions?” + “Every assessment is reviewed by a person.” — foundational reasoning/comms, not domain trivia. Banked verbatim in Finance + Legal; reuse on other Expert Domain majors.
- **Q1–Q7 pattern** often parallel (Doyle / time-travel / NYT / sandwich sonnet / Olympics / London Fog rubric / complex prompt) with domain Conversation later.

## What usually differs between majors

1. **Leaf count** (17 / 18 / 19 / 16…).
2. **Presence of Your Medical Specialization** (Surgical + IM yes; Radiology no).
3. **Specialization choice list** differs by major (IM **10** vs Surgical **5**; Radiology has none).
4. **Section 1** credentials vs **Conversation Challenges** on non-credential branches (Medical tracks).
5. **Background leaf** prompt is **domain-templated** (`{Domain}-related course or experience…`).
6. **Experience lists** are track-specific (Legal radios vs Finance Part1+Part2 role checkboxes vs Medical credential radios).

## Same *within* a track

Sibling roles sharing one Starter (`01a1bd0d` Surgical Clinician / Expert / Surgeon; `01a1bcf2` Radiologist / Sonographer / Imaging; `01a1bd1a` IMC / Internist / IM Physician) share **steps** after track verify — still bank **unique bios** + verify track line before Start.

## Re-fetch queue (unverified nearly-full majors)

1. Internal Medicine — Specialization ✅; Internist + IM Physician bios ✅; Branch B + Q titles pending  
2. Surgical Medicine — Specialization ✅ (5 options); Experience full list ✅; **3-way branch** (19 / ~23 hybrid / 17) ✅  
3. Radiology — Q5–Q7 titles; reconfirm no Specialization leaf-by-leaf  
4. Medical (Physician) — re-verify vs Surgical/IM skeleton  
5. Legal Expert — Experience 10 ✅; Q1–Q7 ✅; Conversation Haiku **3.5** ✅  
6. Finance Expert — **16** leaves; Experience **Part 1 + Part 2 (12 roles)** ✅; Q/Conversation pending  
7. Economics / Accounting / other nearly-full — leaf-by-leaf vs Coding/Generalist verified baselines  

Never Submit while fetching.
