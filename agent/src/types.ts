// Every agent reads/writes one of these shapes to disk under
// ./project-envs/<TICKET>/. Agents never share in-memory state or
// pass reasoning to each other directly — only these files.

export interface Ticket {
  id: string;
  identifier: string; // e.g. "FINOPS-456"
  title: string;
  description: string;
  acceptanceCriteria: string[];
  url: string;
  labels: string[];
  linkedResources: LinkedResource[]; // extracted from description (Google Docs, Figma, Slack)
}

/** A resource referenced in the ticket description that the
 * requirements-reviewer agent will attempt to fetch and consolidate. */
export interface LinkedResource {
  type: 'google-doc' | 'figma' | 'slack' | 'linear-doc' | 'orchard-prototype' | 'url';
  url: string;
  content?: string; // populated after fetch; undefined means inaccessible
}

/** Output of the requirements-reviewer agent. Written to
 * requirements.md on disk; all downstream agents read from this file
 * rather than from the raw ticket. */
export interface RequirementsDoc {
  ticket: string;
  title: string;
  consolidatedRequirements: string; // full markdown prose
  uncertainSections: string[]; // UNCERTAIN: flagged items — the scenario writer must not guess these
  sourcesConsolidated: string[]; // URLs of all sources that were actually fetched
  requirementsPath: string; // path to the written requirements.md artifact
}

export interface ScenarioPlan {
  ticket: string;
  featurePath: string; // path to the generated .feature file
  planPath: string; // path to the generated .md test-case table
  scenarioCount: number;
  needsHuman: boolean; // true if the writer couldn't ground scenarios in known facts
  openQuestions: string[]; // things the writer explicitly refused to guess at
}

/** Output of the step-generator agent — the glue code between a generated
 * .feature and Playwright. Without it playwright-bdd cannot compile the
 * feature at all, so a plan with no step definitions can never execute.
 *
 * 'partial' is the expected steady state while the selector registry is
 * small: the feature compiles and runs, but the steps that would have needed
 * an unverified locator throw instead of guessing. */
export interface StepGenerationResult {
  ticket: string;
  stepsPath: string; // e.g. tests/steps/finops-445.steps.ts
  totalSteps: number;
  implementedSteps: number;
  unimplementedSteps: number; // blocked on selectors a human must capture
  missingStepsAfter: number; // still undefined after generation; must be 0
  status: 'complete' | 'partial' | 'failed';
}

export type SelectorStatus = 'known' | 'captured-this-run' | 'needs-human';

export interface SelectorRegistryEntry {
  description: string; // human-readable, e.g. "Select an action button"
  role: string;
  name: string;
  verifiedAgainst: string; // env url this was last confirmed on
  verifiedAt: string; // ISO date
}

export type SelectorRegistry = Record<string, SelectorRegistryEntry>;

export interface SelectorReport {
  ticket: string;
  status: SelectorStatus;
  missing: string[]; // selector keys that couldn't be resolved
}

export type Environment = 'sandbox' | 'qa';

export interface ScenarioResult {
  name: string;
  tags: string[];
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  screenshotPath?: string;
  tracePath?: string;
}

/** Did the run actually happen?
 *
 * This is deliberately separate from pass/fail counts. A run that executed
 * zero scenarios has failed === 0, which every downstream consumer would
 * otherwise read as "everything passed" — the exact false-green this field
 * exists to prevent. Only 'ran' means the numbers below are meaningful. */
export type ExecutionStatus =
  | 'ran' // Playwright executed at least one scenario
  | 'no-tests' // the run succeeded but matched zero scenarios
  | 'error'; // bddgen/Playwright could not run at all (e.g. undefined steps)

export interface Verdict {
  ticket: string;
  environment: Environment;
  ranAt: string;
  executionStatus: ExecutionStatus;
  diagnostic?: string; // why, when executionStatus is not 'ran'
  results: ScenarioResult[];
  passed: number;
  failed: number;
  skipped: number;
}

/** A single bug finding from the bug-analyser agent, mapped back to
 * a specific section of the requirements doc. */
export interface BugItem {
  scenarioName: string;
  environment: Environment;
  classification: 'product-bug' | 'env-flakiness' | 'test-issue';
  requirementSection: string; // e.g. "AC §3.2 — payment failure states"
  description: string; // plain-English description of the discrepancy
  evidence: string; // Playwright error message or assertion failure
}

/** Output of the bug-analyser agent. Written to bugs.md on disk. */
export interface BugReport {
  ticket: string;
  ranAt: string;
  bugs: BugItem[];
  envIssues: BugItem[]; // classified as environment instability, not product bugs
  testIssues: BugItem[]; // classified as test/selector problems, not product bugs
  overallStatus: 'passed' | 'product-bug-found' | 'env-issue' | 'needs-human';
  reportPath: string;
}

export interface RunSummary {
  ticket: string;
  verdicts: Verdict[];
  bugReport?: BugReport;
  overallStatus: 'verified' | 'needs-human' | 'error' | 'product-bug-found';
  reportPath: string;
}

// Linear label names that drive the two trigger points.
// These must exist in the Linear workspace (see setup SOP).
export const LINEAR_LABELS = {
  READY_FOR_QA: 'ready for QA',
  READY_FOR_QA_EXECUTION: 'ready for QA execution',
  QA_AUTOMATED: 'qa:automated',
  QA_BUG_FOUND: 'qa:bug-found',
  QA_NEEDS_REVIEW: 'qa:needs-review',
  QA_PLAN_PENDING: 'qa:plan-pending',
  QA_ENV_ISSUE: 'qa:env-issue',
} as const;

// Exit codes, matching the convention from the reference implementation
// this is modeled on, adapted for QA's needs (see exit code 3).
export const EXIT_CODES = {
  VERIFIED: 0,
  NEEDS_HUMAN: 1,
  ERROR: 2,
  PRODUCT_BUG_FOUND: 3,
} as const;
