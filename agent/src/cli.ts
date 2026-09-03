#!/usr/bin/env node
import 'dotenv/config';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { loadConfig, runDoctorChecks, ConfigError } from './lib/env.js';
import { log, logError } from './lib/logger.js';
import { startWebhookServer, type LinearWebhookPayload } from './lib/linearWebhook.js';
import { runRequirementsReviewerAgent } from './agents/requirementsReviewer.js';
import { runTestPlannerAgent } from './agents/testPlanner.js';
import { runStepGeneratorAgent } from './agents/stepGenerator.js';
import { runExecutorAgent } from './agents/executor.js';
import { runBugAnalyserAgent } from './agents/bugAnalyser.js';
import { runStatusReporterAgent } from './agents/statusReporter.js';
import { fetchTicket, postComment, addLabel } from './lib/linear.js';
import { openPlanPr, verifyPlanApproved } from './lib/planApproval.js';
import {
  EXIT_CODES,
  LINEAR_LABELS,
  type Environment,
  type RequirementsDoc,
  type ScenarioPlan,
  type StepGenerationResult,
  type PlanPr,
  type Verdict,
  type RunSummary,
} from './types.js';

interface ParsedArgs {
  command: string;
  ticket?: string;
  dryRun: boolean;
  envFilter?: Environment;
  skipPlanGate: boolean;
  skipSteps: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const args: ParsedArgs = {
    command: command ?? 'help',
    dryRun: false,
    skipPlanGate: false,
    skipSteps: false,
  };

  for (const arg of rest) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--skip-plan-gate') args.skipPlanGate = true;
    else if (arg === '--skip-steps') args.skipSteps = true;
    else if (arg.startsWith('--env=')) args.envFilter = arg.split('=')[1] as Environment;
    else if (!arg.startsWith('--') && !args.ticket) args.ticket = arg;
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'doctor') {
    const checks = runDoctorChecks();
    let allOk = true;
    for (const check of checks) {
      const icon = check.ok ? '✓' : '✗';
      console.log(`${icon} ${check.name}: ${check.detail}`);
      if (!check.ok) allOk = false;
    }
    return allOk ? EXIT_CODES.VERIFIED : EXIT_CODES.ERROR;
  }

  if (args.command === 'webhook') {
    return runWebhookServer();
  }

  if (args.command === 'help' || args.command === '') {
    printHelp();
    return EXIT_CODES.ERROR;
  }

  // Direct invocation: bw-qa-loop <TICKET-ID> [flags]
  // Runs the planning pipeline by default; add --skip-plan-gate to also execute.
  const ticketId = args.command;
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logError('config', err.message);
      return EXIT_CODES.ERROR;
    }
    throw err;
  }

  const workDir = `./project-envs/${ticketId}`;
  mkdirSync(workDir, { recursive: true });

  try {
    // --skip-plan-gate no longer re-plans. Plan generation is nondeterministic
    // (re-running FINOPS-445 moved 68 → 83 scenarios and rewrote ~1100 lines),
    // so re-planning here would execute a plan nobody reviewed. It now goes
    // straight to execution, which refuses any plan not merged to main (see
    // runExecutionPipeline → verifyPlanApproved). --dry-run stays a
    // planning-only variant and never executes.
    if (args.skipPlanGate && !args.dryRun) {
      const ticket = await fetchTicket(config.linearApiKey, ticketId);
      const envsToRun: Environment[] = args.envFilter ? [args.envFilter] : ['sandbox', 'qa'];
      return await runExecutionPipeline({
        ticketId,
        issueId: ticket.id,
        issueUrl: ticket.url,
        workDir,
        linearApiKey: config.linearApiKey,
        slackWebhookUrl: config.slackWebhookUrl,
        environments: envsToRun,
      });
    }

    // Planning pipeline: requirements → plan → steps → open a plan PR (the gate).
    return await runPlanningPipeline({
      ticketId,
      workDir,
      linearApiKey: config.linearApiKey,
      googleDocsApiKey: config.googleDocsApiKey,
      dryRun: args.dryRun,
      skipSteps: args.skipSteps,
    });
  } catch (err) {
    logError('cli', (err as Error).message);
    return EXIT_CODES.ERROR;
  }
}

// ─── Planning Pipeline ───────────────────────────────────────────────────────
// Triggered by: Linear label "ready for QA" (or direct CLI invocation)
// Stages: requirementsReviewer → testPlanner → plan gate

