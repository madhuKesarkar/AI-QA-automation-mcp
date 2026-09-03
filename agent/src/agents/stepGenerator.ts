import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { callClaude } from '../lib/anthropic.js';
import { loadRegistry } from '../lib/selectorRegistry.js';
import { log } from '../lib/logger.js';
import { UNIMPLEMENTED_STEP_MARKER as UNIMPLEMENTED } from '../types.js';
import type { StepGenerationResult } from '../types.js';

const execFileAsync = promisify(execFile);

const GENERATED_CONFIG = 'playwright.generated.config.ts';

/** How many missing-step stubs to send per Claude call. The full FINOPS-445
 * plan needs 230 step definitions; asking for all of them in one response
 * truncates against max_tokens and produces an unparseable file. */
const BATCH_SIZE = 40;

/** Bounded repair rounds when the generated file still leaves steps undefined.
 * Each round can only fix the stubs bddgen actually prints (see
 * PRINTED_STUB_LIMIT), so this is a residue-cleanup budget, not the main
 * generation path. */
const MAX_REPAIR_ROUNDS = 5;

/** bddgen prints only the first ~10 missing-step stubs and then "...and N
 * more." — so its output can NEVER be used as the list of work to do. It is
 * used two ways instead: a few stubs as format exemplars (they show the exact
 * Cucumber expression and parameter types playwright-bdd expects), and the
 * reported count as the authority on whether generation succeeded. */
const PRINTED_STUB_LIMIT = 10;

interface FeatureStep {
  keyword: 'Given' | 'When' | 'Then'; // And/But resolved to the preceding keyword
  text: string; // normalized: quoted literals → {string}, bare numbers → {int}
  example: string; // one real Gherkin line, for context
}

/** What bddgen tells us about undefined steps: the authoritative count, and
 * the handful of stub blocks it actually printed. */
interface MissingSteps {
  count: number;
  stubs: string[];
}

// UNIMPLEMENTED (imported as UNIMPLEMENTED_STEP_MARKER) marks a step the agent
// refused to implement because it would have required guessing a locator for UI
// not in the selector registry. Thrown rather than skipped: an unimplemented
// step must never report as a pass. The selector gate (executor.ts) treats
// these throws as the plan's unresolved selectors; the bug-analyser classifies
// them as test-issues.

const SYSTEM_PROMPT = `You write Playwright step definitions for playwright-bdd, in TypeScript.

You are given a list of Gherkin steps to implement, a few stub definitions
bddgen emitted (as exemplars of the exact format playwright-bdd expects), and
the registry of selectors that have been HUMAN-VERIFIED against the live
accessibility tree.

The single hard rule: NEVER invent a locator. If implementing a step needs an
element that is not in the verified selector registry, do not guess a role,
name, text, or test-id. Emit the step with exactly this body instead:

  throw new Error('${UNIMPLEMENTED}: needs verified selector for <short description of the element>');

That is a correct, honest outcome — a human captures the selector later. A
guessed locator that happens to pass is the worst possible result, because it
reports fake QA coverage.

For steps you CAN implement from the registry (or that need no locator at all,
e.g. navigation to a known path, or an assertion on a URL):
- Use the registry entry's role and name: page.getByRole('<role>', { name: '<name>' })
- Use await expect(...) from @playwright/test for Then steps
- Keep bodies short and literal; no helper abstractions, no comments explaining
  Playwright basics

Signatures:
- Use the step text EXACTLY as given, including its {string}/{int}/{float}
  parameters — that expression is what bddgen matches against.
- Every definition takes { page } as its first argument, then one typed
  parameter per {…} in the expression, in order:
  When('I upload {string}', async ({ page }, fileName: string) => { … });

Output rules — followed exactly:
- Output ONLY TypeScript step definitions. No imports, no createBdd() call, no
  markdown fences, no commentary before or after. Those are added around your
  output.
- Every step given to you must appear exactly once in your output.
- Start each body with a "// Step: <the step text>" comment, so the Gherkin
  source of each definition stays traceable.`;

/** Generates the step-definition glue for a ticket's generated .feature.
 *
 * playwright-bdd will not compile a feature whose steps are undefined, so
 * without this agent a generated plan can never execute. This runs after the
 * test-planner and before the plan gate, so the human reviewing the plan
 * reviews the glue (and the list of selectors still needed) along with it. */
