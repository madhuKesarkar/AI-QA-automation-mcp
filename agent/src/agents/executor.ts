import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { log } from '../lib/logger.js';
import { UNIMPLEMENTED_STEP_MARKER } from '../types.js';
import type {
  Environment,
  ExecutionStatus,
  ScenarioResult,
  SelectorReport,
  Verdict,
} from '../types.js';

const execFileAsync = promisify(execFile);

const ENV_URLS: Record<Environment, string> = {
  sandbox: process.env.SANDBOX_URL ?? 'https://schools.sandbox.bwtest.net',
  qa: process.env.QA_URL ?? 'https://schools.qa.bwtest.net',
};

/** Selector validation + Playwright execution in one agent.
 *
 * Validates all selectors referenced in the feature file are in the
 * registry, then executes Playwright against each environment.
 *
 * Selector validation failure stops the run and returns needs-human — this
 * agent cannot autonomously discover a selector for UI it has never seen;
 * that requires a human-driven browser session (see agent/README.md,
 * "Capturing new selectors"). */
export async function runExecutorAgent(
  ticket: string,
  featurePath: string,
  environments: Environment[],
  workDir: string
): Promise<{ selectorReport: SelectorReport; verdicts: Verdict[] }> {
  log('executor', `Starting execution for ${ticket}...`);

  const repoRoot = new URL('../../../', import.meta.url).pathname;

  // Phase 1: selector validation, derived from the GENERATED step definitions.
  const selectorReport = validateSelectors(ticket, repoRoot);
  if (selectorReport.status === 'needs-human') {
    log(
      'executor',
      `Blocked on selectors: ${selectorReport.missing.join('; ')}. ` +
        `A human must verify these via a real browser session before this ticket can run headlessly.`
    );
    return { selectorReport, verdicts: [] };
  }
  log('executor', 'Selectors OK — every generated step definition resolves to a registry-verified locator.');

  // Phase 2: compile Gherkin to Playwright specs. playwright-bdd cannot
  // consume a .feature file directly — bddgen transpiles it into
  // <outputDir>/<feature-path>.spec.js, and that generated spec is what
  // `playwright test` runs. bddgen is also where undefined step definitions
  // surface, so a failure here means the glue code is missing.
  //
  // Generated plans use their own Playwright config so that a plan with
  // missing steps cannot break the curated suite's bddgen run (and therefore
  // CI) — see playwright.generated.config.ts.
  const gen = await runBddGen(repoRoot, featurePath);
  if (!gen.ok) {
    log('executor', `bddgen failed — cannot execute. ${gen.diagnostic}`);
    return {
      selectorReport,
      verdicts: environments.map((env) =>
        emptyVerdict(ticket, env, 'error', gen.diagnostic)
      ),
    };
  }

  // The generated spec must exist, or the feature is not covered by the
  // `features` globs in playwright.config.ts and would silently match no
  // tests.
  const specPath = generatedSpecPath(featurePath);
  if (!existsSync(`${repoRoot}${specPath}`)) {
    const diagnostic =
      `bddgen produced no spec for ${featurePath} (expected ${specPath}). ` +
      `The feature is probably outside the 'features' glob in ${GENERATED_CONFIG}.`;
    log('executor', diagnostic);
    return {
      selectorReport,
      verdicts: environments.map((env) => emptyVerdict(ticket, env, 'error', diagnostic)),
    };
  }

  // Phase 3: run against each environment
  const verdicts: Verdict[] = [];
  for (const env of environments) {
    const storageStatePath = `./agent/storageState.${env}.json`;
    const verdict = await runEnvironment(
      ticket,
      specPath,
      featurePath,
      env,
      storageStatePath,
      workDir,
      repoRoot
    );
    verdicts.push(verdict);
  }

  return { selectorReport, verdicts };
}

/** Playwright config that owns agent-generated plans (see the comment in
 * that file for why it is separate from playwright.config.ts). */
const GENERATED_CONFIG = 'playwright.generated.config.ts';

/** outputDir configured in GENERATED_CONFIG — kept in sync manually; the
 * existsSync check in runExecutorAgent fails loudly if these diverge. */
const GENERATED_OUTPUT_DIR = '.features-gen-generated';

/** Maps a .feature path to the spec playwright-bdd generates for it.
 * e.g. project-envs/FINOPS-445/finops-445.feature
 *   →  .features-gen-generated/project-envs/FINOPS-445/finops-445.feature.spec.js */
