# ReMix development plan

> The complete plan for building the ReMix LMS platform — from foundation to general availability and beyond. Owned by Irusha Shaveen (Recca Labs). Last updated 1 Oct 2026.

## Read in this order

| # | File | Answers |
| --- | --- | --- |
| 1 | [01-product.md](01-product.md) | Vision, users & roles, needs with "satisfied when" signals, scope and MVP (MoSCoW) |
| 2 | [02-features.md](02-features.md) | Every feature (`MOD-NN`) with screen, need, release and acceptance criteria; the money/access business rules |
| 3 | [03-architecture.md](03-architecture.md) | System design, multi-tenancy (RLS), identity, data model, API conventions, integrations, jobs, infra |
| 4 | [04-quality.md](04-quality.md) | NFRs, Definition of Ready/Done (story → release), test strategy + critical journeys, threat model, release process |
| 5 | [05-roadmap.md](05-roadmap.md) | Phases 1–10 with exit criteria, timeline, long-lead tracks, design gaps, risks, ADR backlog |
| — | [phase-1.md](phase-1.md) | Phase 1 execution board: tracks, branches, ownership, decisions, status |
| — | [phase-1-report-si.md](phase-1-report-si.md) | Phase 1 වාර්තාව සිංහලෙන් — හැදුවේ මොනවද, PRs/branches/Docker පැහැදිලි කිරීම, ඊළඟ පියවර |

Related: [DEVELOPMENT.md](../../DEVELOPMENT.md) (stack, security checklist §5) · [DESIGN.md](../../DESIGN.md) (design system, screen → route map) · [CLAUDE.md](../../CLAUDE.md) (rules for AI assistants) · [docs/decisions/](../decisions/) (ADRs).

## Traceability

```
Need (N-STU-2)  →  Feature (FEE-04, FEE-05)  →  Design (Student Pay.dc.html 6a–6g)
               →  Story (DoR/DoD)            →  Tests (unit + isolation + E2E J-02, J-03)
               →  Phase exit criteria (Phase 3)  →  Release gate (R1)
```

Use the IDs in branch names, PR titles and commits: `feat(fees): FEE-06 slip approval queue`.

## Status

Update this table at every phase boundary (and feature statuses in 02-features.md as they ship).

| Phase | Name | Release | Status | Target (est.) |
| --- | --- | --- | --- | --- |
| 0 | remix.lk marketing site | R0 | ✅ Built — launch tasks pending (D1, Turnstile, legal review, deploy) | done |
| 1 | Foundation & walking skeleton | — | 🔄 In progress — [board](phase-1.md) | weeks 1–4 |
| 2 | People & classes | R1 | ⬜ | weeks 5–7 |
| 3 | Money (fees, PayHere, slips, cash) | R1 | ⬜ | weeks 8–11 |
| 4 | Learning (protected video, tutes) | R1 | ⬜ | weeks 12–14 |
| 5 | Live classes (Zoom) & attendance | R1 | ⬜ | weeks 15–17 |
| 6 | Institute website, messages, reports | R1 | ⬜ | weeks 18–20 |
| 7 | Platform admin & ReMix billing | R1 | ⬜ | weeks 21–23 |
| 8 | Hardening & pilot launch | **R1 gate** | ⬜ | weeks 24–27 (+ pilot month 28–31) |
| 9 | General availability | **R2 gate** | ⬜ | weeks 32–40 |
| 10 | Growth (gate app, mobile, white-label, exams) | R3 | ⬜ | week 41+ |

## Knowledge graph

The repository has a graphify knowledge graph in `graphify-out/` covering code, docs, plan and designs. Use it before changing an unfamiliar area:

```bash
/graphify query "how does a student's month get unlocked?"
/graphify path "FEE-06" "bank_slips"
/graphify explain "withTenant"
```

Refresh it after a feature lands (part of the feature Definition of Done):

```bash
/graphify . --update
```

## Changing the plan

The plan is a living document. Scope moves between releases only at phase boundaries, recorded in the roadmap with a one-line reason. Architecture changes need an ADR. Never delete a feature ID — mark it `Dropped` with the reason, so traceability survives.
