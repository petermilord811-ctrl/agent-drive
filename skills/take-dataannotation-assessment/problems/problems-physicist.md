# Physicist — Physics Starter Assessment

### Bank

- **captureStatus:** nearly-full
- **Captured:** 2026-11-09 · host 34123 · sleep autonomy
- **Live IDs:** task `1ff5229d-1531-4705-81c6-47c1f4f379af` · `project_id=01833c35-1c20-4a01-9dff-5ed039372765` · `task_response_id=01a1c003-3ce8-7159-bea5-a30949654632`
- **Track:** Role intro = **Physics Projects assessment**; live qualification = **[Qualification] Physics Starter Assessment** (unique physics form — **not** Expert Domain Parallel)
- **Gaps:** ° OCR still reads `300`/`37.00` for degree glyphs — PNG glyph SoT. Professional Experience may be multi-select (“fields”).
- **Live 2026-11-10 reconnect:** Physics Starter via Browse STEM → Start (direct task URL blanked). Q1 six-step table + Q6 Brewster AI reply (`tan θ_B = n_air/n_water` → 53.0°) re-banked live.
- **Rule:** never Submit while fetching

### Role

- **Role:** Physicist
- **Category:** STEM
- **Slug:** `physicist`
- **Source:** DataAnnotation UI host 34123

### Contents

