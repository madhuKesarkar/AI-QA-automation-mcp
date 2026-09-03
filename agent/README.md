# bw-qa-loop — Agent orchestrator

A Linear ticket goes in; a test plan, a real execution against Sandbox and
QA, and a posted-back Linear comment come out.

This is modeled on an internal backend pattern (implement → verify → fix,
running headless Claude stages that communicate only through artifact
files) — adapted for QA with one deliberate, important difference
explained below.

## The one critical difference from the backend pattern

The backend loop retries until code passes. **This loop does not retry
until scenarios pass.** If a scenario fails because the *product* has a
real bug, silently looping until green would mean the agent hides the bug
instead of reporting it. So a real product-behavior failure stops the
pipeline, gets written into the report, and gets posted to Linear as
`qa:bug-found` — a finding, not a retry target.

There is no automatic retry loop at all in this version. An earlier design
carried `MAX_ROUNDS`/round-counting config for infra-only retries; it was
never implemented and has been removed rather than left as dead config,
because an automated "is this really a bug?" judgment is exactly the kind
of false-confidence risk this project exists to avoid.

## Architecture: two pipelines, five agents

Every agent reads and writes the shapes in `src/types.ts` to disk under
`./project-envs/<TICKET>/`. Agents never share in-memory state — the files
on disk are the only contract between them. `cli.ts` is deterministic
control flow; the Claude calls live inside three of the agents, and only
the executor drives a real browser.

### Planning pipeline — trigger: Linear label **"ready for QA"**

1. **requirements-reviewer** (`agents/requirementsReviewer.ts`) — fetches
   the ticket from Linear via GraphQL, parses acceptance criteria from the
   description's markdown checklist, and fetches linked resources. It reads
   Google Docs and Linear documents directly; for sources it can't reach
   headlessly (Figma, private Google Docs, Slack, Orchard prototypes) it
   first checks a per-ticket **resource cache** (see "Resource cache"
   below), and only flags a source inaccessible if neither works. A Claude
   call consolidates everything into `requirements.md`, flagging anything
   unclear or contradictory under **UNCERTAIN** rather than guessing.
   UNCERTAIN items do **not** block the run — they are carried to the
   planner as open questions (see "Partial planning" below).
2. **test-planner** (`agents/testPlanner.ts`) — reads the consolidated
   `requirements.md` (never the raw ticket noise) and does **partial
   planning**: it scripts every requirement clear enough to test and
   records the UNCERTAIN/contradictory ones as open questions instead of
   refusing to plan. Each scenario gets a priority (`@p0`/`@p1`/`@p2`) and
   tier (`@smoke`/`@sanity`/`@functional`) tag, a `# requirement: §x` trace,
   and — where a step needs a known selector — a `# selector: <key>`
   annotation grounded in `selector-registry.json`. The `.md` plan table
   carries Priority and Severity columns. The planner only returns
   `needs-human` if it could produce **zero** scenarios.
   Between the planner and the gate, the **step-generator**
   (`agents/stepGenerator.ts`) writes the `tests/steps/<ticket>.steps.ts`
   glue: playwright-bdd cannot compile a `.feature` with undefined steps, so
   the glue is part of the plan, not part of execution. A step whose UI is
   not in the registry is emitted as a
   `throw new Error('UNIMPLEMENTED_STEP: …')` rather than a guessed locator.
3. **[PLAN GATE — a pull request]** — the run stops here by default. Planning
   commits the `.feature`, plan `.md`, `requirements.md`, and step
   definitions to a per-ticket branch (`qa-plan/<ticket>`), opens a PR, and
   links it on the Linear ticket. **Merging the PR is the approval.** A human
   reviews the plan *and its glue and needed selectors* in the PR, then
   triggers execution (`--skip-plan-gate` or the **"ready for QA execution"**
   label). This gate is non-negotiable — see the SOP's review-gate rationale.
   The plan branch is proposed via git plumbing against a temporary index, so
   it never disturbs whatever working tree the operator or webhook server has
   open.

### Execution pipeline — trigger: Linear label **"ready for QA execution"** (or `--skip-plan-gate`)

Execution first re-plans **nothing**. It verifies the `.feature` and step
definitions on disk are byte-for-byte the plan that was merged to `main`
(`verifyPlanApproved`), refusing to run an unapproved or drifted plan, and
records the merged commit sha so the executed feature is provably the
reviewed one. Plan generation is nondeterministic, so "a plan for this
ticket was approved once" says nothing about the bytes about to run.

4. **executor** (`agents/executor.ts`) — first validates selectors from the
   **generated step definitions**, not from planner `# selector:` comments:
   every step either resolves to a registry-verified locator or carries an
   `UNIMPLEMENTED_STEP` throw, and any such throw stops the run with
   `needs-human`, because this stage **cannot** autonomously discover a
   selector for UI it has never seen (see "Capturing new selectors" below).
   If selectors check out, it runs the `.feature` file with the repo-root
   Playwright + playwright-bdd setup against each environment, using a
   pre-captured `storageState` for auth.
5. **bug-analyser** (`agents/bugAnalyser.ts`) — runs *after* the executor
   (it classifies the executor's verdicts, so it can't start earlier). A
   Claude call classifies each failure as `product-bug`, `env-flakiness`,
   or `test-issue`, mapping product bugs back to specific requirement
   sections. Only product bugs are treated as findings.
