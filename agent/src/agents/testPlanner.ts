import { readFileSync, writeFileSync } from 'node:fs';
import { callClaude } from '../lib/anthropic.js';
import { loadRegistry } from '../lib/selectorRegistry.js';
import { log } from '../lib/logger.js';
import type { RequirementsDoc, ScenarioPlan } from '../types.js';

/** Reads from requirements.md — not directly from the ticket. By design
 * the test planner only sees the consolidated, uncertainty-flagged doc
 * produced by the requirements-reviewer, never the raw ticket noise. */
const SYSTEM_PROMPT = `You are a QA test planner. You write Gherkin scenarios and
test plans from a consolidated requirements document produced by the
requirements-reviewer agent.

Hard rules:
- Every scenario must trace to a numbered requirement section in the document.
  Cite it as a comment: "# requirement: §<section-number>"
- Do NOT write scenarios for any section marked UNCERTAIN in the requirements doc.
  List these under OPEN_QUESTIONS instead.
- If a step depends on a known UI selector from the registry list provided,
  annotate it: "# selector: <key>"
- Tag scenarios: @smoke (critical path), @regression (edge cases), @billing,
  @functional etc. as appropriate.
- Output format is strict — follow it exactly:

FEATURE:
<gherkin feature file content>

TEST_PLAN:
<markdown table: ID | Tier | Scenario | Requirement Section | Notes>

OPEN_QUESTIONS:
<bullet list of UNCERTAIN items skipped, or "none">`;

export async function runTestPlannerAgent(
  requirementsDoc: RequirementsDoc,
  workDir: string
): Promise<ScenarioPlan> {
  log('test-planner', `Planning tests for ${requirementsDoc.ticket}...`);

  // Refuse to plan if there are unresolved uncertainties
  if (requirementsDoc.uncertainSections.length > 0) {
    log(
      'test-planner',
      `Blocked: ${requirementsDoc.uncertainSections.length} UNCERTAIN section(s) must be resolved first: ` +
        requirementsDoc.uncertainSections.slice(0, 3).join('; ')
    );
    const slug = requirementsDoc.ticket.toLowerCase();
    return {
      ticket: requirementsDoc.ticket,
      featurePath: `${workDir}/${slug}.feature`,
      planPath: `${workDir}/${slug}.md`,
      scenarioCount: 0,
      needsHuman: true,
      openQuestions: requirementsDoc.uncertainSections,
    };
  }

  // Read the written requirements.md artifact
  const requirementsContent = readFileSync(requirementsDoc.requirementsPath, 'utf-8');

  const registry = loadRegistry();
  const knownSelectors = Object.entries(registry)
    .map(([key, entry]) => `- ${key}: ${entry.role} "${entry.name}" (${entry.description})`)
    .join('\n');

  const userPrompt = `Requirements Document:
${requirementsContent}

Known selectors available for reuse:
${knownSelectors || '(none registered yet)'}`;

  const response = await callClaude(SYSTEM_PROMPT, userPrompt);

  const featureMatch = response.match(/FEATURE:\s*([\s\S]*?)\s*TEST_PLAN:/);
  const planMatch = response.match(/TEST_PLAN:\s*([\s\S]*?)\s*OPEN_QUESTIONS:/);
  const questionsMatch = response.match(/OPEN_QUESTIONS:\s*([\s\S]*)$/);

  const featureContent = featureMatch?.[1]?.trim() ?? '';
  const planContent = planMatch?.[1]?.trim() ?? '';
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
  const needsHuman = openQuestions.length > 0;

  log('test-planner', `Wrote ${scenarioCount} scenario(s). Open questions: ${openQuestions.length}`);

  return {
    ticket: requirementsDoc.ticket,
    featurePath,
    planPath,
    scenarioCount,
    needsHuman,
    openQuestions,
  };
}