1. [Bio](#bio) · [Bio (assessment intro)](#bio-assessment-intro)
2. [Step 1 · Instructions](#step-1--instructions)
3. [Question 1 · Forces at an Angle](#question-1--forces-at-an-angle)
4. [Question 2 · Tumbling Dominoes](#question-2--computing-the-number-of-tumbling-dominoes)
5. [Question 3 · Turning Forces in Flight](#question-3--turning-forces-in-flight)
6. [Question 4 · Light and Interference](#question-4--light-and-interference)
7. [Question 5 · Create Problem](#question-5--create-your-own-challenging-physics-problem)
8. [Question 6 · Evaluating AI Solutions](#question-6--evaluating-ai-solutions)
9. [Tell us about yourself](#tell-us-about-yourself)

---

## Bio

**Role:** Physicist  
**Category:** STEM  
**Hiring cue:** STEM • 39 hired recently

### Overview

Models can recite physics and still get it wrong: dimensional errors, misapplied approximations, and confident leaps past the steps that matter. As a Physicist you'll evaluate AI reasoning across mechanics, E&M, quantum, and thermodynamics, and your corrections become the standard the models learn from.

### What you'll actually do

- Craft problems that expose weak physical reasoning, from undergrad mechanics to graduate theory.
- Review AI solutions step by step: catch dimensional errors, flag unjustified approximations, and rate the quality of the reasoning.
- Write the gold-standard solution when the model falls short.

### What we look for

- Graduate-level physics background or equivalent research experience.
- Comfort with at least two core areas of physics.
- Clear written English.
- No degree required. We care about what you can do, not where you learned it.

### Common backgrounds

- Physicist
- Research Scientist

### Sidebar

- **Rate:** Up to $125+/hour
- Location: Remote · Commitment: Flexible hours · Type: Independent contractor · Payouts: Weekly
- CTA: Continue

**Assets:** `assets/physicist/bio.png`

---

## Bio (assessment intro)

- **Title:** Physicist
- **Subtitle / track:** Physics Projects assessment
- **Pay line:** Up to $125+ per hour · Your hours: remote, no minimum
- **What it takes — for this assessment:** People who pass usually spend **1 hour or more**; We read your reasoning, not just your answers; Save and come back (several days); Do your own work (No LLMs unless a task says otherwise); This is your one attempt
- **What happens next:** Email if accepted; Most projects need some additional qualifications after acceptance
- **CTA:** Start assessment — **clicked 2026-11-09**

**Assets:** `assets/physicist/track-intro.png`

---

## Step 1 · Instructions

**Type:** info

Hello and thank you for your interest in our platform!

**Put Your Physics Skills to the Test, Unlock Well-Paid Remote Work.**

Welcome to our physics assessment. This test allows you to demonstrate your physics reasoning and problem-solving skills through a series of carefully designed questions and tasks.

If you pass the assessment, you'll get access to a nearly unlimited amount of remote physics work which pays **$40-$50 per hour**.

**Our Projects, Your Schedule.**

Work on projects when its convenient for you. We continuously post new projects with tasks available 24/7. Whether you prefer to solve problems late at night or early in the morning, you'll find paid work available at any hour.

**Help Train the AI of Tomorrow.**

We're helping AIs better understand and reason through physics processes, and we need skilled physicists like yourself to help train them through projects like:

- Analyzing AI-generated solutions to identify errors and suggest corrections.
- Demonstrating accurate physics reasoning and problem solving to improve AI problem-solving capabilities.
- Enhancing AI explanations of complex concepts by offering critiques and explanations AIs can learn from.
- And much more!

**How long will this take to complete? About 60-90 minutes.**

Plan for this assessment to take about 60-90 minutes. No need to feel rushed though - take as long as you need to complete it.

**Let your abilities shine through. Your answers should be your own.**

When completing this assessment, please do not use outside assistance. All of your responses should be written by you from scratch. No part of your answers should come from an AI assistant. We look forward to seeing your skills based on your own expertise.

Note: You are permitted to use graphing calculators and other traditional tools to assist in your calculations.

**So let's get started! Here's what you can expect from the assessment below:**

- First, you'll answer a multiple choice question on fundamental physics concepts.
- Next, you'll answer a series of word problems designed to test and demonstrate your physics reasoning and problem-solving skills.
- Then, you'll be asked to create your own creative and challenging physics problem that could be asked to an AI assistant to assess its capabilities.
- Finally, you'll be presented with a physics problem that an AI has attempted to solve. You will need to review the the solution for accuracy and provide corrections or improvements if necessary.

Good luck, and we look forward to receiving your submission!

### Assets

- `assets/physicist/instructions.png`

---

## Question 1 · Forces at an Angle

**Type:** mcq + explanation  
**Title:** Question 1: Forces at an Angle  
*Live 2026-11-10 · host 34123 · `q1-forces-table-live-20261110.png`*

### Prompt

Imagine a user asked the following request to an AI assistant:

> Consider a 5 kg box being pushed across a rough horizontal surface. A 20 N force is applied at an angle of 30° **downward** from the horizontal, increasing the box’s contact pressure with the surface. The coefficient of kinetic friction is 0.2. What is the acceleration of the box?

The following are three solutions that were returned by the AI *(host OCR may show `300` for `30°` — PNG is glyph SoT)*:

| Step | Response A | Response B | Response C |
|---|---|---|---|
| 1. Vertical $F_y$ | $F_y=20\sin(30°)=10\,\mathrm{N}$ | $F_y=20\sin(30°)=10\,\mathrm{N}$ | $F_y=20\sin(30°)=10\,\mathrm{N}$ |
| 2. Effective $N$ | $N=mg-F_y=(5\cdot9.8)-10=39\,\mathrm{N}$ | $N=mg+F_y=(5\cdot9.8)+10=59\,\mathrm{N}$ | $N=mg=5\cdot9.8=49\,\mathrm{N}$ |
| 3. Friction $F_f$ | $F_f=\mu N=0.2\cdot39=7.8\,\mathrm{N}$ | $F_f=\mu N=0.2\cdot59=11.8\,\mathrm{N}$ | $F_f=\mu N=0.2\cdot49=9.8\,\mathrm{N}$ |
| 4. Horizontal $F_x$ | $F_x=20\cos(30°)\approx17.32\,\mathrm{N}$ | $F_x=20\cos(30°)\approx17.32\,\mathrm{N}$ | $F_x=20\cos(30°)\approx17.32\,\mathrm{N}$ |
| 5. Net $F_{net}$ | $F_{net}=F_x-F_f=17.32-7.8=9.52\,\mathrm{N}$ | $F_{net}=F_x-F_f=17.32-11.8=5.52\,\mathrm{N}$ | $F_{net}=F_x-F_f=17.32-9.8=7.52\,\mathrm{N}$ |
| 6. Acceleration $a$ | $a=9.52/5=1.90\,\mathrm{m/s}^{2}$ | $a=5.52/5=1.10\,\mathrm{m/s}^{2}$ | $a=7.52/5=1.50\,\mathrm{m/s}^{2}$ |

### Question

For the three solutions above, please indicate which is the correct solution:

**Choices:**

1. [ ] Response A is correct
2. [ ] Response B is correct
3. [ ] Response C is correct

### Explanation (write-in)

In 2-3+ complete sentences, please provide your reasoning for your above selection. The more well-written and thoughtful your explanations are, the more likely it is that you will be approved to work on our projects!

### Assets

- `assets/physicist/q1-forces.png`
- `assets/physicist/q1-q2.png`
- `assets/physicist/q1-forces-table-live-20261110.png`

---

## Question 2 · Computing the Number of Tumbling Dominoes

**Type:** numeric write-in + explanation  
**Title:** Question 2: Computing the Number of Tumbling Dominoes

### Prompt

A row of evenly spaced dominoes, each of mass $m=100\,\mathrm{g}$ and height $h=0.2\,\mathrm{m}$, is placed on a flat horizontal surface. When the first domino falls, $5\,\mathrm{J}$ of energy is transferred to the next domino. Due to friction and air resistance, energy is lost between each fall, with a constant energy transfer efficiency ratio of $r=0.9$. This energy loss does not apply to the first fall. The first domino transfers the full $5\,\mathrm{J}$ into the next one. The chain reaction stops when the energy transferred to a domino is less than the energy required to tip it over. To determine when the chain reaction stops, use a simplified assumption: the energy required to tip a domino is the potential energy needed to lift its center of mass by a vertical distance of $h/2$. Do not account for thickness or rotational effects.

How many dominoes will fall before the chain reaction stops? Include the first domino in your total. Please provide your answer as just the number of dominoes without any extra text (such as 'dominoes').

Note: we ask for this type of specific formatting as your answers will be programmatically evaluated as numeric quantities, so proper formatting goes a long way in getting you through the review process and onto our projects!

**Write-in:** *(short numeric box)*

### Explanation (write-in)

In 2-3+ complete sentences, please provide an explanation for how you arrived at your solution.

### Assets

- `assets/physicist/q1-q2.png`

---

## Question 3 · Turning Forces in Flight

**Type:** numeric write-in + explanation  
**Title:** Question 3: Turning Forces in Flight

### Prompt

A pilot with a mass of 75 kg is flying an airplane at a true airspeed of 50 m/s. During a coordinated, constant-altitude turn, the pilot experiences an apparent weight of 1471.5 N. Calculate the rate of turn in radians per second. Round your answer to two significant figures.

Reminder: In a coordinated turn at constant altitude, forces balance vertically, leaving the rest to drive the turn.

Please provide your answer as just the number to two significant figures without any extra text (such as 'rad/s').

**Write-in:** *(short numeric box)*

### Explanation (write-in)

In 2-3+ complete sentences, please provide an explanation for how you arrived at your solution.

### Assets

- `assets/physicist/q3-q4.png`

---

## Question 4 · Light and Interference

**Type:** numeric write-in + explanation  
**Title:** Question 4: Light and Interference

### Prompt

Red, yellow, green, and blue light with wavelengths of $\lambda_{\mathrm{red}}=700\,\mathrm{nm}$, $\lambda_{\mathrm{yellow}}=580\,\mathrm{nm}$, $\lambda_{\mathrm{green}}=520\,\mathrm{nm}$, and $\lambda_{\mathrm{blue}}=475\,\mathrm{nm}$ are directed at a slit that is $20\,\mu\mathrm{m}$ wide at normal incidence. The light hits a screen 1 m behind the slit. Which color of light will have an interference minimum closest to a point 10 cm away from its central maxima?

You may assume the small angle approximation $\sin\theta \approx \tan\theta \approx \theta$ for angles smaller than $10^{\circ}$.

Please provide your answer as just the wavelength value in nm without any extra text (such as 'nm').

**Write-in:** *(short numeric box)*

### Explanation (write-in)

In 2-3+ complete sentences, please provide an explanation for how you arrived at your solution.

### Assets

- `assets/physicist/q3-q4.png`

---

## Question 5 · Create Your Own Challenging Physics Problem

**Type:** write-in  
**Title:** Question 5: Create Your Own Challenging Physics Problem

### Prompt

We often need to test AI assistants with complex and thought-provoking problems to test their problem-solving skills. Show us you can create such a problem below!

Write an original, challenging physics problem that requires critical thinking and problem-solving. It should be clear, solvable, and realistic. An example of such a problem follows:

> A spacecraft is in a stable circular orbit around a planet with twice the mass of Earth and the same radius. The spacecraft fires its thrusters in the direction of motion, instantly doubling its speed. What is the maximum altitude (above the planet's surface) that the spacecraft will reach before falling back? Express your answer in terms of the planet's radius $R$.

Please try to avoid creating a problem that's a copy of the above example, as we'd like to see your creativity in action!

**Write-in:** *(large text box)*

### Assets

- `assets/physicist/q5-q6-start.png`

---

## Question 6 · Evaluating AI Solutions

**Type:** AI response + mcq + explanation  
**Title:** Question 6: Evaluating AI Solutions

### Prompt

Next, your job is to read an AI's reply to a user's question and determine if the AI made any mathematical or reasoning errors in its solving process.

**User prompt:**

> Imagine you are out for a stroll on a sunny day when you encounter a lake. Unpolarized light from the sun is reflected off the lake into your eyes. However, you notice when you put on your vertically polarized sunglasses, the light reflected off the lake no longer reaches your eyes. What is the angle between the unpolarized light and the surface of the water, in degrees, measured from the horizontal? You may assume the index of refraction of air is $n_{\mathrm{air}}=1$ and the index of refraction of water is $n_{\mathrm{water}}=1.33$. Round your answer to three significant figures.

### AI Response

*Live 2026-11-10 · host 34123 · `q6-brewster-live-20261110.png` (PNG = ° glyph SoT)*

Yes, I can help you solve that. The angle of reflection where light becomes perfectly polarized is called Brewster's Angle. This happens when the reflected and refracted light rays are perpendicular to each other. The formula for Brewster's Angle is:

$$\tan\theta_{B}=\frac{n_{\mathrm{air}}}{n_{\mathrm{water}}}$$

This is because light bends toward the medium with a lower refractive index, so the ratio is air over water.

Substituting the values:

$$\tan\theta_{B}=\frac{1}{1.33}$$

Solving for $\theta_{B}$:

$$\theta_{B}=\arctan\left(\frac{1}{1.33}\right)\approx 37.0^{\circ}$$

Brewster's Angle is measured from the normal to the surface. The angle from the horizontal is:

$$\theta_{\mathrm{horizontal}}=90^{\circ}-\theta_{B}=90^{\circ}-37.0^{\circ}=53.0^{\circ}$$

**Final answer:** $53.0^{\circ}$

### Question

Does the AI's solving process or final answer contain any inaccuracies?

**Choices:**

1. [ ] No, the AI's solving process and solution are correct.
2. [ ] Yes, there are one or more errors in the AI's solving process or solution.

### Explanation (write-in)

In 2-3+ complete sentences, please provide your reasoning for your above selection.

### Assets

- `assets/physicist/q5-q6-start.png`
- `assets/physicist/q6-experience.png`
- `assets/physicist/q6-brewster-live-20261110.png`
- `assets/physicist/q6-brewster-end-live-20261110.png`

---

## Tell us about yourself

**Header:** Tell us about yourself

That's it for the test questions! We appreciate you taking the time to complete this application. To wrap up, please help us get to know you better by providing some basic information about yourself.

### Professional Experience

Please indicate your primary fields of experience:

**Choices:**

1. [ ] Applied Physics
2. [ ] Theoretical Physics
3. [ ] Astrophysics/Cosmology
4. [ ] Particle Physics
5. [ ] Optics
6. [ ] Nuclear Physics
7. [ ] Geophysics
8. [ ] Academic Research
9. [ ] Academic Experience
10. [ ] Engineering
11. [ ] Other (explain in the box below)

### Coding and Computer Science Experience

Do you have a background in coding or computer science?

You don't need to necessarily have completed an undergraduate computer science or software program to answer yes to this question — we're interested in learning about your general level of coding experience.

If multiple options below are true for you, please select the option closest to the top of the list.

**Choices:**

1. [ ] Yes, I have professional experience writing code
2. [ ] Yes, I have significant academic experience with computer science, computer engineering, or software engineering (I've completed an undergraduate minor or major with a focus on coding)
3. [ ] I have some coding experience associated with my profession, but don't regularly write or implement code
4. [ ] I have hobbyist or semi-professional coding experience (personal projects, infrequent contributions to GitHub projects, etc.)
5. [ ] No, I don't have significant coding experience

### Physics courses (write-in)

Tell us about the physics courses you specialized in during your studies. Which one was your favorite and why? We'd love to hear about any topics, projects, or challenges that stood out to you!

Once again, we really appreciate detailed responses here!

### English fluency

What is your level of English fluency?

**Choices:**

1. [ ] Native English speaker
2. [ ] Fluent English speaker, but not native
3. [ ] Conversational
4. [ ] Limited English

### Optional comments

(Optional) Any other comments?

### Footer

- Save to account
- **Submit** — do **not** click while banking
- Saved to this browser automatically. Not yet saved to your account. Clear Response.

### Assets

- `assets/physicist/experience-coding.png`
- `assets/physicist/coding-english-optional.png`
