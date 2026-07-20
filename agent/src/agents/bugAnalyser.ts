import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { callClaude } from '../lib/anthropic.js';
import { log } from '../lib/logger.js';
import type { Verdict, BugReport, BugItem } from '../types.js';

/** Runs parallel to the executor (see cli.ts).
 *
 * Key lesson from the article: running bug analysis simultaneously
 * accelerates feedback but requires careful classification to avoid
 * false positives from environment instability. This agent explicitly
 * classifies each failure as product-bug, env-flakiness, or test-issue —
 * only product-bugs get reported to the ticket owner. */
const SYSTEM_PROMPT = `You are a QA bug analyser. You compare Playwright test failure
evidence against a requirements document to classify failures and map them to
specific requirement sections.

For each failing scenario, classify it as one of:
- "product-bug": actual product behavior contradicts an explicit requirement
- "env-flakiness": timeout, network error, infrastructure instability — not product behavior
- "test-issue": the test itself is wrong (bad selector, wrong assertion, test data problem)

Hard rules:
- Only classify as "product-bug" when the failure clearly contradicts a stated requirement.
- When in doubt between product-bug and env-flakiness, choose env-flakiness and note why.
- Every product-bug classification MUST cite the specific requirement section (e.g. "§2.1").
- Be explicit about your evidence for each classification.
- Output format is strict — follow it exactly:

BUGS:
<for each product-bug: SCENARIO | ENVIRONMENT | SECTION | DESCRIPTION | EVIDENCE>
(one per line, pipe-separated, or "none")

ENV_ISSUES:
<for each env-flakiness: SCENARIO | ENVIRONMENT | DESCRIPTION | EVIDENCE>
(one per line, pipe-separated, or "none")

TEST_ISSUES:
<for each test-issue: SCENARIO | ENVIRONMENT | DESCRIPTION | EVIDENCE>
(one per line, pipe-separated, or "none")`;

export async function runBugAnalyserAgent(
  anthropicApiKey: string,
  ticket: string,
  verdicts: Verdict[],
  requirementsPath: string,
  workDir: string
): Promise<BugReport> {
  log('bug-analyser', `Analysing failures for ${ticket}...`);

  const failedResults = verdicts.flatMap((v) =>
    v.results
      .filter((r) => r.status === 'failed')
      .map((r) => ({ ...r, environment: v.environment }))
  );

  const totalFailed = verdicts.reduce((sum, v) => sum + v.failed, 0);
  const reportPath = `${workDir}/${ticket.toLowerCase()}.bugs.md`;

  // No failures — fast path
  if (totalFailed === 0) {
    log('bug-analyser', 'All scenarios passed — no analysis needed.');
    const report: BugReport = {
      ticket,
      ranAt: new Date().toISOString(),
      bugs: [],
      envIssues: [],
      testIssues: [],
      overallStatus: 'passed',
      reportPath,
    };
    writeFileSync(reportPath, renderBugMarkdown(ticket, report, ''), 'utf-8');
    return report;
  }

  // Read requirements doc for context
  const requirementsContent = existsSync(requirementsPath)
    ? readFileSync(requirementsPath, 'utf-8')
    : '(requirements document not found — classify based on failure evidence only)';

  const userPrompt = buildUserPrompt(ticket, failedResults, verdicts, requirementsContent);
  const response = await callClaude(anthropicApiKey, SYSTEM_PROMPT, userPrompt);

  const bugs = parseItems(response, 'BUGS', verdicts, 'product-bug');
  const envIssues = parseItems(response, 'ENV_ISSUES', verdicts, 'env-flakiness');
  const testIssues = parseItems(response, 'TEST_ISSUES', verdicts, 'test-issue');

  const overallStatus =
    bugs.length > 0 ? 'product-bug-found' :
    envIssues.length > 0 ? 'env-issue' :
    testIssues.length > 0 ? 'needs-human' :
    'passed';

  log(
    'bug-analyser',
    `Analysis complete — ${bugs.length} product bug(s), ${envIssues.length} env issue(s), ${testIssues.length} test issue(s)`
  );

  const report: BugReport = {
    ticket,
    ranAt: new Date().toISOString(),
    bugs,
    envIssues,
    testIssues,
    overallStatus,
    reportPath,
  };

  writeFileSync(reportPath, renderBugMarkdown(ticket, report, response), 'utf-8');

  return report;
}

