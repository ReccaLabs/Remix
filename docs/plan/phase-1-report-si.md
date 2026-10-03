# ReMix — Phase 1 වාර්තාව (සිංහලෙන්)

> Phase 1 ("අත්තිවාරම") වැඩේ කළේ කොහොමද, මොනවද හැදුවේ, ඊළඟට මොකද කරන්න ඕන කියලා සරලව පැහැදිලි කරන වාර්තාවක්.
> දිනය: 2026 ඔක්තෝබර් 3 · Track විස්තර සහ test ගණන්: [phase-1.md](phase-1.md) · සම්පූර්ණ plan එක: [README.md](README.md)

---

## 1. කෙටියෙන්

ReMix LMS එකේ **පදනම (Phase 1)** හැදුවා. දැන් පුළුවන් දේ:

- **ශිෂ්‍යයෙක්** (උදා: Nimali Perera) තමන්ගේ institute එකේ web address එකට (`kamalphysics.remix.lk` වගේ) ගිහින් phone number + password එකෙන් log වෙලා තමන්ගේ classes ටික බලනවා.
- **Staff අය** (owner, admin, cashier) admin පැත්තට (`/admin`) log වෙනවා.
- **එක institute එකක data අනිත් institute එකකට කිසිසේත් පේන්නේ නෑ.** මේක තමයි SaaS එකේ වැදගත්ම security කොටස. ඒක database මට්ටමින්ම තහවුරු කරලා, tests වලින් ඔප්පු කරලා තියෙනවා.

තවම **නැති** දේවල්: fees/payments, lessons/videos, Zoom, SMS. ඒවා Phase 2–7 වල එනවා ([05-roadmap.md](05-roadmap.md)).

---

## 2. හැදුව කොටස් (`main` branch එකේ commits 15)

| කොටස | සරල තේරුම |
| --- | --- |
| **Plan + ADRs** | Plan එක සහ architecture තීරණ document කළා ([docs/decisions/](../decisions/)). උදා: login system එක අපිම හදනවා; API එක `api.remix.lk` වගේ වෙනම domain එකක් නෙවෙයි, හැම institute address එකකම `/api/v1` විදියට තියෙනවා. |
| **Database** (`packages/db`) | Tables 12ක්. හැම row එකක්ම "මේක අයිති මොන institute එකටද" කියලා database එකම පරීක්ෂා කරනවා (**Row Level Security**). Test data: Kamal Physics (ශිෂ්‍යයෝ 2,000), Royal Science, Closed Academy (suspend කරපු එකක්). |
| **API — backend** (`apps/api`) | Login, sessions, security guards, error messages, rate limits (password අනුමාන කරන්න බැරි වෙන්න), health checks, Docker image එක. |
| **Web — frontend** (`apps/web`) | Login pages, ශිෂ්‍ය portal එක (Home, Classes), admin home එක. Phone එකේත් හරියට පේනවා. |
| **UI kit** (`packages/ui`) | Buttons, forms, tables, menus, dialogs වගේ නැවත නැවත පාවිච්චි කරන කොටස්. Accessibility (ආබාධිත අයටත් පාවිච්චි කළ හැකි වීම) check කරලා. |
| **CI** (`.github/workflows/ci.yml`) | GitHub එකට push කරන හැම වෙලාවකම tests, security scans auto run වෙනවා. |
| **E2E tests** (`e2e/`) | Browser එකක් auto open කරලා ඇත්තම user කෙනෙක් වගේ login වෙලා check කරනවා. |

**ප්‍රතිඵල:** automated tests **1,089ක්** + browser journeys **34ක්**, ඔක්කොම ✅ pass.

### Security review

වෙනම, ස්වාධීන security review එකක් දෙවතාවක් කළා. ප්‍රශ්න 7ක් හම්බුණා (එකක් **High**: phone number එකට spaces දාලා login සීමාව මගහරින්න පුළුවන් වුණා). දෙවෙනි review එකෙන් තව පොඩි ප්‍රශ්න 3ක් හම්බුණා. **ඔක්කොම fix කරලා, හැම fix එකකටම test එකක් ලියලා තියෙනවා.**