interface PlanningOptions {
  ticketId: string;
  workDir: string;
  linearApiKey: string;
  googleDocsApiKey?: string;
  dryRun?: boolean;
  skipSteps?: boolean; // skip step-definition generation (Bedrock calls)
}

async function runPlanningPipeline(opts: PlanningOptions): Promise<number> {
  const { ticketId, workDir, linearApiKey, googleDocsApiKey, dryRun, skipSteps } = opts;

  // Stage 1: requirements-reviewer
  const requirementsDoc = await runRequirementsReviewerAgent(
    linearApiKey,
    ticketId,
    workDir,
    googleDocsApiKey
  );

  if (requirementsDoc.uncertainSections.length > 0) {
    log(
      'cli',
      `${requirementsDoc.uncertainSections.length} UNCERTAIN requirement(s) will be recorded as open ` +
        `questions and left unscripted (partial planning) — they no longer block the run.`
    );
  }

  // Stage 2: test-planner (partial planning — scripts the clear requirements,
  // records uncertain/contradictory ones as open questions instead of blocking)
  const plan = await runTestPlannerAgent(requirementsDoc, workDir);

  if (plan.scenarioCount === 0) {
    log(
      'cli',
      `No testable scenarios could be generated — nothing was clear enough to script. ` +
        `Open questions: ${plan.openQuestions.join('; ')}`
    );
    return EXIT_CODES.NEEDS_HUMAN;
  }

  if (plan.openQuestions.length > 0) {
    log(
      'cli',
      `Partial plan: ${plan.scenarioCount} scenario(s) generated; ` +
        `${plan.openQuestions.length} requirement(s) recorded as open questions for human follow-up.`
    );
  }

  // Stage 3: step-generator. A .feature with undefined steps cannot be
  // compiled by playwright-bdd, so the glue is part of the plan, not part of
  // execution — the human reviewing the plan reviews the step definitions and
  // the list of selectors still needed along with it.
  let steps: StepGenerationResult | undefined;
  if (!skipSteps) {
    const repoRoot = new URL('../../', import.meta.url).pathname;
    steps = await runStepGeneratorAgent(ticketId, plan.featurePath, repoRoot);

    if (steps.status === 'failed') {
      logError(
        'cli',
        `Step generation left ${steps.missingStepsAfter} step(s) undefined — the feature will not compile, ` +
          `so it cannot execute. Review ${steps.stepsPath}.`
      );
    } else if (steps.unimplementedSteps > 0) {
      log(
        'cli',
        `${steps.implementedSteps}/${steps.totalSteps} step(s) implemented; ${steps.unimplementedSteps} blocked ` +
          `on selectors a human must capture (see agent/README.md, "Capturing new selectors"). ` +
          `Those scenarios will fail loudly rather than report false coverage.`
      );
    }
  }

  if (dryRun) {
    log(
      'cli',
      `Dry run complete. Feature: ${plan.featurePath}  Plan: ${plan.planPath} ` +
        `(${plan.scenarioCount} scenario(s), ${plan.openQuestions.length} open question(s))` +
        (steps ? `  Steps: ${steps.stepsPath} [${steps.status}]` : '')
    );
    return EXIT_CODES.VERIFIED;
  }

  // A plan whose steps do not compile is not executable, so it cannot be
  // proposed as a runnable plan — stop before opening a PR.
  if (steps?.status === 'failed') {
    return EXIT_CODES.NEEDS_HUMAN;
  }

  // The plan gate is a pull request. Propose the plan + glue on a per-ticket
  // branch, open a PR, and link it on the ticket — merging the PR is the
  // approval. Nothing runs against an environment until the executor confirms
  // the plan on disk is byte-for-byte what was merged (runExecutionPipeline).
  const repoRoot = new URL('../../', import.meta.url).pathname;
  const planFiles = collectPlanFiles(repoRoot, ticketId, plan, requirementsDoc, steps);
  const pr = await openPlanPr({
    ticket: ticketId,
    repoRoot,
    files: planFiles,
    title: `QA plan: ${ticketId}`,
    body: planPrBody(ticketId, plan, steps),
  });

  if (pr.alreadyOnMain) {
    log(
      'cli',
      `Plan for ${ticketId} is already on origin/main (${pr.commitSha.slice(0, 8)}) — already approved. ` +
        `Trigger execution with --skip-plan-gate or the "${LINEAR_LABELS.READY_FOR_QA_EXECUTION}" label.`
    );
    return EXIT_CODES.VERIFIED;
  }

  await linkPlanPrOnLinear(linearApiKey, ticketId, pr);
  log(
    'cli',
    `Plan gate: review and MERGE the plan PR to approve, then trigger execution ` +
      `(apply "${LINEAR_LABELS.READY_FOR_QA_EXECUTION}" or re-run with --skip-plan-gate). ` +
      (pr.prUrl ? `PR: ${pr.prUrl}` : `Branch pushed: ${pr.branch} — open the PR manually.`)
  );
  return EXIT_CODES.NEEDS_HUMAN;
}

