import { postComment, addLabel, removeLabel } from '../lib/linear.js';
import { postSlackMessage, formatQaResultMessage } from '../lib/slack.js';
import { log } from '../lib/logger.js';
import type { BugReport, RunSummary, Verdict } from '../types.js';
import { LINEAR_LABELS } from '../types.js';

const STATUS_LABEL: Record<RunSummary['overallStatus'], string> = {
  verified: LINEAR_LABELS.QA_AUTOMATED,
  'needs-human': LINEAR_LABELS.QA_NEEDS_REVIEW,
  error: LINEAR_LABELS.QA_NEEDS_REVIEW,
  'product-bug-found': LINEAR_LABELS.QA_BUG_FOUND,
};

export async function runStatusReporterAgent(
  linearApiKey: string,
  issueId: string,
  issueUrl: string,
  summary: RunSummary,
  slackWebhookUrl?: string
): Promise<void> {
  log('status-reporter', `Reporting results for ${summary.ticket}...`);

  // Build the Linear comment — bugs mapped to requirement sections
  const body = renderLinearComment(summary);
  await postComment(linearApiKey, issueId, body);
  log('status-reporter', 'Posted Linear comment.');

  // Apply status label
  const label = STATUS_LABEL[summary.overallStatus];
  try {
    await addLabel(linearApiKey, issueId, label);
    log('status-reporter', `Applied label: ${label}`);
  } catch (err) {
    // Non-fatal: comment already posted, which is the important part.
    log('status-reporter', `Could not apply label "${label}": ${(err as Error).message}`);
  }

  // Remove the trigger label so a re-label is required to re-run
  try {
    await removeLabel(linearApiKey, issueId, LINEAR_LABELS.READY_FOR_QA_EXECUTION);
  } catch {
    // Non-fatal
  }

  // Post to Slack if webhook is configured
  if (slackWebhookUrl) {
    try {
      const totals = computeTotals(summary.verdicts);
      const slackMessage = formatQaResultMessage({
        ticket: summary.ticket,
        ticketUrl: issueUrl,
        status: summary.overallStatus,
        bugCount: summary.bugReport?.bugs.length ?? 0,
        passedCount: totals.passed,
        failedCount: totals.failed,
        environments: summary.verdicts.map((v) => v.environment),
      });
      await postSlackMessage(slackWebhookUrl, slackMessage);
      log('status-reporter', 'Posted Slack notification.');
    } catch (err) {
      // Non-fatal — Slack notification failure should not break the pipeline
      log('status-reporter', `Slack notification failed: ${(err as Error).message}`);
    }
  } else {
    log('status-reporter', 'SLACK_WEBHOOK_URL not set — skipping Slack notification.');
  }

  log('status-reporter', 'Done.');
}

function computeTotals(verdicts: Verdict[]): { passed: number; failed: number; skipped: number } {
  return verdicts.reduce(
    (acc, v) => ({ passed: acc.passed + v.passed, failed: acc.failed + v.failed, skipped: acc.skipped + v.skipped }),
    { passed: 0, failed: 0, skipped: 0 }
  );
}

function renderLinearComment(summary: RunSummary): string {
  const totals = computeTotals(summary.verdicts);

  const envLines = summary.verdicts
    .map((v) => `- **${v.environment}**: ${v.passed} passed, ${v.failed} failed, ${v.skipped} skipped`)
    .join('\n');

  const statusEmoji =
    summary.overallStatus === 'verified' ? '✅' :
    summary.overallStatus === 'product-bug-found' ? '🐛' :
    '⚠️';

  let bugSection = '';
  if (summary.bugReport && summary.bugReport.bugs.length > 0) {
    const bugLines = summary.bugReport.bugs
      .map(
        (b) =>
          `**[${b.environment}]** ${b.scenarioName}\n` +
          `  _Requirement:_ ${b.requirementSection}\n` +
          `  _Description:_ ${b.description}\n` +
          `  _Evidence:_ \`${b.evidence.slice(0, 200)}\``
      )
      .join('\n\n');

    bugSection = `\n## Bugs (mapped to requirements)\n\n${bugLines}`;
  }

  let envIssueSection = '';
  if (summary.bugReport && summary.bugReport.envIssues.length > 0) {
    const issueLines = summary.bugReport.envIssues
      .map((b) => `- [${b.environment}] ${b.scenarioName}: ${b.description}`)
      .join('\n');
    envIssueSection = `\n## Environment Issues (not product bugs)\n\n${issueLines}`;
  }

  return `## ${statusEmoji} QA Automation — ${summary.ticket}

**Status:** ${summary.overallStatus}
**Totals:** ${totals.passed} passed / ${totals.failed} failed / ${totals.skipped} skipped

${envLines}
${bugSection}
${envIssueSection}

_Automated by bw-qa-loop. Product-behavior failures require human follow-up — this tool does not auto-retry those._`;
}
