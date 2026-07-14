import { writeFileSync } from 'node:fs';
import { log } from '../lib/logger.js';
import type { Verdict, RunSummary } from '../types.js';

export function runReportStage(ticket: string, round: number, verdicts: Verdict[], workDir: string): RunSummary {
  log('report', `Aggregating ${verdicts.length} verdict(s) for ${ticket}, round ${round}...`);

  const totalFailed = verdicts.reduce((sum, v) => sum + v.failed, 0);
  const overallStatus: RunSummary['overallStatus'] = totalFailed === 0 ? 'verified' : 'needs-human';

  const reportPath = `${workDir}/${ticket.toLowerCase()}.report.html`;
  writeFileSync(reportPath, renderHtml(ticket, round, verdicts, overallStatus), 'utf-8');

  log('report', `Report written to ${reportPath} — status: ${overallStatus}`);

  return { ticket, round, verdicts, overallStatus, reportPath };
}

function renderHtml(ticket: string, round: number, verdicts: Verdict[], status: string): string {
  const statusColor = status === 'verified' ? '#1e7e34' : '#b00020';
  const sections = verdicts
    .map((v) => {
      const rows = v.results
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.tags.join(', ')}</td>
          <td style="color:${r.status === 'passed' ? '#1e7e34' : r.status === 'skipped' ? '#888' : '#b00020'}">${r.status}</td>
          <td>${r.message ? escapeHtml(r.message) : ''}</td>
        </tr>`
        )
        .join('');
      return `
      <h2>${v.environment} <small>(${v.ranAt})</small></h2>
      <p>${v.passed} passed &middot; ${v.failed} failed &middot; ${v.skipped} skipped</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">
        <tr><th>Scenario</th><th>Tags</th><th>Status</th><th>Message</th></tr>
        ${rows}
      </table>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${ticket} — QA report (round ${round})</title></head>
<body style="font-family: sans-serif; max-width: 900px; margin: 40px auto;">
  <h1>${ticket} <span style="color:${statusColor}">[${status}]</span></h1>
  <p>Round ${round}</p>
  ${sections}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