type FailedResult = {
  name: string;
  tags: string[];
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  environment: string;
};

function buildUserPrompt(
  ticket: string,
  failedResults: FailedResult[],
  verdicts: Verdict[],
  requirementsContent: string
): string {
  const failureLines = failedResults
    .map((r) => `- [${r.environment}] "${r.name}"\n  Error: ${r.message ?? '(no error message)'}`)
    .join('\n');

  const summaryLines = verdicts
    .map((v) => `${v.environment}: ${v.passed} passed, ${v.failed} failed, ${v.skipped} skipped`)
    .join('\n');

  return `Ticket: ${ticket}

Execution Summary:
${summaryLines}

Failed Scenarios:
${failureLines}

Requirements Document:
${requirementsContent.slice(0, 6000)}`;
}

function parseItems(
  response: string,
  section: 'BUGS' | 'ENV_ISSUES' | 'TEST_ISSUES',
  verdicts: Verdict[],
  classification: BugItem['classification']
): BugItem[] {
  const nextSection =
    section === 'BUGS' ? 'ENV_ISSUES' :
    section === 'ENV_ISSUES' ? 'TEST_ISSUES' :
    null;

  const pattern = nextSection
    ? new RegExp(`${section}:\\s*([\\s\\S]*?)\\s*${nextSection}:`)
    : new RegExp(`${section}:\\s*([\\s\\S]*)$`);

  const match = response.match(pattern);
  const block = match?.[1]?.trim() ?? '';

  if (!block || block.toLowerCase() === 'none') return [];

  const items: BugItem[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase() === 'none') continue;

    const parts = trimmed.split('|').map((p) => p.trim());
    if (parts.length < 3) continue;

    const environment = (parts[1] as string | undefined) ?? 'sandbox';
    const verdict = verdicts.find((v) => v.environment === environment);
    const envTyped = (verdict?.environment ?? 'sandbox') as BugItem['environment'];

    if (classification === 'product-bug') {
      items.push({
        scenarioName: parts[0] ?? '',
        environment: envTyped,
        classification,
        requirementSection: parts[2] ?? '(unknown)',
        description: parts[3] ?? '',
        evidence: parts[4] ?? '',
      });
    } else {
      items.push({
        scenarioName: parts[0] ?? '',
        environment: envTyped,
        classification,
        requirementSection: '(not applicable)',
        description: parts[2] ?? '',
        evidence: parts[3] ?? '',
      });
    }
  }

  return items;
}

function renderBugMarkdown(ticket: string, report: BugReport, rawResponse: string): string {
  const statusIcon =
    report.overallStatus === 'passed' ? '✅' :
    report.overallStatus === 'product-bug-found' ? '🐛' :
    report.overallStatus === 'env-issue' ? '⚠️' :
    '🔍';

  const bugsBlock =
    report.bugs.length > 0
      ? report.bugs
          .map(
            (b) =>
              `### 🐛 ${b.scenarioName} [${b.environment}]\n` +
              `**Requirement:** ${b.requirementSection}\n` +
              `**Description:** ${b.description}\n` +
              `**Evidence:** \`${b.evidence}\``
          )
          .join('\n\n')
      : '_None_';

  const envBlock =
    report.envIssues.length > 0
      ? report.envIssues.map((b) => `- [${b.environment}] ${b.scenarioName}: ${b.description}`).join('\n')
      : '_None_';

  const testBlock =
    report.testIssues.length > 0
      ? report.testIssues.map((b) => `- [${b.environment}] ${b.scenarioName}: ${b.description}`).join('\n')
      : '_None_';

  return `# Bug Analysis: ${ticket}

${statusIcon} **Overall Status:** ${report.overallStatus}
**Analysed at:** ${report.ranAt}

## Product Bugs (mapped to requirements)

${bugsBlock}

## Environment Issues (not product behavior)

${envBlock}

## Test Issues (selector/assertion problems)

${testBlock}
`;
}
