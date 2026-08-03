import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { SelectorRegistry, SelectorRegistryEntry } from '../types.js';

const REGISTRY_PATH = new URL('../../selector-registry.json', import.meta.url);

/** Loads the persisted selector registry. This is what lets the
 * test-planner and executor agents reuse selectors across tickets instead
 * of every ticket needing fresh browser exploration — the single biggest
 * cost driver in the manual version of this process (see the SOP: we hit
 * the "don't guess locators" wall twice on the bulk-upload-rates work). */
export function loadRegistry(): SelectorRegistry {
  if (!existsSync(REGISTRY_PATH)) {
    return {};
  }
  const raw = readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw) as SelectorRegistry;
}

export function saveRegistry(registry: SelectorRegistry): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

export function upsertEntry(registry: SelectorRegistry, key: string, entry: SelectorRegistryEntry): SelectorRegistry {
  return { ...registry, [key]: entry };
}

/** Returns the keys a scenario plan references that are NOT in the
 * registry yet. A non-empty result means the selector agent needs to run
 * (which, for a never-before-seen element, needs a human-driven browser
 * session — see the selector-validation phase in executor.ts). */
export function findMissingKeys(registry: SelectorRegistry, requiredKeys: string[]): string[] {
  return requiredKeys.filter((key) => !(key in registry));
}
