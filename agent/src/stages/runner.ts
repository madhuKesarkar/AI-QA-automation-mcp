import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { log } from '../lib/logger.js';
import type { Environment, ScenarioResult, Verdict } from '../types.js';

const execFileAsync = promisify(execFile);

const ENV_URLS: Record<Environment, string> = {
  sandbox: process.env.SANDBOX_URL ?? 'https://schools.sandbox.bwtest.net',
  qa: process.env.QA_URL ?? 'https://schools.qa.bwtest.net',
};

/** Runs the generated .feature file against one environment using the
 * existing Playwright + playwright-bdd setup in the repo root (../tests).
 * This stage does NOT try to distinguish infra failure from product-bug
 * failure itself — that classification is deliberately left to a human
 * reviewing the report, because an automated "is this really a bug"
 * judgment is exactly the kind of false-confidence risk this whole
 * project exists to avoid. The orchestrator only auto-retries failures
 * explicitly marked 'infra' by a human via the --retry-infra flag on a
 * previous run; everything else stops the loop. */
export async function runRunnerStage(
  ticket: string,
  featurePath: string,
  environment: Environment,
  storageStatePath: string | undefined,
  workDir: string
): Promise<Verdict> {
  const baseUrl = ENV_URLS[environment];
  log('runner', `Running ${featurePath} against ${environment} (${baseUrl})...`);

  const repoRoot = new URL('../../../', import.meta.url).pathname;
  const reportJsonPath = `${workDir}/${ticket.toLowerCase()}.${environment}.playwright-report.json`;

  const env = {
    ...process.env,
    BASE_URL: baseUrl,
    ...(storageStatePath && existsSync(storageStatePath) ? { STORAGE_STATE: storageStatePath } : {}),
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
    log('runner', `stderr (may be benign deprecation warnings): ${stderr.slice(0, 500)}`);
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
    'runner',
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

// Playwright's JSON reporter nests suites recursively; specs live at
// whatever depth matches the describe/feature structure.
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
