#!/usr/bin/env node
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig, runDoctorChecks, ConfigError } from './lib/env.js';
import { log, logError } from './lib/logger.js';
import { startWebhookServer, type LinearWebhookPayload } from './lib/linearWebhook.js';
import { runRequirementsReviewerAgent } from './agents/requirementsReviewer.js';
import { runTestPlannerAgent } from './agents/testPlanner.js';
import { runExecutorAgent } from './agents/executor.js';
import { runBugAnalyserAgent } from './agents/bugAnalyser.js';
import { runStatusReporterAgent } from './agents/statusReporter.js';
import { fetchTicket } from './lib/linear.js';
import { EXIT_CODES, LINEAR_LABELS, type Environment, type Verdict, type RunSummary } from './types.js';

interface ParsedArgs {
  command: string;
  ticket?: string;
  dryRun: boolean;
  envFilter?: Environment;
  skipPlanGate: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const args: ParsedArgs = { command: command ?? 'help', dryRun: false, skipPlanGate: false };

  for (const arg of rest) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--skip-plan-gate') args.skipPlanGate = true;
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
    if (args.dryRun || !args.skipPlanGate) {
      // Planning pipeline only (equivalent to "ready for QA" trigger)
      return await runPlanningPipeline({
        ticketId,
        workDir,
        linearApiKey: config.linearApiKey,
        googleDocsApiKey: config.googleDocsApiKey,
        dryRun: args.dryRun,
      });
    }

    // Full pipeline (planning + execution)
    const planResult = await runPlanningPipeline({
      ticketId,
      workDir,
      linearApiKey: config.linearApiKey,
      googleDocsApiKey: config.googleDocsApiKey,
      dryRun: false,
      silent: true, // skip the plan gate pause since --skip-plan-gate was passed
    });

    if (planResult !== EXIT_CODES.VERIFIED) return planResult;

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
  silent?: boolean; // skip the plan gate log if proceeding immediately to execution
}

async function runPlanningPipeline(opts: PlanningOptions): Promise<number> {
  const { ticketId, workDir, linearApiKey, googleDocsApiKey, dryRun, silent } = opts;

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
      `Requirements have ${requirementsDoc.uncertainSections.length} UNCERTAIN section(s) that must be resolved before test planning:\n` +
        requirementsDoc.uncertainSections.map((s) => `  - ${s}`).join('\n')
    );
    return EXIT_CODES.NEEDS_HUMAN;
  }

  // Stage 2: test-planner
  const plan = await runTestPlannerAgent(requirementsDoc, workDir);

  if (plan.needsHuman) {
    log('cli', `Test plan needs human input: ${plan.openQuestions.join('; ')}`);
    return EXIT_CODES.NEEDS_HUMAN;
  }

  if (dryRun) {
    log('cli', `Dry run complete. Feature: ${plan.featurePath}  Plan: ${plan.planPath}`);
    return EXIT_CODES.VERIFIED;
  }

  if (!silent) {
    log(
      'cli',
      `Plan gate: review ${plan.planPath} then re-run with --skip-plan-gate, ` +
        `or apply the "${LINEAR_LABELS.READY_FOR_QA_EXECUTION}" label to trigger execution automatically.`
    );
    return EXIT_CODES.NEEDS_HUMAN;
  }

  return EXIT_CODES.VERIFIED;
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
  const featurePath = `${workDir}/${ticketId.toLowerCase()}.feature`;
  const requirementsPath = `${workDir}/requirements.md`;

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
  console.log(`bw-qa-loop — 5-agent QA pipeline: Linear → requirements → Gherkin → execution → bug analysis → report

Pipelines:
  "ready for QA" label     →  requirements-reviewer + test-planner (plan gate)
  "ready for QA execution" →  executor → bug-analyser → status-reporter

Direct usage:
  bw-qa-loop <TICKET-ID>                  Planning pipeline (stops at plan gate)
  bw-qa-loop <TICKET-ID> --dry-run        Requirements + scenarios only, no gate, no execution
  bw-qa-loop <TICKET-ID> --skip-plan-gate Full pipeline (planning + execution)
  bw-qa-loop <TICKET-ID> --env=sandbox    Execution against one environment only
  bw-qa-loop webhook                      Start webhook server (label-driven automation)
  bw-qa-loop doctor                       Check Docker, env vars, storageState files

Exit codes: 0 verified · 1 needs-human · 2 error · 3 product-bug-found`);
}

main().then((code) => process.exit(code));