### Phase 1 අවසාන කොන්දේසි (exit criteria)

| කොන්දේසිය | තත්ත්වය |
| --- | --- |
| Institute අතර data වෙන් කිරීමේ tests (isolation suite) | ✅ |
| ශිෂ්‍යයෙක් login වෙලා classes බලනවා — browser → API → database | ✅ (local machine එකේ) |
| ADRs 0003–0007 | ✅ |
| එක command එකෙන් local setup (`pnpm dev`) | ✅ |
| **Staging server** එකක run වීම | ❌ Hetzner server එක ඔයා හදන්න ඕන |
| ADRs 0012 (background jobs), 0013 (monitoring) | ❌ තවම ලිව්වේ නෑ |

---

## 3. GitHub එකේ Pull Requests 18 මොනවද?

**ඒවා අපි හදපු ඒවා නෙවෙයි.** ඒවා හදන්නේ **Dependabot** කියන GitHub robot එක. ඒක දවස ගානේ "ඔයාගේ libraries වලට අලුත් version එකක් ආවා" කියලා PR එකක් open කරනවා. Push කරාම ඒක ආයෙත් scan කරන නිසා ගොඩක් එකපාර පේනවා.

| කරන්න ඕන දේ | PRs |
| --- | --- |
| ❌ **Close කරන්න** (අපි පාවිච්චි කරන්නේ Node 24) | #25 `@types/node` 26 |
| ⚠️ **දැනට merge කරන්න එපා** — ලොකු version පැනීම්, code කැඩෙන්න පුළුවන් | #19, #23 NestJS 12 · #24 eslint 10 · #14 Valkey 9 · #12 SeaweedFS 4 |
| 🟡 CI ✅ නම් එකින් එක merge කරන්න | #10, #11, #15, #16, #17 (GitHub Actions updates) |
| 🟢 අවදානම අඩුයි — CI ✅ නම් merge කරන්න | #22 next-intl · #20 typescript-eslint · #18 next/react · #13 mailpit · #9 tooling · #6 prettier plugin · #21 workers-types |

**ඉඟිය:** Dependabot settings (`.github/dependabot.yml`) වෙනස් කරලා ලොකු version updates ignore කරන්නත්, පොඩි ඒවා එක PR එකකට එකතු කරන්නත් පුළුවන්. එතකොට PR ගාන ගොඩක් අඩු වෙනවා.

---

## 4. Branches ගොඩක් තිබුණේ ඇයි?

- වැඩේ කොටස් 10කට බෙදලා, AI agents කිහිප දෙනෙක් **එකම වෙලාවේ** වැඩ කළා. එක එක්කෙනාට වෙනම branch එකක් දුන්නා (`feat/db-…`, `feat/api-…` වගේ).
- හැම branch එකක්ම පරීක්ෂා කරලා `main` එකට **squash merge** කළා. ඒ කියන්නේ branch එකක වැඩ ඔක්කොම **එක commit** එකකට එකතු කළා. ඒ නිසා History එකේ පිරිසිදු commits 15ක් පේනවා.
- ඉතුරු වුණු local branches 15 **delete කළා.** ඒවායේ code ඔක්කොම දැනටමත් `main` එකේ තියෙනවා, කිසිම දෙයක් නැති වුණේ නෑ.
- GitHub Desktop එකේ තවම පේන `origin/dependabot/…` කියන්නේ Dependabot ගේ PR branches. PR එක merge හෝ close කළාම ඒවා auto delete වෙනවා.

**ඉස්සරහට branch නීති** ([phase-1.md](phase-1.md)):

- `main` → හැමවෙලේම වැඩ කරන තත්ත්වයේ තියෙන්න ඕන
- `feat/…`, `fix/…`, `docs/…`, `ci/…` → කෙටි කාලීන branches, වැඩේ ඉවර වුණාම squash merge කරලා delete කරනවා
- Commit messages: `feat(auth): AUTH-01 …` වගේ Conventional Commits, feature ID එකත් එක්ක