/** Plan artifacts to propose in the PR: the executable pair (feature + step
 * definitions) plus human-review context (the plan table and the consolidated
 * requirements). Only files that exist are included — steps are absent under
 * --skip-steps. Paths are resolved against repoRoot so this does not depend on
 * the process working directory. */
function collectPlanFiles(
  repoRoot: string,
  ticketId: string,
  plan: ScenarioPlan,
  requirementsDoc: RequirementsDoc,
  steps: StepGenerationResult | undefined
): string[] {
  const stepsPath = steps?.stepsPath || `tests/steps/${ticketId.toLowerCase()}.steps.ts`;
  const candidates = [plan.featurePath, plan.planPath, requirementsDoc.requirementsPath, stepsPath];
  return candidates.filter(
    (p) => Boolean(p) && existsSync(`${repoRoot}${p.replace(/^\.\//, '')}`)
  );
}

function planPrBody(
  ticketId: string,
  plan: ScenarioPlan,
  steps: StepGenerationResult | undefined
): string {
  const lines = [
    `Automated QA plan for ${ticketId}, proposed for review by bw-qa-loop.`,
    '',
    `- Scenarios: ${plan.scenarioCount}`,
    `- Open questions: ${plan.openQuestions.length}` +
      (plan.openQuestions.length ? ` — ${plan.openQuestions.join('; ')}` : ''),
  ];
  if (steps) {
    lines.push(
      `- Step definitions: ${steps.implementedSteps}/${steps.totalSteps} implemented` +
        (steps.unimplementedSteps
          ? `, ${steps.unimplementedSteps} blocked on unverified selectors (those scenarios will fail loudly, not report false coverage)`
          : '')
    );
  }
  lines.push(
    '',
    'Merging this PR approves the plan. Execution runs only the merged plan and',
    'records its commit sha; nothing runs against an environment before merge.',
    '',
    `Refs ${ticketId}`
  );
  return lines.join('\n');
}

/** Posts the plan PR link back to the ticket so a webhook-driven run is
 * reviewable without server access, and marks the ticket plan-pending. Failures
 * here are non-fatal: the branch/PR already exists, so the plan is not lost. */
async function linkPlanPrOnLinear(apiKey: string, ticketId: string, pr: PlanPr): Promise<void> {
  try {
    const ticket = await fetchTicket(apiKey, ticketId);
    const body = pr.prUrl
      ? `🧪 **QA plan proposed for review:** ${pr.prUrl}\n\n` +
        `Merging this PR approves the plan. Execution runs only the merged plan and records its ` +
        `commit (\`${pr.commitSha.slice(0, 8)}\`) — nothing runs against an environment before merge.`
      : `🧪 **QA plan pushed** to branch \`${pr.branch}\` (\`${pr.commitSha.slice(0, 8)}\`). ` +
        `Open a PR against main to request approval.`;
    await postComment(apiKey, ticket.id, body);
    try {
      await addLabel(apiKey, ticket.id, LINEAR_LABELS.QA_PLAN_PENDING);
    } catch (err) {
      log('cli', `Could not apply "${LINEAR_LABELS.QA_PLAN_PENDING}" label: ${(err as Error).message}`);
    }
  } catch (err) {
    logError(
      'cli',
      `Could not link the plan PR on Linear (${(err as Error).message}). PR/branch: ${pr.prUrl || pr.branch}`
    );
  }
}

// ─── Execution Pipeline ──────────────────────────────────────────────────────
// Triggered by: Linear label "ready for QA execution" (or --skip-plan-gate CLI flag)
// Stages (run sequentially): executor → bugAnalyser → statusReporter

interface ExecutionOptions {
  ticketId: string;
  issueId: string;
  issueUrl: string;
  workDir: string;
  linearApiKey: string;
  slackWebhookUrl?: string;
  environments: Environment[];
}

