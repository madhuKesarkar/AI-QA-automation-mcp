import { writeFileSync } from 'node:fs';
import { callClaude } from '../lib/anthropic.js';
import { loadRegistry } from '../lib/selectorRegistry.js';
import { log } from '../lib/logger.js';
import type { Ticket, ScenarioPlan } from '../types.js';

const SYSTEM_PROMPT = `You are a QA scenario writer. You convert a Linear ticket's
acceptance criteria into tagged Gherkin scenarios (@smoke, @sanity, @functional).

Hard rules, non-negotiable:
- Every scenario must trace back to an explicit acceptance criterion or a
  fact in the known-selectors list you're given. Never invent business
  rules, UI copy, or behavior that isn't stated.
- If the acceptance criteria are missing, contradictory, or too vague to
  write a falsifiable scenario, do not guess. Instead list the specific
  open question under OPEN_QUESTIONS and skip that scenario.
- Prefer reusing an existing selector key over describing new UI, since
  new UI needs a human to verify selectors before this can run headlessly.
- Whenever a step depends on a specific known selector from the list
  below, add a comment line directly above that step: "# selector: <key>"
  using the exact key name. This is how the selector-checking stage knows
  what to verify — do not skip this annotation.
- Output format is strict — follow it exactly:

FEATURE:
<gherkin feature file content>

TEST_PLAN:
<markdown test case table: ID, tier, scenario, source>

OPEN_QUESTIONS:
<bullet list, or "none">`;

export async function runScenarioWriterStage(
  apiKey: string,
  ticket: Ticket,
  workDir: string
): Promise<ScenarioPlan> {
  log('scenarios', `Drafting scenarios for ${ticket.identifier}...`);

  const registry = loadRegistry();
  const knownSelectors = Object.entries(registry)
    .map(([key, entry]) => `- ${key}: ${entry.role} "${entry.name}" (${entry.description})`)
    .join('\n');

  const userPrompt = `Ticket: ${ticket.identifier} — ${ticket.title}

Description:
${ticket.description}

Acceptance criteria:
${ticket.acceptanceCriteria.length > 0 ? ticket.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n') : '(none found)'}

Known selectors available for reuse:
${knownSelectors || '(none registered yet)'}`;

  const response = await callClaude(apiKey, SYSTEM_PROMPT, userPrompt);

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

  const slug = ticket.identifier.toLowerCase();
  const featurePath = `${workDir}/${slug}.feature`;
  const planPath = `${workDir}/${slug}.md`;

  if (!featureContent) {
    log('scenarios', 'Model output did not match expected format — flagging needsHuman.');
    return {
      ticket: ticket.identifier,
      featurePath,
      planPath,
      scenarioCount: 0,
      needsHuman: true,
      openQuestions: ['Scenario writer could not produce a parseable feature file — check the raw model output.'],
    };
  }

  writeFileSync(featurePath, featureContent + '\n', 'utf-8');
  writeFileSync(planPath, planContent + '\n', 'utf-8');

  const scenarioCount = (featureContent.match(/^\s*Scenario:/gm) ?? []).length;
  const needsHuman = openQuestions.length > 0 || ticket.acceptanceCriteria.length === 0;

  log('scenarios', `Wrote ${scenarioCount} scenario(s). Open questions: ${openQuestions.length}`);

  return {
    ticket: ticket.identifier,
    featurePath,
    planPath,
    scenarioCount,
    needsHuman,
    openQuestions,
  };
}