---

## 5. Docker එකේ "s3" වගේ ඒවා මොනවද?

Development වලදී ReMix එකට ඕන services 4ක් Docker එකේ run වෙනවා ([infra/docker/compose.yaml](../../infra/docker/compose.yaml)):

| නම | වැඩේ |
| --- | --- |
| `postgres` | Database එක (Postgres 18) |
| `valkey` | Cache එක (පස්සේ rate limits, background jobs වලට) |
| `mailpit` | ව්‍යාජ email inbox එකක් (emails test කරන්න) |
| `s3` | Files ගබඩා කරන තැන (bank slips, PDFs). Production එකේ Cloudflare R2 වෙනුවට local එකේ පාවිච්චි කරන SeaweedFS |

Phase 1 ඉවර වෙලා ඒවා **stop කරලා delete කළා.** ඔයාගේම පරණ Docker projects (restaurant-mysql, lottery, oracle) වලට අත ගැහුවේ නෑ.

ආයෙ ඕන වුණාම:

```bash
pnpm dev
```

මේකෙන් Docker services, database migrate, test data, web + API ඔක්කොම auto start වෙනවා.

---

## 6. මෙච්චර වෙලා ගියේ ඇයි? (අවංකවම)

1. **වැඩේ ලොකුයි.** Plan එකේ Phase 1 කියන්නේ developers 2–3ක් **සති 4ක** වැඩ.
2. **Claude usage limit එක 3 වතාවක් ඉවර වුණා.** ඒ හැම වතාවකම agents නැවතිලා, reset වෙනකම් පැය ගණන් බලාගෙන ඉන්න වුණා.
3. **Laptop එකට එකපාර දුන්න load එක වැඩියි.** Agents 5ක් එකපාර run කළා; එක එක්කෙනාට වෙනම repo copy එකක්, වෙනම Docker database එකක්. ඒ නිසා C: drive එක 100% පිරුණා, Docker දෙපාරක් හිරවුණා, CPU එක 100% ගිහින් tests timeout වුණා.
4. **හැම merge එකකටම පස්සේ tests ඔක්කොම නැවත run කළා** (විනාඩි 10–20 බැගින්). Security review → fix → නැවත review → නැවත fix.
5. **Agents ලා අතහැරපු processes** (හිරවුණු Docker commands, තාවකාලික database එකක්) ports අල්ලගෙන හිටියා. ඒවා හොයාගන්නත් වෙලාව ගියා.

### ඊළඟ phases වලදී වෙනස් කරන දේ

- එකපාර agents **2ක් විතරයි**
- **Sonnet** model එක default; **Opus** security වැඩ සහ reviews වලට විතරයි; **Haiku** සරල edits වලට
- හැම test එකකටම වෙනම Docker එකක් නෙවෙයි — **එක shared database එකක්**, test run එකකට අලුත් database එකක් ඒක ඇතුළේ
- වැඩේ ඉවර වුණාම background tasks, processes, ports ඔක්කොම පිරිසිදු කිරීම

---

## 7. ඊළඟට ඔයා කරන්න ඕන දේ

1. **GitHub CI result එක බලන්න:** GitHub → Actions → "CI". Fail වුණොත් terminal එකේ `gh auth login` කරන්න; එතකොට Claude ට logs බලලා fix කරන්න පුළුවන්.
2. **Dependabot PRs** උඩ §3 table එකේ විදියට handle කරන්න (නැත්නම් settings හදන්න කියන්න).
3. **Staging server එක** — Hetzner server + Kamal deploy + Sentry. Phase 1 එකේ ඉතුරු ලොකුම දේ.
4. **Phase 2** — ශිෂ්‍යයෝ add කිරීම (CSV import), classes, staff invite, device 2ක සීමාව. ඔයා OK කිව්වම පටන් ගන්නවා.