async function runExecutionPipeline(opts: ExecutionOptions): Promise<number> {
  const {
    ticketId, issueId, issueUrl, workDir,
    linearApiKey, slackWebhookUrl,
    environments,
  } = opts;

  // Look for the feature file written by the planning pipeline
  const slug = ticketId.toLowerCase();
  const featurePath = `${workDir}/${slug}.feature`;
  const requirementsPath = `${workDir}/requirements.md`;
  const stepsPath = `tests/steps/${slug}.steps.ts`;

  // Approval gate. Re-planning is gone (see main), so the artifacts on disk are
  // whatever a prior planning run produced. Before touching any environment,
  // verify the feature and its step definitions are byte-for-byte the plan that
  // was merged to main — merging the plan PR is the only approval, and this is
  // what makes the executed feature provably the reviewed one.
  const repoRoot = new URL('../../', import.meta.url).pathname;
  const approval = await verifyPlanApproved({
    ticket: ticketId,
    repoRoot,
    files: [featurePath, stepsPath],
  });
  if (!approval.approved) {
    logError('cli', `Refusing to execute ${ticketId}: ${approval.reason}`);
    return EXIT_CODES.NEEDS_HUMAN;
  }
  writeFileSync(
    `${workDir}/plan-approval.json`,
    JSON.stringify(approval, null, 2) + '\n',
    'utf-8'
  );
  log(
    'cli',
    `Approved plan verified against origin/main (${approval.mergedCommit?.slice(0, 8)}); executing ` +
      approval.files.map((f) => `${f.path}@${f.sha.slice(0, 8)}`).join(', ') + '.'
  );

  // Stage 3: executor
  const { selectorReport, verdicts } = await runExecutorAgent(
    ticketId,
    featurePath,
    environments,
    workDir
  );

  if (selectorReport.status === 'needs-human') {
    log('cli', `Missing selectors: ${selectorReport.missing.join(', ')} — cannot run headlessly.`);
    return EXIT_CODES.NEEDS_HUMAN;
  }

  // Nothing executed is not a pass. The bug-analyser classifies failures, so
  // it reads a zero-failure verdict as "all scenarios passed" — which for an
  // empty run would post a green QA result to the ticket for a suite that
  // never ran. Stop here and report the diagnostic instead.
  const nonRuns = verdicts.filter((v) => v.executionStatus !== 'ran');
  if (nonRuns.length > 0) {
    for (const v of nonRuns) {
      logError('cli', `${v.environment}: no scenarios executed [${v.executionStatus}] — ${v.diagnostic}`);
    }
    await runStatusReporterAgent(linearApiKey, issueId, issueUrl, {
      ticket: ticketId,
      verdicts,
      overallStatus: 'needs-human',
      reportPath: '',
      approvedCommit: approval.mergedCommit,
    }, slackWebhookUrl);
    return EXIT_CODES.NEEDS_HUMAN;
  }

  // Stage 4: bug-analyser. Runs after the executor because it classifies the
  // executor's verdicts — it cannot start until execution is complete. (An
  // earlier design imagined these running in parallel; that would require
  // streaming Playwright results and is not implemented.)
  const bugReport = await runBugAnalyserAgent(
    ticketId,
    verdicts,
    requirementsPath,
    workDir
  );

  // Assemble run summary
  const overallStatus: RunSummary['overallStatus'] =
    bugReport.overallStatus === 'product-bug-found' ? 'product-bug-found' :
    bugReport.overallStatus === 'passed' ? 'verified' :
    'needs-human';

  const reportPath = `${workDir}/${ticketId.toLowerCase()}.report.html`;
  writeHtmlReport(ticketId, verdicts, bugReport, reportPath);

  const summary: RunSummary = {
    ticket: ticketId,
    verdicts,
    bugReport,
    overallStatus,
    reportPath,
    approvedCommit: approval.mergedCommit,
  };

  // Stage 5: status-reporter
  await runStatusReporterAgent(linearApiKey, issueId, issueUrl, summary, slackWebhookUrl);

  if (summary.overallStatus === 'verified') return EXIT_CODES.VERIFIED;
  if (summary.overallStatus === 'product-bug-found') return EXIT_CODES.PRODUCT_BUG_FOUND;
  return EXIT_CODES.NEEDS_HUMAN;
}

// ─── Webhook Server ──────────────────────────────────────────────────────────

