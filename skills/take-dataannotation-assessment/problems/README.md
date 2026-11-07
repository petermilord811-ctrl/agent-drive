---
name: DataAnnotation problems bank
when: local problem database for take-dataannotation-assessment — do not use workspace-root DA assessments/problems-*.md
tags: dataannotation, problems, bank
---
# problems/ — agent-drive assessment problem bank

Owned by `skills/take-dataannotation-assessment/`. Live captures overwrite stubs.

| Slug | File | Status | Assessment id | Example roles |
|------|------|--------|---------------|---------------|
| `generalist` | [`problems-generalist.md`](./problems-generalist.md) | stub | `generalist` | Generalist |
| `coding` | [`problems-coding.md`](./problems-coding.md) | stub | `coding` | Software Engineer, Frontend Engineer, DevOps Engineer |
| `data-ml` | [`problems-data-ml.md`](./problems-data-ml.md) | stub | `data-ml` | Data Scientist, Machine Learning Engineer |
| `cybersecurity` | [`problems-cybersecurity.md`](./problems-cybersecurity.md) | stub | `cybersecurity` | Cybersecurity Expert, Penetration Tester, Incident Responder |
| `finance` | [`problems-finance.md`](./problems-finance.md) | stub | `finance` | Finance Expert, Quantitative Analyst, Portfolio Manager |
| `accounting` | [`problems-accounting.md`](./problems-accounting.md) | stub | `accounting` | Tax Accountant, Corporate Accountant, Accountant |
| `economics` | [`problems-economics.md`](./problems-economics.md) | stub | `economics` | Economist, Research Economist, Applied Economist |
| `legal` | [`problems-legal.md`](./problems-legal.md) | stub | `legal` | Legal Expert, Attorney, Paralegal |
| `medical` | [`problems-medical.md`](./problems-medical.md) | stub | `medical` | Health/Medical Expert, Radiologist, Sonographer |
| `healthcare-ops` | [`problems-healthcare-ops.md`](./problems-healthcare-ops.md) | stub | `healthcare-ops` | Healthcare Operations Manager, Healthcare Compliance Specialist, Medical Coder |
| `engineering-mechanical` | [`problems-engineering-mechanical.md`](./problems-engineering-mechanical.md) | stub | `engineering-mechanical` | Mechanical Engineer, Mechanical Design Engineer, Validation Engineer |
| `engineering-civil` | [`problems-engineering-civil.md`](./problems-engineering-civil.md) | stub | `engineering-civil` | Civil Engineer, Civil Design Engineer |
| `engineering-electrical` | [`problems-engineering-electrical.md`](./problems-engineering-electrical.md) | stub | `engineering-electrical` | Electrical Engineer, Embedded Systems Developer, Hardware Engineer |
| `stem` | [`problems-stem.md`](./problems-stem.md) | stub | `stem` | Chemist, Physicist, Mathematician |
| `languages` | [`problems-languages.md`](./problems-languages.md) | stub | `languages` | Chinese Specialist, Thai Specialist, Russian Specialist |
| `design` | [`problems-design.md`](./problems-design.md) | stub | `design` | Designer |
| `project-based` | [`problems-project-based.md`](./problems-project-based.md) | stub | `project-based` | Cybersecurity Projects, Robotics Projects, Nuclear Engineering Projects |
| `biology` | [`problems-biology.md`](./problems-biology.md) | stub | `stem` | Biologist, Experimental Biologist, Computational Biologist |
| `chemistry` | [`problems-chemistry.md`](./problems-chemistry.md) | stub | `stem` | Chemist, Drug Discovery Scientist |
| `physics` | [`problems-physics.md`](./problems-physics.md) | stub | `stem` | Physicist |
| `math` | [`problems-math.md`](./problems-math.md) | stub | `stem` | Mathematician |

## Commands

```bash
# Create any missing stubs (never overwrites captured files)
node skills/take-dataannotation-assessment/init-problems-db.js

# After a live re-catch:
node skills/take-dataannotation-assessment/compare-problems.js --slug medical
```

Paths resolve to this folder automatically (`problems-slugs.json` → `bankDir`).