function generatedSpecPath(featurePath: string): string {
  const relative = featurePath.replace(/^\.\//, '');
  return `${GENERATED_OUTPUT_DIR}/${relative}.spec.js`;
}

async function runBddGen(
  repoRoot: string,
  featurePath: string
): Promise<{ ok: boolean; diagnostic: string }> {
  try {
    await execFileAsync('npx', ['bddgen', '--config', GENERATED_CONFIG], {
      cwd: repoRoot,
      // Compile only this ticket's feature — see GENERATED_FEATURES in
      // playwright.generated.config.ts.
      env: { ...process.env, GENERATED_FEATURES: featurePath.replace(/^\.\//, '') },
      maxBuffer: 1024 * 1024 * 20,
    });
    return { ok: true, diagnostic: '' };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string };
    const output = `${execErr.stderr ?? ''}${execErr.stdout ?? ''}`.trim();
    return { ok: false, diagnostic: output.slice(0, 1000) || 'bddgen exited non-zero with no output' };
  }
}

function emptyVerdict(
  ticket: string,
  environment: Environment,
  executionStatus: ExecutionStatus,
  diagnostic: string
): Verdict {
  return {
    ticket,
    environment,
    ranAt: new Date().toISOString(),
    executionStatus,
    diagnostic,
    results: [],
    passed: 0,
    failed: 0,
    skipped: 0,
  };
}

/** The selector gate, derived from the GENERATED step definitions rather than
 * planner-emitted `# selector:` comments.
 *
 * The old gate parsed `# selector:` hints out of the .feature and checked them
 * against the registry — the FINOPS-445 plan declared 5 keys, all present, so
 * it waved 83 scenarios through as "Selectors OK" (FINOPS-761). Those comments
 * are the planner's guess at what a scenario needs; they are not what runs.
 *
 * The step-generator, by contrast, either resolves a step to a registry-
 * verified locator or emits `throw new Error('UNIMPLEMENTED_STEP: needs
 * verified selector for <element>')` rather than guess one. So the steps file
 * that will actually execute carries an honest record of every unresolved
 * selector, and the gate blocks on exactly those — which is what makes it block
 * on a scenario whose UI is not in the registry. */
function validateSelectors(ticket: string, repoRoot: string): SelectorReport {
  const stepsPath = `tests/steps/${ticket.toLowerCase()}.steps.ts`;
  const absoluteStepsPath = `${repoRoot}${stepsPath}`;

  if (!existsSync(absoluteStepsPath)) {
    return {
      ticket,
      status: 'needs-human',
      missing: [
        `no generated step definitions at ${stepsPath} — the plan has no glue to run ` +
          `(step generation was skipped or produced nothing to execute)`,
      ],
    };
  }

  const unresolved = extractUnresolvedSelectors(readFileSync(absoluteStepsPath, 'utf-8'));
  if (unresolved.length > 0) {
    return { ticket, status: 'needs-human', missing: unresolved };
  }
  return { ticket, status: 'known', missing: [] };
}

/** The unresolved-selector descriptions carried by the step definitions'
 * UNIMPLEMENTED_STEP throws, de-duplicated. */
function extractUnresolvedSelectors(stepsSource: string): string[] {
  const pattern = new RegExp(
    `${UNIMPLEMENTED_STEP_MARKER}:\\s*needs verified selector for ([^'"\\n]+)`,
    'g'
  );
  const descriptions = [...stepsSource.matchAll(pattern)].map((m) => m[1].trim());
  return [...new Set(descriptions)];
}

async function runEnvironment(
  ticket: string,
  specPath: string,
  featurePath: string,
  environment: Environment,
  storageStatePath: string,
  workDir: string,
  repoRoot: string
): Promise<Verdict> {
  const baseUrl = ENV_URLS[environment];
  log('executor', `Running against ${environment} (${baseUrl})...`);

  const reportJsonPath = `${workDir}/${ticket.toLowerCase()}.${environment}.playwright-report.json`;

  const env = {
    ...process.env,
    BASE_URL: baseUrl,
    // Keep the config's feature glob identical to the one bddgen just compiled
    // with, so Playwright resolves the same testDir.
    GENERATED_FEATURES: featurePath.replace(/^\.\//, ''),
    ...(existsSync(storageStatePath) ? { STORAGE_STATE: storageStatePath } : {}),
  };

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      'npx',
      ['playwright', 'test', '--config', GENERATED_CONFIG, specPath, '--reporter=json'],
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

  // Zero results is never a pass. Either Playwright matched no scenarios or
  // it crashed before reporting — both must reach the reporter as an
  // explicit non-run, not as "0 failed".
  let executionStatus: ExecutionStatus = 'ran';
  let diagnostic: string | undefined;
  if (results.length === 0) {
    const noTests = !stdout.trim() || /no tests found/i.test(stdout + stderr);
    executionStatus = noTests && exitCode !== 0 ? 'error' : 'no-tests';
    diagnostic =
      `Playwright reported no scenario results for ${specPath} (exit ${exitCode}). ` +
      (stderr.trim() ? `stderr: ${stderr.trim().slice(0, 500)}` : 'no stderr output.');
  }

  const verdict: Verdict = {
    ticket,
    environment,
    ranAt: new Date().toISOString(),
    executionStatus,
    diagnostic,
    results,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };

  const verdictPath = `${workDir}/${ticket.toLowerCase()}.${environment}.verdict.json`;
  writeFileSync(verdictPath, JSON.stringify(verdict, null, 2) + '\n', 'utf-8');

  if (executionStatus === 'ran') {
    log(
      'executor',
      `${environment}: ${verdict.passed} passed, ${verdict.failed} failed, ${verdict.skipped} skipped (exit ${exitCode})`
    );
  } else {
    log('executor', `${environment}: NOTHING RAN [${executionStatus}] — ${diagnostic}`);
  }

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
