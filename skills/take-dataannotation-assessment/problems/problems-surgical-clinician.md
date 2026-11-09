# Surgical Clinician — Surgical Medicine Projects assessment

### Bank

- **captureStatus:** nearly-full
- **Captured:** 2026-11-08 · host **34123**
- **Assessment:** Surgical and Perioperative Medical Professional Starter Assessment V4.1 / **Surgical Medicine Projects** assessment
- **IDs:** `task_response_id=01a1bd0d-3a0e-71b3-90a6-1b656184221d` · `project_id=25745102-dab8-4377-ae60-5b6ce8e1fcc1`
- **Rule:** never Submit while fetching
- **Targeting:** Medical filter → **Surgical Clinician** titled card → verify **Surgical Medicine Projects assessment** before Start (**not** Medical Projects / Radiologists Projects).
- **Expand rule (probed 2026-11-08):**
  - **Opts 1–2** (US Board-Certified / US MD without Surgical specialty) → **19** leaves · Licensure + Assessment + Background (**no** Conversation)
  - **Opts 3–6** (US APP / nurse / pharmacist / other clinical) → **hybrid ~23** · Licensure + Assessment + **Conversation** + Background (Sections 1–4)
  - **Opts 7–15** (outside-US / degree / student / None) → **17** · Assessment + Conversation + Background (**no** Licensure; keeps Specialization)
- **Gaps:** Q1–Q7 verbatim; exact hybrid step count label; Pharmacist/other-clinical confirm same as nurse.
- **Specialization vs IM:** Surgical list is **5** domain options (Anesthesiology / Orthopedics / Otolaryngology / Surgery / Other) — **not** the IM 10-option list.
- **Domain note:** Background leaf is **Surgical or Perioperative-related** (not generic).
- **Shared track:** Surgical Medicine Expert / Surgeon expected same Starter (`01a1bd0d`) after track verify.

### Role

- **Role:** Surgical Clinician
- **Category:** Medical
- **Slug:** `surgical-clinician`
- **Source:** DataAnnotation UI host 34123 (Medical → Surgical Clinician; verified **Surgical Medicine Projects**)

### Contents