async function runWebhookServer(): Promise<number> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logError('config', err.message);
      return EXIT_CODES.ERROR;
    }
    throw err;
  }

  startWebhookServer(
    config.webhookPort,
    config.linearWebhookSecret,

    // "ready for QA" → planning pipeline
    async (payload: LinearWebhookPayload) => {
      const ticketId = payload.data.identifier;
      const workDir = `./project-envs/${ticketId}`;
      mkdirSync(workDir, { recursive: true });

      log('webhook', `Starting planning pipeline for ${ticketId}`);
      const result = await runPlanningPipeline({
        ticketId,
        workDir,
        linearApiKey: config.linearApiKey,
        googleDocsApiKey: config.googleDocsApiKey,
      });
      log('webhook', `Planning pipeline for ${ticketId} exited with code ${result}`);
    },

    // "ready for QA execution" → execution pipeline
    async (payload: LinearWebhookPayload) => {
      const ticketId = payload.data.identifier;
      const workDir = `./project-envs/${ticketId}`;
      mkdirSync(workDir, { recursive: true });

      log('webhook', `Starting execution pipeline for ${ticketId}`);
      const result = await runExecutionPipeline({
        ticketId,
        issueId: payload.data.id,
        issueUrl: payload.data.url,
        workDir,
        linearApiKey: config.linearApiKey,
        slackWebhookUrl: config.slackWebhookUrl,
        environments: ['sandbox', 'qa'],
      });
      log('webhook', `Execution pipeline for ${ticketId} exited with code ${result}`);
    }
  );

  // Keep process alive
  return new Promise(() => {});
}

// ─── HTML Report ─────────────────────────────────────────────────────────────

function writeHtmlReport(ticket: string, verdicts: Verdict[], bugReport: any, path: string): void {
  const statusColor = bugReport.overallStatus === 'passed' ? '#1e7e34' : '#b00020';
  const envSections = verdicts.map((v) => {
    const rows = v.results
      .map(
        (r) =>
          `<tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${r.tags.join(', ')}</td>
            <td style="color:${r.status === 'passed' ? '#1e7e34' : r.status === 'skipped' ? '#888' : '#b00020'}">${r.status}</td>
            <td>${r.message ? escapeHtml(r.message.slice(0, 300)) : ''}</td>
          </tr>`
      )
      .join('');
    return `<h2>${v.environment} <small>(${v.ranAt})</small></h2>
      <p>${v.passed} passed &middot; ${v.failed} failed &middot; ${v.skipped} skipped</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
        <tr><th>Scenario</th><th>Tags</th><th>Status</th><th>Message</th></tr>
        ${rows}
      </table>`;
  }).join('\n');

  const bugRows = (bugReport.bugs ?? [])
    .map(
      (b: any) =>
        `<tr style="background:#fff3f3">
          <td>${escapeHtml(b.scenarioName)}</td>
          <td>${b.environment}</td>
          <td>${escapeHtml(b.requirementSection)}</td>
          <td>${escapeHtml(b.description)}</td>
        </tr>`
    )
    .join('');

  const bugsTable = bugRows
    ? `<h2>🐛 Product Bugs (mapped to requirements)</h2>
       <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
         <tr><th>Scenario</th><th>Env</th><th>Requirement</th><th>Description</th></tr>
         ${bugRows}
       </table>`
    : '';

  writeFileSync(
    path,
    `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${ticket} — QA report</title></head>
<body style="font-family:sans-serif;max-width:960px;margin:40px auto;">
  <h1>${ticket} <span style="color:${statusColor}">[${bugReport.overallStatus}]</span></h1>
  ${bugsTable}
  ${envSections}
</body>
</html>`,
    'utf-8'
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`bw-qa-loop — 6-agent QA pipeline: Linear → requirements → Gherkin → steps → execution → bug analysis → report

Pipelines:
  "ready for QA" label     →  requirements → plan → steps → open plan PR (merge to approve)
  "ready for QA execution" →  verify merged plan → executor → bug-analyser → status-reporter

Direct usage:
  bw-qa-loop <TICKET-ID>                  Planning pipeline → opens a plan PR (merge it to approve)
  bw-qa-loop <TICKET-ID> --dry-run        Requirements + scenarios + steps, no PR, no execution
  bw-qa-loop <TICKET-ID> --skip-steps     Skip step-definition generation
  bw-qa-loop <TICKET-ID> --skip-plan-gate Execute the approved (merged) plan — no re-planning
  bw-qa-loop <TICKET-ID> --env=sandbox    Execute against one environment only
  bw-qa-loop webhook                      Start webhook server (label-driven automation)
  bw-qa-loop doctor                       Check Docker, env vars, storageState files

Exit codes: 0 verified · 1 needs-human · 2 error · 3 product-bug-found`);
}

main().then((code) => process.exit(code));