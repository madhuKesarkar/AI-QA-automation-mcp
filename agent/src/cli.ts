#!/usr/bin/env node
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { loadConfig, runDoctorChecks, ConfigError } from './lib/env.js';
import { log, logError } from './lib/logger.js';
import { runFetchStage } from './stages/fetchTicket.js';
import { runScenarioWriterStage } from './stages/scenarioWriter.js';
import { runSelectorStage } from './stages/selectorAgent.js';
import { runRunnerStage } from './stages/runner.js';
import { runReportStage } from './stages/reportAgent.js';
import { runLinearReporterStage } from './stages/linearReporter.js';
import { EXIT_CODES, type Environment, type Verdict } from './types.js';

interface ParsedArgs {
  command: string;
  ticket?: string;
  dryRun: boolean;
  envFilter?: Environment;
  skipPlanGate: boolean;
  maxRoundsOverride?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const args: ParsedArgs = { command: command ?? 'help', dryRun: false, skipPlanGate: false };

  for (const arg of rest) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--skip-plan-gate') args.skipPlanGate = true;
    else if (arg.startsWith('--env=')) args.envFilter = arg.split('=')[1] as Environment;
    else if (arg.startsWith('--max-rounds=')) args.maxRoundsOverride = Number(arg.split('=')[1]);
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

  if (args.command === 'help' || args.command === '') {
    printHelp();
    return EXIT_CODES.ERROR;
  }

  const ticketId = args.command; // e.g. `bw-qa-loop FINOPS-456`
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
  if (args.maxRoundsOverride) config.maxRounds = args.maxRoundsOverride;

  const workDir = `./project-envs/${ticketId}`;
  mkdirSync(workDir, { recursive: true });

  try {
    // Stage 1: fetch
    const ticket = await runFetchStage(config.linearApiKey, ticketId, workDir);

    // Stage 2: scenarios
    const plan = await runScenarioWriterStage(config.anthropicApiKey, ticket, workDir);

    if (plan.needsHuman) {
      log('cli', `Ticket needs human input before proceeding: ${plan.openQuestions.join('; ')}`);
      return EXIT_CODES.NEEDS_HUMAN;
    }

    if (args.dryRun) {
      log('cli', `Dry run complete. Plan written to ${plan.featurePath} and ${plan.planPath}. No execution performed.`);
      return EXIT_CODES.VERIFIED;
    }

    if (!args.skipPlanGate) {
      log(
        'cli',
        'Plan gate: this run stops here by default. A human must review ' +
          `${plan.planPath} and re-run with --skip-plan-gate once approved ` +
          '(or once your Linear label automation confirms qa:plan-approved).'
      );
      return EXIT_CODES.NEEDS_HUMAN;
    }

    // Stage 3: selectors
    const selectorReport = await runSelectorStage(ticketId, plan.featurePath);
    if (selectorReport.status === 'needs-human') {
      log(
        'cli',
        `Cannot run headlessly yet — missing selectors: ${selectorReport.missing.join(', ')}. ` +
          'A human needs to verify these once (see agent/README.md: "Capturing new selectors").'
      );
      return EXIT_CODES.NEEDS_HUMAN;
    }

    // Stage 4: runner (loop over environments, with retry-on-infra-failure only)
    const envsToRun: Environment[] = args.envFilter ? [args.envFilter] : ['sandbox', 'qa'];
    let round = 1;
    let verdicts: Verdict[] = [];

    while (round <= config.maxRounds) {
      verdicts = [];
      for (const env of envsToRun) {
        const storageStatePath = `./agent/storageState.${env}.json`;
        const verdict = await runRunnerStage(ticketId, plan.featurePath, env, storageStatePath, workDir);
        verdicts.push(verdict);
      }

      const anyFailed = verdicts.some((v) => v.failed > 0);
      if (!anyFailed) break;

      // We deliberately do NOT auto-classify failures as infra vs.
      // product-behavior and do NOT auto-retry past round 1 without a
      // human decision — see runner.ts's comment on why. This loop exists
      // for genuinely transient infra hiccups only, and stops immediately
      // otherwise.
      log('cli', `Round ${round} had failures. Stopping loop — see runner.ts for why this isn't auto-retried.`);
      break;
    }

    // Stage 5: report
    const summary = runReportStage(ticketId, round, verdicts, workDir);

    // Stage 6: report back to Linear
    await runLinearReporterStage(config.linearApiKey, ticket.id, summary);

    if (summary.overallStatus === 'verified') return EXIT_CODES.VERIFIED;
    if (summary.overallStatus === 'product-bug-found') return EXIT_CODES.PRODUCT_BUG_FOUND;
    return EXIT_CODES.NEEDS_HUMAN;
  } catch (err) {
    logError('cli', (err as Error).message);
    return EXIT_CODES.ERROR;
  }
}

function printHelp(): void {
  console.log(`bw-qa-loop — autonomous Linear ticket -> Gherkin -> execution -> report loop

Usage:
  bw-qa-loop <TICKET-ID>                 Full ride (stops at the plan gate by default)
  bw-qa-loop <TICKET-ID> --dry-run       Draft scenarios only, no execution, no Linear write
  bw-qa-loop <TICKET-ID> --skip-plan-gate  Proceed past the human plan-review gate
  bw-qa-loop <TICKET-ID> --env=sandbox   Run against one environment only
  bw-qa-loop doctor                      Check Docker, env vars, and storageState files

Exit codes: 0 verified · 1 needs-human · 2 error · 3 product-bug-found`);
}

main().then((code) => process.exit(code));
