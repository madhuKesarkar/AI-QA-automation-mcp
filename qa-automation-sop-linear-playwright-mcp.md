# Sprint QA Automation Process — Linear + Playwright MCP

## Goal
Every feature that enters QA in a sprint automatically gets a tagged Smoke / Sanity / UI Functional test suite, generated from the actual requirement documents (PRD, FE spec, BE spec, Figma) and run against the live build — with humans reviewing the plan before scripts execute, not after.

---

## 1. Trigger

- Linear issue status changes to **"Ready for QA"** (or whatever status column marks "dev done, needs testing").
- A webhook / Linear automation (or a QA engineer manually kicking off the agent) starts the pipeline for that issue.
- The issue is the single unit of work — one issue in, one test plan + one script bundle + one report out.

**Minimum issue hygiene required for this to work:** the issue must link to (or embed) the PRD, FE tech spec, BE tech spec, and Figma frame. If any are missing, the agent should flag it back on the issue rather than guessing.

---

## 2. Stage-by-stage process

### Stage 1 — Context gathering (Linear MCP + Figma)
The agent pulls:
- Issue title, description, acceptance criteria, labels, linked sub-issues
- Linked PRD (goals, user flows, edge cases called out)
- FE tech spec (components touched, routes, state changes, client validation rules)
- BE tech spec (new/changed endpoints, request/response shape, error codes, auth rules)
- Figma frame (via link — screenshot/inspect for UI states: empty, loading, error, success, responsive breakpoints)

Output: a single **context brief** (markdown) summarizing what changed and what "correct" looks like. This brief is attached as a comment/artifact on the Linear issue so it's auditable later.

### Stage 2 — Test plan generation
From the context brief, the agent drafts a test plan split into three tiers:

| Tier | Purpose | Typical scope |
|---|---|---|
| **Smoke** | Is the build even usable? | App loads, critical path renders, no console/network errors, core CTA works |
| **Sanity** | Does the specific feature work at a basic level? | Happy-path flow described in the PRD, main acceptance criteria |
| **UI Functional** | Full validation against spec | Edge cases, validation errors, empty/loading/error states, responsive behavior, field-level checks against FE/BE specs, visual states from Figma |

Each test case gets: an ID, a tier tag, a one-line description, preconditions, steps, expected result, and which source doc it was derived from (PRD §, Figma frame name, spec section). This traceability matters — six months later you want to know *why* a test exists.

Output: test plan posted as a **comment on the Linear issue** (or a linked Linear document), not yet executed.

### Stage 3 — Human review gate (do not skip this)
QA engineer reviews the plan directly in Linear:
- Approves as-is, or
- Edits/adds cases the agent missed (ambiguous specs, tribal knowledge, known flaky areas), or
- Requests regeneration with corrected context

This gate exists because AI-derived plans reliably miss implicit business rules that live only in people's heads or in Slack threads, not in the PRD. Skipping this step is the most common way these pipelines produce false confidence.

### Stage 4 — Script generation (Playwright MCP)
Once approved, the agent uses Playwright MCP against a running test/staging environment to:
- Navigate the actual flow described in each test case
- Capture real selectors (prefer `data-testid` / role-based locators over brittle CSS/XPath — flag to FE if `data-testid`s are missing on new components)
- Generate a `.spec.ts` per feature, with each test case tagged for its tier, e.g.:

```ts
test('user can submit form with valid data @sanity @smoke', async ({ page }) => { ... });
test('shows inline error for invalid email @functional', async ({ page }) => { ... });
```

- Store scripts in the repo under a path that mirrors the Linear issue key, e.g. `tests/features/ENG-482.spec.ts`, with a header comment linking back to the Linear issue.

### Stage 5 — Execution
- **Per-PR / per-issue run:** smoke + sanity only, fast feedback.
- **Nightly / pre-release run:** full functional suite across the sprint's accumulated tests.
- Use Playwright's `--grep @smoke` / `@sanity` / `@functional` tags for selective execution in CI.

### Stage 6 — Reporting back to Linear
- Post pass/fail summary + link to the HTML report (or CI run) as a comment on the originating issue.
- On failure: auto-attach the trace/video/screenshot Playwright captured, and flag whether it looks like a product bug vs. a flaky/environment issue (don't auto-close or auto-reopen issues without a human confirming — that's a judgment call the agent shouldn't make alone).

---

## 3. Roles and checkpoints

| Step | Owner | Checkpoint |
|---|---|---|
| Context brief | Agent | QA skims for obviously missing docs |
| Test plan | Agent | **QA approves before scripts are generated** |
| Script generation | Agent (Playwright MCP) | QA spot-checks selectors/flow once per feature type, not every time |
| Execution | CI | Automatic |
| Triage of failures | QA | Human decides bug vs. flake vs. spec ambiguity |

---

## 4. Suggested Linear conventions to support this
- A dedicated **label set**: `qa:smoke`, `qa:sanity`, `qa:functional`, `qa:plan-pending`, `qa:plan-approved`, `qa:automated`
- A **sub-issue or comment template** the agent always fills the same way, so plans are skimmable and diffable across features
- A **linked "Test Coverage" document per project** in Linear, aggregating which features have which tiers automated — useful at sprint retro to see coverage gaps

---

## 5. Prompt skeletons (for the agent step)

**Context gathering prompt:**
> Given this Linear issue [link], its linked PRD [link], FE spec [link], BE spec [link], and Figma frame [link], summarize: (1) what user-facing behavior is changing, (2) new/changed API contracts, (3) all UI states shown in Figma (empty/loading/error/success/responsive), (4) explicit acceptance criteria. Flag anything referenced but not linked.

**Test plan prompt:**
> Using the context brief above, produce a test plan with Smoke, Sanity, and UI Functional tiers. For each case include: ID, tier, steps, expected result, and source reference. Prioritize acceptance criteria and Figma-documented states. Do not invent business rules not present in the source docs — flag ambiguity instead of assuming.

**Script generation prompt (with Playwright MCP live browser access):**
> For each approved test case, navigate the staging app at [env URL], perform the described steps, and generate a Playwright test tagged with its tier. Prefer role/testid locators. If a required locator doesn't exist, note it instead of guessing a brittle selector.

---

## 6. Things to watch for
- **Don't let the agent auto-approve its own test plan.** The review gate is the main defense against confidently-wrong coverage.
- **Test data / environment stability** matters more here than in manual QA — Playwright MCP needs a consistently seeded staging environment, or generated scripts will be flaky by construction.
- **Selector hygiene** — push FE to add `data-testid`s on new components; this single habit change dramatically reduces flakiness of MCP-generated locators.
- **Traceability** — keep the source-doc reference on every test case. When specs change mid-sprint, you need to know which tests to regenerate, not re-derive everything from scratch.
- **Version control the test plan, not just the scripts** — plans posted only as Linear comments get lost; consider also committing the plan markdown alongside the spec file in-repo.
