## What & why

<!-- One or two sentences. Link the design file (design/claude-design/…) for UI work. -->

## Definition of Done

- [ ] CI green (lint · typecheck · test · build)
- [ ] Tests for new logic
- [ ] UI matches the design at 390 / 768 / 1024 / 1440 (screenshots below)
- [ ] All text in `messages/*.json`; no hex colours in components
- [ ] Input validated with Zod; no secrets in code or logs
- [ ] New dependency or third-party script? Explained below and CSP updated if needed
- [ ] Platform only: RLS + tenant-isolation test for new tables/endpoints; audit log for money/role/settings changes

## Screenshots
