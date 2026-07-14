import { readFileSync } from 'node:fs';
import { loadRegistry, findMissingKeys } from '../lib/selectorRegistry.js';
import { log } from '../lib/logger.js';
import type { SelectorReport } from '../types.js';

/** IMPORTANT LIMITATION, stated plainly rather than papered over:
 *
 * This stage can only resolve selectors that are ALREADY in the registry.
 * It cannot autonomously discover a selector for UI it has never seen —
 * that requires either:
 *   (a) a human driving a real browser once (Claude in Chrome, or manual
 *       Playwright codegen) to confirm the selector, then adding it to
 *       selector-registry.json, or
 *   (b) a captured storageState + a scripted exploration the team has
 *       pre-approved (not autonomous discovery, still human-designed).
 *
 * Attempting to have a headless agent "guess" a selector from a
 * screenshot or DOM dump and call that "verified" is exactly the failure
 * mode the SOP warns against (false confidence from unverified locators).
 * So this stage fails loud and specific instead of guessing. */
export async function runSelectorStage(ticket: string, featurePath: string): Promise<SelectorReport> {
  log('selectors', `Checking selector coverage for ${ticket}...`);

  const featureContent = readFileSync(featurePath, 'utf-8');
  const requiredKeys = extractSelectorKeys(featureContent);
  const registry = loadRegistry();
  const missing = findMissingKeys(registry, requiredKeys);

  if (missing.length > 0) {
    log(
      'selectors',
      `${missing.length} selector(s) not in the registry: ${missing.join(', ')}. ` +
        `These need a human to verify once via a real browser session before this ticket can run headlessly.`
    );
    return { ticket, status: 'needs-human', missing };
  }

  log('selectors', `All ${requiredKeys.length} required selector(s) already known.`);
  return { ticket, status: 'known', missing: [] };
}

/** Looks for `# selector: <key>` annotation comments that the scenario
 * writer is instructed to emit above any step referencing a registry
 * entry. This is a deliberate, explicit contract rather than trying to
 * infer selector needs from step text. */
function extractSelectorKeys(featureContent: string): string[] {
  const matches = featureContent.matchAll(/#\s*selector:\s*([\w.]+)/g);
  return [...matches].map((m) => m[1]);
}
