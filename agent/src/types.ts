// Every stage reads/writes one of these shapes to disk under
// ./project-envs/<TICKET>/. Stages never share in-memory state or
// pass reasoning to each other directly — only these files.

export interface Ticket {
  id: string;
  identifier: string; // e.g. "FINOPS-456"
  title: string;
  description: string;
  acceptanceCriteria: string[];
  url: string;
  labels: string[];
}

export interface ScenarioPlan {
  ticket: string;
  featurePath: string; // path to the generated .feature file
  planPath: string; // path to the generated .md test-case table
  scenarioCount: number;
  needsHuman: boolean; // true if the writer couldn't ground scenarios in known facts
  openQuestions: string[]; // things the writer explicitly refused to guess at
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
  // Distinguishes "the test broke" from "the product broke" — this is the
  // distinction that determines whether the loop retries or stops and reports.
  failureType?: 'infra' | 'product-behavior';
  message?: string;
  screenshotPath?: string;
  tracePath?: string;
}

export interface Verdict {
  ticket: string;
  environment: Environment;
  ranAt: string;
  results: ScenarioResult[];
  passed: number;
  failed: number;
  skipped: number;
}

export interface RunSummary {
  ticket: string;
  round: number;
  verdicts: Verdict[];
  overallStatus: 'verified' | 'needs-human' | 'error' | 'product-bug-found';
  reportPath: string;
}

// Exit codes, matching the convention from the reference implementation
// this is modeled on, adapted for QA's needs (see exit code 3).
export const EXIT_CODES = {
  VERIFIED: 0,
  NEEDS_HUMAN: 1,
  ERROR: 2,
  PRODUCT_BUG_FOUND: 3,
} as const;
