@AGENTS.md
@docs/PROJECT_CONTEXT.md

# Engineering workflow

The main Claude Code session acts as **engineering manager**. It decides which
specialists a task actually needs, delegates to them, resolves disagreements
by inspecting the evidence itself, and reports the final result to the user.
Specialists live in `.claude/agents/`.

| Agent | Role | Edits code? |
| --- | --- | --- |
| `software-architect` | Plans substantial features: affected files/tables/routes/tests, risks | No (plan mode) |
| `frontend-engineer` | Implements UI (Next.js 16, React 19, Tailwind v4) | Yes |
| `backend-database-engineer` | Handlers, `lib/server`, migrations, Supabase Auth, Stripe | Yes |
| `ui-design-director` | Design specs from references → `docs/design/*.md` | Specs only |
| `ux-accessibility-reviewer` | Journeys + WCAG review: BLOCKING / IMPORTANT / OPTIONAL POLISH | No |
| `test-engineer` | Vitest, `tests/server` (real Postgres), Playwright; runs suites | Tests only |
| `security-reviewer` | AuthZ, RLS/grants, input, secrets, payments review | No |
| `code-reviewer` | Independent post-implementation review: CRITICAL / HIGH / MEDIUM / LOW | No |
| `debugger` | Root cause → minimal fix → regression test | Yes (minimal) |
| `visual-qa` | Implementation vs spec/screenshots, desktop + mobile | No |

## When to delegate

- **Trivial work** (one-file fix, copy change, config tweak, question):
  handle it directly. Don't spin up agents.
- **Use specialists** when their expertise matters, an independent review
  adds value, work can run in parallel, or an investigation would flood the
  main context.
- Run independent investigations and reviews in parallel. **Never run
  parallel edits to the same files.**
- Agents return concise findings, not raw logs. Reviewers don't approve work
  by default: they must say what they checked.
- Subagents don't delegate to each other; the manager routes all hand-offs.
- When agents disagree, the manager reads the cited code and decides.

## Pipelines

**Substantial feature**
1. Investigate the existing implementation (manager, or `Explore` for broad sweeps)
2. `software-architect` → implementation plan
3. `frontend-engineer` and/or `backend-database-engineer` implement (backend first when the UI depends on a new contract)
4. `test-engineer` verifies behaviour and fills test gaps
5. `code-reviewer` independently reviews
6. `security-reviewer` if auth, data boundaries, APIs, migrations, secrets or payments are touched
7. `ux-accessibility-reviewer` if user flows change
8. `visual-qa` if visible UI changes
9. The implementing agent fixes confirmed findings
10. Re-run the relevant quality gates
11. The manager reports what was done, what was verified, and any remaining limitations

**Pure UI redesign**: `ui-design-director` (spec) → `frontend-engineer` →
`ux-accessibility-reviewer` (when flows or interactions change) →
`visual-qa` → `frontend-engineer` fixes → `test-engineer` / final
verification.

**Bug**: `debugger` (reproduce, root cause, minimal fix) → the appropriate
implementation agent if the fix is broader than a minimal patch →
regression test → `code-reviewer` → final verification.

For large features: write the plan down, work in small increments that keep
tests passing, record unresolved issues, and don't claim completion until
the behaviour has actually been verified. Use `git status` / `git diff` and
the filesystem as the source of truth for current state, not conversation
memory.

# Quality gates

These are the real commands, matching `.github/workflows/ci.yml`. Run
`npm ci` first if `node_modules` is missing.

| Gate | Command |
| --- | --- |
| Route types (needed before tsc) | `npx next typegen` |
| Type check | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Unit + component + API tests (API tests use in-process PGlite) | `npm test` / `npx vitest run <path>` |
| API tests on real Postgres | `TEST_DATABASE_URL=postgres://… npx vitest run tests/server` |
| Production build | `npm run build` |
| E2E (Playwright, Chromium, port 3177, `/api/*` intercepted) | `npm run test:e2e` |

For meaningful changes, consider every gate before declaring work done:
types, lint, unit/component/API tests, e2e where a browser flow changed, the
build when routing or config changed, regression coverage, accessibility and
responsive behaviour for UI changes, and a security review for auth, data or
API changes. Say which gates ran and which were skipped, and why.

Windows note: Playwright's `webServer` command uses POSIX `VAR=value`
syntax. Locally on Windows, start the server yourself from Git Bash
(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3177/supabase-mock
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-placeholder npx next dev -p 3177`)
and Playwright will reuse it. CI (Linux) runs it as configured.

# Engineering rules

- Investigate before changing code. Never make claims about a file you
  haven't read.
- Preserve existing functionality unless the task requires changing it.
  Both demo mode (no Supabase env) and live mode must keep working.
- Follow the patterns in `docs/architecture.md`:
  - Route files are one-liners over `lib/server/handlers/*`.
  - Auth goes through `requireCaller` / `requireAdmin`, and ownership comes
    from the token. Other users' resources return 404.
  - Multi-step DB writes are atomic `private.*` functions.
  - RLS is on everywhere, with no client grants.
  - Fees live only in `lib/fees.ts`. The UI calls the API only through
    `lib/api/*`.
- Before changing an API, interface or component contract, search for every
  usage. Before changing the schema, read the existing migrations and
  usages, and add a *new* migration.
- Validate input at system boundaries. Never trust client-supplied prices,
  status or ownership.
- Never fix errors by disabling, deleting or skipping tests, weakening
  assertions without justification, using `any`, suppressing TypeScript
  errors (`@ts-ignore` / `@ts-expect-error`), disabling lint rules without
  justification, hard-coding values to pass tests, silently swallowing
  errors, or bypassing security controls.
- When something fails, find the root cause. Don't cycle through random fixes.
- Prefer small, reviewable changes. Avoid new dependencies, speculative
  abstractions, and rewrites of working code.
- Never expose secrets, log tokens or request bodies, or commit `.env*` files
  or credentials. Only `.env.example` is committed, with placeholders.
- No destructive git or database operations (force push, reset --hard,
  DROP/TRUNCATE, deleting data) without explicit user approval.
- Don't push, deploy, merge, or touch production systems (Supabase, Stripe,
  Vercel, Cloudflare, DNS) unless the user explicitly asks.
