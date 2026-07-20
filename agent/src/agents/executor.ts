import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadRegistry, findMissingKeys } from '../lib/selectorRegistry.js';
import { log } from '../lib/logger.js';
import type { Environment, ScenarioResult, SelectorReport, Verdict } from '../types.js';

const execFileAsync = promisify(execFile);

const ENV_URLS: Record<Environment, string> = {
  sandbox: process.env.SANDBOX_URL ?? 'https://schools.sandbox.bwtest.net',
  qa: process.env.QA_URL ?? 'https://schools.qa.bwtest.net',
};

/** Merged selectorAgent + runner.
 *
 * Validates all selectors referenced in the feature file are in the
 * registry, then executes Playwright against each environment.
 *
 * Selector validation failure stops the run and returns needs-human —
 * we still can't autonomously discover selectors (see the comment in the
 * original selectorAgent.ts). That constraint is unchanged. */
export async function runExecutorAgent(
  ticket: string,
  featurePath: string,
  environments: Environment[],
  workDir: string
): Promise<{ selectorReport: SelectorReport; verdicts: Verdict[] }> {
  log('executor', `Starting execution for ${ticket}...`);

  // Phase 1: selector validation
  const selectorReport = validateSelectors(ticket, featurePath);
  if (selectorReport.status === 'needs-human') {
    log(
      'executor',
      `Blocked on selectors: ${selectorReport.missing.join(', ')}. ` +
        `A human must verify these via a real browser session before this ticket can run headlessly.`
    );
    return { selectorReport, verdicts: [] };
  }
  log('executor', `Selectors OK — ${extractSelectorKeys(readFileSync(featurePath, 'utf-8')).length} known selector(s).`);

  // Phase 2: run against each environment
  const verdicts: Verdict[] = [];
  for (const env of environments) {
    const storageStatePath = `./agent/storageState.${env}.json`;
    const verdict = await runEnvironment(ticket, featurePath, env, storageStatePath, workDir);
    verdicts.push(verdict);
  }

  return { selectorReport, verdicts };
}

function validateSelectors(ticket: string, featurePath: string): SelectorReport {
  const featureContent = readFileSync(featurePath, 'utf-8');
  const requiredKeys = extractSelectorKeys(featureContent);
  const registry = loadRegistry();
  const missing = findMissingKeys(registry, requiredKeys);

  if (missing.length > 0) {
    return { ticket, status: 'needs-human', missing };
  }
  return { ticket, status: 'known', missing: [] };
}

function extractSelectorKeys(featureContent: string): string[] {
  const matches = featureContent.matchAll(/#\s*selector:\s*([\w.]+)/g);
  return [...matches].map((m) => m[1]);
}

async function runEnvironment(
  ticket: string,
  featurePath: string,
  environment: Environment,
  storageStatePath: string,
  workDir: string
): Promise<Verdict> {
  const baseUrl = ENV_URLS[environment];
  log('executor', `Running against ${environment} (${baseUrl})...`);

  const repoRoot = new URL('../../../', import.meta.url).pathname;
  const reportJsonPath = `${workDir}/${ticket.toLowerCase()}.${environment}.playwright-report.json`;

  const env = {
    ...process.env,
    BASE_URL: baseUrl,
    ...(existsSync(storageStatePath) ? { STORAGE_STATE: storageStatePath } : {}),
  };

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      'npx',
      ['playwright', 'test', featurePath, '--reporter=json'],
      { cwd: repoRoot, env, maxBuffer: 1024 * 1024 * 20 }
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    stdout = execErr.stdout ?? '';
    stderr = execErr.stderr ?? '';
    exitCode = execErr.code ?? 1;
  }

  writeFileSync(reportJsonPath, stdout, 'utf-8');
  if (stderr) {
    log('executor', `stderr (${environment}): ${stderr.slice(0, 500)}`);
  }

  const results = parsePlaywrightJson(stdout);
  const verdict: Verdict = {
    ticket,
    environment,
    ranAt: new Date().toISOString(),
    results,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };

  const verdictPath = `${workDir}/${ticket.toLowerCase()}.${environment}.verdict.json`;
  writeFileSync(verdictPath, JSON.stringify(verdict, null, 2) + '\n', 'utf-8');

  log(
    'executor',
    `${environment}: ${verdict.passed} passed, ${verdict.failed} failed, ${verdict.skipped} skipped (exit ${exitCode})`
  );

  return verdict;
}

function parsePlaywrightJson(raw: string): ScenarioResult[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const results: ScenarioResult[] = [];
    for (const suite of parsed.suites ?? []) {
      collectSpecs(suite, results);
    }
    return results;
  } catch {
    return [];
  }
}

function collectSpecs(suite: any, out: ScenarioResult[]): void {
  for (const spec of suite.specs ?? []) {
    const test = spec.tests?.[0];
    const result = test?.results?.[0];
    const status = result?.status === 'passed' ? 'passed' : result?.status === 'skipped' ? 'skipped' : 'failed';
    out.push({
      name: spec.title,
      tags: (spec.title.match(/@\w+/g) ?? []) as string[],
      status,
      message: result?.error?.message,
    });
  }
  for (const child of suite.suites ?? []) {
    collectSpecs(child, out);
  }
}