1. [Bio](#bio) · [Bio (assessment intro)](#bio-assessment-intro)
2. [Step 1 · Instructions](#step-1--instructions)
3. [Step 2 · Your Professional Experience](#step-2--your-professional-experience)
4. [Branch A · US Board-Certified (19 leaves)](#branch-a--us-board-certified-19-leaves)

---

## Bio

**Role:** Surgical Clinician  
**Category:** Medical  
**Hiring cue:** Medical • 11 hired recently

### Overview

Help train AI models by giving them complex surgical problems, checking their reasoning, and identifying where they fall short — clinical judgment for medical AI.

### What you'll actually do

- Pose surgical / perioperative problems and evaluate model answers.
- Rate model output for correctness against the current standard of care.
- Flag inaccuracies (e.g., missed contraindications).
- Write correct answers with clear rationales.

### What we look for

- Board certification in surgery with 3+ years post-residency experience, **or** a current license to practice clinically in surgery (RN, NP, PA, or CRNA).
- Relevant backgrounds: Surgeons, anesthesiologists, perioperative/OR nurses, and advanced practice clinicians.
- Native or bilingual English fluency; clear, well-organized writing.
- Based in Australia, Canada, Ireland, New Zealand, the UK, or the US.

### Role sidebar (page 1)

- Up to $125+/hour · Remote · Flexible hours · Independent contractor · Weekly

### Assets

- `assets/surgical-clinician/surgclin_bio0.png`

## Bio (assessment intro)

**Title:** Surgical Clinician  
**Track line:** **Surgical Medicine Projects assessment** ← verified before Start

### Pay / hours strip

- Up to $125+ per hour
- Your hours: remote, no minimum

### What it takes

- People who pass usually spend **1 hour 30 minutes or more**.
- We read **your reasoning**, not just your answers.
- Save your answers and come back. You have **several days** to finish.
- This is your **one attempt**. You can complete additional assessments if you pass.

<!-- Omitted: No-LLMs / anti-AI bullet (bank rule). -->

### What happens next

- We will **email you** if you are accepted.
- Most projects need **some additional qualifications**, which you complete after you are accepted.

### Assets

- `assets/surgical-clinician/surgclin_bio1.png`

---

## Step 1 · Instructions

**Step:** Step 1 of 2 (pre-select)  
**Type:** info

Hello / thank you — assessment for the **Surgical and Perioperative Domain** project track. Passing unlocks a family of surgical and perioperative projects. ~**60–120 minutes**; **120 hours** after work mode. Best possible original answers (no outside assistance / AI).

### Assets

- `assets/surgical-clinician/surg_s01.png`

---

## Step 2 · Your Professional Experience

**Type:** mcq  
**Scroll:** long list — full capture via PageDown (2026-11-08)

Intro: education/experience for Surgical and Perioperative domain assignment; **does not impact scoring**. Expired/inactive license OK for licensed options. US vs other-jurisdiction note (select United States when dual). Closest-to-top if multiple apply.

**Choices (complete):**

1. I am a Board-Certified Surgeon or Surgical/Perioperative Specialist (MD or DO) licensed in the United States
2. I am a fully licensed physician (MD or DO) in the United States, but I do not have a Surgical or Perioperative specialization
3. I am an Advanced Practice Provider licensed in the United States (e.g., CRNA, Surgical PA, NP) and can provide my 10-digit NPI number
4. I am a nurse licensed in the United States (e.g., RN, LPN, LVN) and can provide my state license number
5. I am a Pharmacist licensed in the United States and can provide my state license or NPI number
6. I am another licensed clinical professional in the United States and can provide my state license or NPI number
7. I am a medical doctor licensed in a jurisdiction outside of the United States
8. I am a nurse licensed in a jurisdiction outside of the United States
9. I am a Pharmacist licensed in a jurisdiction outside of the United States
10. I am another clinical professional licensed in a jurisdiction outside of the United States
11. I hold a non-clinical graduate degree in a health science or physiological field
12. I am currently a student in a medical school or advanced clinical program
13. I hold an undergraduate degree in a health or pre-medical field
14. I am a current undergraduate student in a pre-medical or health science program
15. None of the above / other → Branch B (17 leaves; Conversation Challenges)

**Branch matrix (Experience → sidebar):**

| Options | Leaves | Licensure | Conversation |
|---------|--------|-----------|--------------|
| 1–2 US MD (Board / no Surgical specialty) | **19** | yes | no |
| 3–6 US APP / nurse / pharmacist / other clinical | **~23** hybrid | yes | yes |
| 7–15 outside-US / degree / student / None | **17** | no | yes |

**UI note:** Pre-select shows Step 2 of 2; selecting expands full sidebar. Footer may show Submit — **never Submit**.

### Assets

- `assets/surgical-clinician/surg_s02_experience.png`
- `assets/surgical-clinician/surg_s02_experience_full.png`
- `assets/surgical-clinician/surg_branch_app.png`
- `assets/surgical-clinician/surg_branch_us_nurse.png`

---

## Branch A · US Board-Certified (19 leaves)

**Inventory:** `assets/surgical-clinician/sidebar-inventory.json`

| Step | Label |
|------|--------|
| 1 | Instructions |
| 2 | Your Professional Experience |
| 3 | Your Medical Specialization |
| 4 | Section 1: Verifying your Medical Licensure |
| 5 | State of Licensure |
| 6 | License Number |
| 7 | Public Licensing Directory Link |
| 8 | Supporting document (optional) |
| 9 | Anything else to add (optional) |
| 10 | Section 2: Assessment Questions (Q1) |
| 11–16 | Questions 2–7 |
| 17 | Section 3: Your Background |
| 18 | Tell us about the most meaningful **Surgical or Perioperative-related** course or experience… |
| 19 | (Optional) Any other comments? — **do not Submit** |

### Step 3 · Your Medical Specialization

**Q:** Which of the following options best describes your specialization?

**Choices (verified 2026-11-08 · Branch B view):**

1. Anesthesiology
2. Orthopedics
3. Otolaryngology
4. Surgery
5. None of the above / other

### Assets

- `assets/surgical-clinician/surg_specialization.png`

### Step 18 · Background (verbatim)

> Tell us about the most meaningful Surgical or Perioperative-related course or experience you had in your education. Which one was your favorite and why? We'd love to hear about any topics, projects, or challenges that stood out to you! Once again, we really appreciate detailed responses here!

### Assets

- `assets/surgical-clinician/surg_s18_background.png`

---

## Branch B · Conversation path (17 leaves)

Triggered by **None of the above / other** (verified). Keeps **Your Medical Specialization**; drops licensure Section 1; adds Conversation Challenges.

| Step | Label |
|------|--------|
| 1 | Instructions |
| 2 | Your Professional Experience |
| 3 | Your Medical Specialization |
| 4 | Section 1: Assessment Questions |
| 5–10 | Questions 2–7 |
| 11 | Section 2: Conversation Challenges |
| 12 | Attached Files |
| 13 | Did you get the model to produce…? |
| 14 | Share Your Conversation |
| 15 | Section 3: Your Background |
| 16 | Tell us about the most meaningful… |
| 17 | (Optional) Any other comments? — **do not Submit** |

### Assets

- `assets/surgical-clinician/surg_branchB_none.png`

<!-- role: Surgical Clinician | assessmentId: surgical-medicine | category: Medical | assessmentVersion: Surgical and Perioperative Medical Professional Starter V4.1 | sharedAssessment: surgical-medicine/surgical-clinician -->