6. **status-reporter** (`agents/statusReporter.ts`) — posts a pass/fail
   summary comment on the originating ticket, applies a status label
   (`qa:automated` / `qa:needs-review` / `qa:bug-found`), removes the
   trigger label so a re-label is required to re-run, and (optionally)
   posts to Slack.

`cli.ts` assembles the two environments' verdicts plus the bug report into
a self-contained `report.html` before the status-reporter runs.

## Partial planning (why the run no longer blocks on uncertainty)

An earlier version refused to plan at all if the requirements had any
UNCERTAIN item. That blocked whole tickets on a single open question. The
planner now does **partial planning**: it scripts every requirement that is
clear enough to test and records the uncertain or contradictory ones as
**open questions** in the plan, rather than blocking.

The "don't fake verification" principle is preserved where it matters — at
the *scenario* level. The planner still **never scripts** a behavior it
can't ground in a confirmed requirement; uncertain and contradictory items
are written down as open questions, not turned into guessed assertions. The
only thing removed is the all-or-nothing pipeline block. The run returns
`needs-human` only if *nothing* could be planned.

## Resource cache

The reviewer fetches Linear docs and public Google Docs itself, but can't
reach Figma, private Google Docs, Slack, or Orchard prototypes headlessly.
Rather than let those become silent UNCERTAIN gaps, drop the pre-fetched
content into `project-envs/<TICKET>/resources/` and list it in
`resources/index.json`:

```json
[
  { "match": "<google-doc-or-figma-id>", "file": "prd.md" }
]
```

`match` is tested as a **substring of the resource URL** (robust to query
params and markdown-link artifacts); `file` is the cached content, relative
to `resources/`. The reviewer consults this cache **before** its own
fetchers, so cached content always wins. This is how an out-of-band step
(an MCP-enabled session, or a human) supplies content the sandboxed run
can't fetch. The cache is gitignored; the resulting `requirements.md`,
`.feature`, and plan `.md` are tracked so they're reviewable in a PR.

## The other human-in-the-loop step: capturing a session

Headless runs can't complete an interactive login (2FA, SSO, whatever your
environment requires) on their own — and having an agent guess around that
would be the same false-verification problem as guessing at selectors. So,
once per environment, a human runs:

```bash
node agent/dist/captureSession.js --env=sandbox
node agent/dist/captureSession.js --env=qa
```

This opens a real, visible browser. Log in manually, press Enter in the
terminal, and it saves `agent/storageState.<env>.json`. Every subsequent
headless run reuses that file. Re-run this whenever a session expires.

## Capturing new selectors

When the executor reports `needs-human` for a new selector key:

1. Use Claude in Chrome (or manual Playwright codegen) to confirm the real
   accessible name/role for the element — the same process used to build
   the existing `bulk-upload-rates-single-site` coverage. Don't guess from
   a screenshot; confirm against the live accessibility tree.
2. Add the entry to `agent/selector-registry.json`.
3. Re-run the ticket.

## Run it

Host needs only **Docker**. Put credentials in `.env` next to the repo root
(see `agent/.env.example`):

```
LINEAR_API_KEY=...       # fetch the ticket, post comments, apply labels
AWS_REGION=us-east-1     # Claude is called via AWS Bedrock, not the Anthropic public API
BEDROCK_MODEL_ID=...     # Bedrock model ID or application-inference-profile ARN
SANDBOX_URL=https://schools.sandbox.bwtest.net
QA_URL=https://schools.qa.bwtest.net
```

AWS credentials are read from the standard AWS chain (env vars, an IAM
role, or a profile). See `agent/.env.example` for the optional Slack,
Google Docs, and webhook settings.

Then, from the repo root:

```bash
./agent/bin/bw-qa-loop FINOPS-456                    # planning pipeline → opens a plan PR (merge it to approve)
./agent/bin/bw-qa-loop FINOPS-456 --dry-run          # requirements + scenarios + steps only, no PR, no execution
./agent/bin/bw-qa-loop FINOPS-456 --skip-plan-gate   # execute the approved (merged) plan — no re-planning
./agent/bin/bw-qa-loop FINOPS-456 --env=sandbox      # execute against one environment only
./agent/bin/bw-qa-loop webhook                       # start the label-driven webhook server
./agent/bin/bw-qa-loop doctor                        # check Docker, env vars, storageState files
```

Exit codes: `0` verified · `1` needs-human · `2` error · `3` product-bug-found.

For local iteration on the orchestrator itself without Docker (not the
supported path for real runs — no sandboxing):

```bash
BW_QA_LOOP_LOCAL=1 ./agent/bin/bw-qa-loop FINOPS-456 --dry-run
```

## What's genuinely working vs. what's still a stub

**Real and tested:**
- Linear GraphQL fetch/comment/label calls (real API, real error handling)
- Config validation and `doctor` diagnostics
- Selector registry known/missing logic
- Report aggregation and HTML rendering
- CLI arg parsing and exit codes

**Wired but not yet run end-to-end against real infra:**
- The Claude calls in requirements-reviewer, test-planner, and bug-analyser
  (need real Bedrock access and a real ticket with markdown-checklist AC to
  fully validate the prompts and the strict output parsing)
- The executor's Playwright execution (needs Docker + a captured
  `storageState` to test against real Sandbox/QA)
- The Docker build itself (validate on a real machine before first use)

Treat this as a solid, honest skeleton — not a "trust it blindly" black
box. Run `doctor` first, use `--dry-run` liberally, and read what each
stage logs.
