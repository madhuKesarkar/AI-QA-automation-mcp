# bw-qa-loop — Agent orchestrator

A Linear ticket goes in; a test plan, a real execution against Sandbox and
QA, and a posted-back Linear comment come out.

This is modeled on an internal backend pattern (implement → verify → fix,
running headless Claude stages inside a Docker sandbox, communicating only
through artifact files) — adapted for QA with one deliberate, important
difference explained below.

## The one critical difference from the backend pattern

The backend loop retries until code passes. **This loop does not retry
until scenarios pass.** If a scenario fails because the *product* has a
real bug, silently looping until green would mean the agent hides the bug
instead of reporting it. So:

- Failures are only auto-retried if they're **infra-type** (flaky
  timing, a stale selector, an environment hiccup) — and even then, this
  version stops after round 1 rather than auto-classifying failure type,
  because an automated "is this really a bug" judgment is exactly the
  kind of false-confidence risk this project exists to avoid. See
  `src/cli.ts`'s loop comment.
- A real product-behavior failure stops the loop, gets written into the
  report, and gets posted to Linear as `qa:bug-found` — a finding, not
  a retry target.

## How the ride works

1. **Fetch** (`stages/fetchTicket.ts`) — pulls the ticket from Linear via
   GraphQL, parses acceptance criteria from markdown checklist items in
   the description.
2. **Scenarios** (`stages/scenarioWriter.ts`) — a Claude call turns AC into
   tagged Gherkin (`@smoke`/`@sanity`/`@functional`), grounded in
   `selector-registry.json` so it reuses known selectors instead of
   guessing. If AC is missing or ambiguous, it refuses to invent behavior
   and flags `needsHuman` with specific open questions instead.
3. **[HUMAN GATE]** — the run stops here by default. A human reviews the
   generated `.feature` + `.md` and re-runs with `--skip-plan-gate`.
   This is non-negotiable — see the SOP's review-gate rationale.
4. **Selectors** (`stages/selectorAgent.ts`) — checks every selector the
   plan references against the registry. Anything not already known
   stops the run with `needs-human`, because this stage **cannot**
   autonomously discover a selector for UI it's never seen (see the
   honest limitation documented in that file).
5. **Runner** (`stages/runner.ts`) — executes the `.feature` file with
   the existing Playwright + playwright-bdd setup in the repo root,
   against Sandbox and/or QA, using a pre-captured `storageState` for
   auth.
6. **Report** (`stages/reportAgent.ts`) — aggregates verdicts from both
   environments into one self-contained `report.html`.
7. **Linear reporter** (`stages/linearReporter.ts`) — posts a pass/fail
   summary as a comment on the originating ticket and applies a status
   label (`qa:automated` / `qa:needs-review` / `qa:bug-found`).

The orchestrator (`cli.ts`) is deterministic control flow; only the
scenario-writer stage calls out to Claude, and only the runner stage
drives a real browser. Every stage reads/writes the shapes defined in
`src/types.ts` under `./project-envs/<TICKET>/` — stages never share
in-memory state.

## The other human-in-the-loop step: capturing a session

Headless agents can't complete an interactive login (2FA, SSO, whatever
your environment requires) on their own — and having an agent try to
guess around that would be the same false-verification problem as
guessing at selectors. So, once per environment, a human runs:

```bash
node agent/dist/captureSession.js --env=sandbox
node agent/dist/captureSession.js --env=qa
```

This opens a real, visible browser. Log in manually, press Enter in the
terminal, and it saves `agent/storageState.<env>.json`. Every subsequent
headless run reuses that file. Re-run this whenever a session expires.

## Capturing new selectors

When the selector stage reports `needs-human` for a new key:

1. Use Claude in Chrome (or manual Playwright codegen) to confirm the
   real accessible name/role for the element — the same process used to
   build the existing `bulk-upload-rates-single-site` coverage. Don't
   guess from a screenshot; confirm against the live accessibility tree.
2. Add the entry to `agent/selector-registry.json`.
3. Re-run the ticket.

## Run it

Host needs only **Docker**. Put credentials in `.env` next to the repo
root (see `.env.example`):

```
LINEAR_API_KEY=...       # fetch the ticket, post comments, apply labels
ANTHROPIC_API_KEY=...    # scenario-writer stage
SANDBOX_URL=https://schools.sandbox.bwtest.net
QA_URL=https://schools.qa.bwtest.net
```

Then, from the repo root:

```bash
./agent/bin/bw-qa-loop FINOPS-456                    # the full ride (stops at the plan gate)
./agent/bin/bw-qa-loop FINOPS-456 --dry-run          # scenarios only, nothing else
./agent/bin/bw-qa-loop FINOPS-456 --skip-plan-gate   # proceed past the gate once approved
./agent/bin/bw-qa-loop FINOPS-456 --env=sandbox      # one environment only
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
- The scenario-writer's Claude call (needs a real `ANTHROPIC_API_KEY` and
  a real ticket with markdown-checklist AC to fully validate the prompt)
- The runner stage's Playwright execution (needs Docker + a captured
  `storageState` to test against real Sandbox/QA)
- The Docker build itself (untested in this environment — no Docker
  available in the sandbox this was built in; needs validation on a real
  machine before first use)

Treat this as a solid, honest skeleton — not a "trust it blindly" black
box. Run `doctor` first, use `--dry-run` liberally, and read what each
stage logs.
