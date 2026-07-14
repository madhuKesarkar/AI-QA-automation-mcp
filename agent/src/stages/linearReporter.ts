import { postComment, addLabel } from '../lib/linear.js';
import { log } from '../lib/logger.js';
import type { RunSummary } from '../types.js';

const STATUS_LABEL: Record<RunSummary['overallStatus'], string> = {
  verified: 'qa:automated',
  'needs-human': 'qa:needs-review',
  error: 'qa:needs-review',
  'product-bug-found': 'qa:bug-found',
};

export async function runLinearReporterStage(
  apiKey: string,
  issueId: string,
  summary: RunSummary
): Promise<void> {
  log('reporter', `Posting result for ${summary.ticket} back to Linear...`);

  const body = renderComment(summary);
  await postComment(apiKey, issueId, body);

  const label = STATUS_LABEL[summary.overallStatus];
  try {
    await addLabel(apiKey, issueId, label);
  } catch (err) {
    // Non-fatal: comment already posted, which is the important part.
    // A missing label just means someone needs to create it in the
    // workspace (see Epic 5) — don't fail the whole run over it.
    log('reporter', `Could not apply label "${label}": ${(err as Error).message}`);
  }

  log('reporter', 'Done.');
}

function renderComment(summary: RunSummary): string {
  const totals = summary.verdicts.reduce(
    (acc, v) => ({ passed: acc.passed + v.passed, failed: acc.failed + v.failed, skipped: acc.skipped + v.skipped }),
    { passed: 0, failed: 0, skipped: 0 }
  );

  const envLines = summary.verdicts
    .map((v) => `- **${v.environment}**: ${v.passed} passed, ${v.failed} failed, ${v.skipped} skipped`)
    .join('\n');

  const statusEmoji =
    summary.overallStatus === 'verified' ? '✅' : summary.overallStatus === 'product-bug-found' ? '🐛' : '⚠️';

  return `## ${statusEmoji} QA Automation — Round ${summary.round}

**Status:** ${summary.overallStatus}
**Totals:** ${totals.passed} passed / ${totals.failed} failed / ${totals.skipped} skipped

${envLines}

Full report generated locally at \`${summary.reportPath}\` (attach to this comment manually, or wire up hosted report storage per the SOP's reporting section).

_This comment was posted automatically by bw-qa-loop. A failing result here means a human needs to look — this tool does not retry until green on real product-behavior failures._`;
}