export async function runStepGeneratorAgent(
  ticket: string,
  featurePath: string,
  repoRoot: string
): Promise<StepGenerationResult> {
  log('step-generator', `Generating step definitions for ${ticket}...`);

  const slug = ticket.toLowerCase();
  const stepsPath = `tests/steps/${slug}.steps.ts`;
  const absoluteStepsPath = `${repoRoot}${stepsPath}`;

  const probe = await collectMissingSteps(repoRoot, featurePath);
  if (probe.count === 0) {
    log('step-generator', 'bddgen reports no missing step definitions — nothing to generate.');
    return {
      ticket,
      stepsPath: existsSync(absoluteStepsPath) ? stepsPath : '',
      totalSteps: 0,
      implementedSteps: 0,
      unimplementedSteps: 0,
      missingStepsAfter: 0,
      status: 'complete',
    };
  }

  const featureContent = readFileSync(`${repoRoot}${stripLeadingDot(featurePath)}`, 'utf-8');
  const knownSelectors = renderRegistry();

  // The work list comes from parsing the feature, NOT from bddgen's output.
  const steps = collectFeatureSteps(featureContent);
  log(
    'step-generator',
    `bddgen reports ${probe.count} missing definition(s); parsed ${steps.length} unique step(s) from the ` +
      `feature. Generating in batches of ${BATCH_SIZE}.`
  );

  const batches = chunk(steps, BATCH_SIZE);
  const bodies: string[] = [];
  for (const [index, batch] of batches.entries()) {
    log('step-generator', `Batch ${index + 1}/${batches.length} (${batch.length} step(s))...`);
    bodies.push(
      await generateBatch(renderStepList(batch), probe.stubs, featureContent, knownSelectors)
    );
  }

  writeFileSync(absoluteStepsPath, renderStepsFile(ticket, bodies), 'utf-8');
  log('step-generator', `Wrote ${stepsPath}`);

  // Validate against bddgen itself: the only definition of "these steps are
  // complete" that matters is that playwright-bdd can compile the feature.
  // Each repair round can only address the stubs bddgen prints, so this
  // converges on a small residue rather than doing bulk work.
  let remaining = await collectMissingSteps(repoRoot, featurePath);
  for (let round = 1; round <= MAX_REPAIR_ROUNDS && remaining.count > 0; round++) {
    log(
      'step-generator',
      `Still ${remaining.count} missing after generation — repair round ${round}/${MAX_REPAIR_ROUNDS} ` +
        `(fixing the ${remaining.stubs.length} stub(s) bddgen printed).`
    );
    bodies.push(
      await generateBatch(remaining.stubs.join('\n\n'), remaining.stubs, featureContent, knownSelectors)
    );
    writeFileSync(absoluteStepsPath, renderStepsFile(ticket, bodies), 'utf-8');
    const next = await collectMissingSteps(repoRoot, featurePath);
    if (next.count === remaining.count) {
      log('step-generator', `Repair made no progress (${next.count} still missing) — stopping.`);
      remaining = next;
      break;
    }
    remaining = next;
  }

  const written = readFileSync(absoluteStepsPath, 'utf-8');
  const totalSteps = countDefinitions(written);
  const unimplementedSteps = (written.match(new RegExp(UNIMPLEMENTED, 'g')) ?? []).length;
  const implementedSteps = totalSteps - unimplementedSteps;

  const status: StepGenerationResult['status'] =
    remaining.count > 0 ? 'failed' : unimplementedSteps > 0 ? 'partial' : 'complete';

  log(
    'step-generator',
    `${totalSteps} definition(s): ${implementedSteps} implemented, ${unimplementedSteps} blocked on ` +
      `unverified selectors, ${remaining.count} still undefined. Status: ${status}.`
  );

  return {
    ticket,
    stepsPath,
    totalSteps,
    implementedSteps,
    unimplementedSteps,
    missingStepsAfter: remaining.count,
    status,
  };
}

/** Runs bddgen and reports what is still undefined.
 *
 * Scoped to one feature via GENERATED_FEATURES so that another ticket's
 * unglued plan sitting in project-envs/ cannot inflate this count and block
 * this ticket (same blast-radius reasoning as the separate config).
 *
 * The printed stubs are valuable for one narrow reason: they carry the exact
 * Cucumber expression and parameter types playwright-bdd expects, so the model
 * never has to infer a signature from Gherkin prose. The count is what decides
 * success; the stubs are only format exemplars. */
async function collectMissingSteps(repoRoot: string, featurePath: string): Promise<MissingSteps> {
  let output = '';
  try {
    const result = await execFileAsync('npx', ['bddgen', '--config', GENERATED_CONFIG], {
      cwd: repoRoot,
      env: { ...process.env, GENERATED_FEATURES: stripLeadingDot(featurePath) },
      maxBuffer: 1024 * 1024 * 20,
    });
    output = `${result.stdout}${result.stderr}`;
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string };
    output = `${execErr.stdout ?? ''}${execErr.stderr ?? ''}`;
  }

  if (!/Missing step definitions/i.test(output)) return { count: 0, stubs: [] };

  // Each stub is a block starting at Given(/When(/Then( and ending at "});"
  const blocks = output.match(/^(?:Given|When|Then)\([\s\S]*?^\}\);$/gm) ?? [];

  // bddgen prints "Missing step definitions: N" — trust that over the number
  // of blocks it chose to print.
  const reported = output.match(/Missing step definitions:\s*(\d+)/i);
  const count = reported ? Number(reported[1]) : blocks.length;

  return { count, stubs: blocks.slice(0, PRINTED_STUB_LIMIT) };
}

