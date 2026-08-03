import { readFileSync, writeFileSync } from 'node:fs';
import { callClaude } from '../lib/anthropic.js';
import { loadRegistry } from '../lib/selectorRegistry.js';
import { log } from '../lib/logger.js';
import type { RequirementsDoc, ScenarioPlan } from '../types.js';

/** Reads from requirements.md — not directly from the ticket. By design
 * the test planner only sees the consolidated, uncertainty-flagged doc
 * produced by the requirements-reviewer, never the raw ticket noise.
 *
 * This does PARTIAL PLANNING: it scripts every requirement that is clear
 * enough to test and records the uncertain/contradictory ones as open
 * questions, rather than refusing to plan at all. The "don't fake
 * verification" principle is preserved at the scenario level (uncertain
 * behavior is never scripted); only the all-or-nothing block is removed. */
const SYSTEM_PROMPT = `You are a QA test planner. You write Gherkin scenarios and a
test plan from a consolidated requirements document produced by the
requirements-reviewer agent.

This is PARTIAL PLANNING. Generate scenarios for every requirement that is clear
enough to test, and record anything you cannot responsibly script as an open
question. Do NOT refuse the whole plan just because some items are uncertain.

Hard rules:
- Every scenario must trace to a numbered requirement section in the document.
  Cite it as a comment: "# requirement: §<section-number>"
- Do NOT write scenarios for anything marked UNCERTAIN, or for behavior that two
  sources contradict. Record each such item under OPEN_QUESTIONS (one line, with
  the reason) instead of guessing.
- Assign every scenario exactly ONE priority tag: @p0 (critical happy path /
  core flow), @p1 (important functionality, common error/validation states), or
  @p2 (edge cases, cosmetic). Cover all clear P0 and P1 behavior; only add P2
  where the requirement is well specified.
- Also tag a tier: @smoke (is the build usable), @sanity (does the feature work
  at a basic level), @functional (full validation), plus domain tags like
  @billing where appropriate.
- If a step depends on a known UI selector from the registry list provided,
  annotate it: "# selector: <key>"
- Output format is strict — follow it exactly:

FEATURE:
<gherkin feature file content>

TEST_PLAN:
<markdown table: ID | Priority | Severity | Tier | Scenario | Requirement Section | Notes>

OPEN_QUESTIONS:
<bullet list of UNCERTAIN/contradictory items you did NOT script, each with a reason, or "none">`;

/** Models often wrap their output in a ```lang … ``` markdown fence. Written
 * verbatim, that fence makes a .feature file unparseable by playwright-bdd.
 * If the text is fenced, return only the content inside the first fence
 * (dropping any stray prose/separators before or after); otherwise return
 * it unchanged. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)\n```/);
  return (fenced ? fenced[1] : text).trim();
}

export async function runTestPlannerAgent(
  requirementsDoc: RequirementsDoc,
  workDir: string
): Promise<ScenarioPlan> {
  log('test-planner', `Planning tests for ${requirementsDoc.ticket}...`);
  if (requirementsDoc.uncertainSections.length > 0) {
    log(
      'test-planner',
      `Partial planning: ${requirementsDoc.uncertainSections.length} UNCERTAIN item(s) will be recorded ` +
        `as open questions and left unscripted; the clear requirements will still be planned.`
    );
  }

  // Read the written requirements.md artifact
  const requirementsContent = readFileSync(requirementsDoc.requirementsPath, 'utf-8');

  const registry = loadRegistry();
  const knownSelectors = Object.entries(registry)
    .map(([key, entry]) => `- ${key}: ${entry.role} "${entry.name}" (${entry.description})`)
    .join('\n');

  const uncertainList =
    requirementsDoc.uncertainSections.length > 0
      ? requirementsDoc.uncertainSections.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : '(none)';

  const userPrompt = `Requirements Document:
${requirementsContent}

Items flagged UNCERTAIN or contradictory — DO NOT script these; record them under
OPEN_QUESTIONS with the reason. Still plan everything else:
${uncertainList}

Known selectors available for reuse:
${knownSelectors || '(none registered yet)'}`;

  const response = await callClaude(SYSTEM_PROMPT, userPrompt);

  const featureMatch = response.match(/FEATURE:\s*([\s\S]*?)\s*TEST_PLAN:/);
  const planMatch = response.match(/TEST_PLAN:\s*([\s\S]*?)\s*OPEN_QUESTIONS:/);
  const questionsMatch = response.match(/OPEN_QUESTIONS:\s*([\s\S]*)$/);

  const featureContent = stripCodeFence(featureMatch?.[1]?.trim() ?? '');
  const planContent = stripCodeFence(planMatch?.[1]?.trim() ?? '');
  const questionsText = questionsMatch?.[1]?.trim() ?? '';

  const openQuestions =
    questionsText.toLowerCase() === 'none'
      ? []
      : questionsText
          .split('\n')
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);

  const slug = requirementsDoc.ticket.toLowerCase();
  const featurePath = `${workDir}/${slug}.feature`;
  const planPath = `${workDir}/${slug}.md`;

  if (!featureContent) {
    log('test-planner', 'Model output did not match expected format — flagging needsHuman.');
    return {
      ticket: requirementsDoc.ticket,
      featurePath,
      planPath,
      scenarioCount: 0,
      needsHuman: true,
      openQuestions: ['Test planner could not produce a parseable feature file — check the raw model output.'],
    };
  }

  writeFileSync(featurePath, featureContent + '\n', 'utf-8');
  writeFileSync(planPath, planContent + '\n', 'utf-8');

  const scenarioCount = (featureContent.match(/^\s*Scenario:/gm) ?? []).length;
  // Only truly needs a human if NOTHING could be planned. Open questions
  // alongside real scenarios are a partial plan, not a block.
  const needsHuman = scenarioCount === 0;

  log(
    'test-planner',
    `Wrote ${scenarioCount} scenario(s)` +
      (openQuestions.length > 0 ? `; ${openQuestions.length} open question(s) recorded (unscripted).` : '.')
  );

  return {
    ticket: requirementsDoc.ticket,
    featurePath,
    planPath,
    scenarioCount,
    needsHuman,
    openQuestions,
  };
}