/** Every distinct step in the feature, in first-appearance order.
 *
 * Deduplicated by normalized text alone, not by text+keyword: Cucumber (and
 * therefore playwright-bdd) matches steps without regard to Given/When/Then,
 * so emitting the same expression under two keywords is a duplicate-definition
 * error, not two definitions. */
function collectFeatureSteps(featureContent: string): FeatureStep[] {
  const byText = new Map<string, FeatureStep>();
  let lastKeyword: FeatureStep['keyword'] = 'Given';

  for (const rawLine of featureContent.split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^(Given|When|Then|And|But|\*)\s+(.*)$/);
    if (!match) continue;

    const [, keywordToken, stepText] = match;
    // And/But/* continue whatever the previous real keyword was.
    if (keywordToken === 'Given' || keywordToken === 'When' || keywordToken === 'Then') {
      lastKeyword = keywordToken;
    }

    const text = normalizeStepText(stepText);
    if (byText.has(text)) continue;
    byText.set(text, { keyword: lastKeyword, text, example: `${keywordToken} ${stepText}` });
  }

  return [...byText.values()];
}

/** Turns a concrete Gherkin step into the Cucumber expression a definition
 * matches on: literals become typed parameters, so "I upload "rates.csv"" and
 * "I upload "bad.csv"" are one definition rather than two. Scenario Outline
 * placeholders (<count>) become parameters for the same reason. */
function normalizeStepText(stepText: string): string {
  return stepText
    .replace(/"[^"]*"/g, '{string}')
    .replace(/<[^>]+>/g, '{string}')
    .replace(/(?<![\w{])\d+(?:\.\d+)?(?![\w}])/g, (n) => (n.includes('.') ? '{float}' : '{int}'))
    .trim();
}

function renderStepList(steps: FeatureStep[]): string {
  return steps
    .map((step, index) => `${index + 1}. ${step.keyword} ${step.text}\n   (as written: ${step.example})`)
    .join('\n');
}

async function generateBatch(
  stepList: string,
  exemplarStubs: string[],
  featureContent: string,
  knownSelectors: string
): Promise<string> {
  const exemplars =
    exemplarStubs.length > 0
      ? `Stub definitions bddgen emitted, as FORMAT EXEMPLARS only — copy this shape,
do not limit yourself to these steps:

${exemplarStubs.join('\n\n')}
`
      : '';

  const userPrompt = `Verified selector registry (the ONLY locators you may use):
${knownSelectors}

The feature file these steps belong to, for context on what each step means:
${featureContent}

${exemplars}
Implement a step definition for every step in this list. Anything needing an
element outside the registry above gets the ${UNIMPLEMENTED} throw — do not guess:

${stepList}`;

  return stripCodeFence(await callClaude(SYSTEM_PROMPT, userPrompt));
}

function renderRegistry(): string {
  const registry = loadRegistry();
  const entries = Object.entries(registry);
  if (entries.length === 0) return '(registry is empty — every step needing a locator must use the throw)';
  return entries
    .map(
      ([key, entry]) =>
        `- ${key}: role="${entry.role}" name="${entry.name}" — ${entry.description} ` +
        `(verified against ${entry.verifiedAgainst} on ${entry.verifiedAt})`
    )
    .join('\n');
}

function renderStepsFile(ticket: string, bodies: string[]): string {
  return `import { createBdd } from 'playwright-bdd';
import { expect } from '@playwright/test';

// GENERATED by the step-generator agent for ${ticket}. Reviewed by a human as
// part of the plan-approval PR — see FINOPS-761.
//
// Locators here come only from agent/selector-registry.json, whose entries were
// verified against a live accessibility tree. Steps that would have needed an
// unverified locator throw ${UNIMPLEMENTED} instead of guessing: they fail
// loudly rather than reporting fake coverage. To implement one, capture the
// selector (see agent/README.md, "Capturing new selectors"), add it to the
// registry, and replace the throw.

const { Given, When, Then } = createBdd();

${bodies.join('\n\n')}
`;
}

/** Models often wrap output in a ```lang … ``` fence; written verbatim that
 * makes the .ts file unparseable. Mirrors the same helper in testPlanner. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)\n```/);
  return (fenced ? fenced[1] : text).trim();
}

function countDefinitions(source: string): number {
  return (source.match(/^(?:Given|When|Then)\(/gm) ?? []).length;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function stripLeadingDot(path: string): string {
  return path.replace(/^\.\//, '');
}
