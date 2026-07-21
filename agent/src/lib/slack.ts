/** Thin Slack incoming-webhook poster. No SDK dependency — just a POST.
 * If SLACK_WEBHOOK_URL is not set the caller should skip notification
 * rather than fail the pipeline over it. */
export async function postSlackMessage(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${res.statusText}`);
  }
}

/** Formats a Slack message block for a QA run result.
 * Keeps it concise — full details live in the Linear comment. */
export function formatQaResultMessage(params: {
  ticket: string;
  ticketUrl: string;
  status: string;
  bugCount: number;
  passedCount: number;
  failedCount: number;
  environments: string[];
}): string {
  const { ticket, ticketUrl, status, bugCount, passedCount, failedCount, environments } = params;

  const icon =
    status === 'verified' ? ':white_check_mark:' :
    status === 'product-bug-found' ? ':bug:' :
    ':warning:';

  const envList = environments.join(', ');

  return [
    `${icon} *QA Automation — ${ticket}*`,
    `Status: *${status}*  |  Envs: ${envList}`,
    `Passed: ${passedCount}  Failed: ${failedCount}${bugCount > 0 ? `  Bugs mapped: ${bugCount}` : ''}`,
    `<${ticketUrl}|View ticket on Linear>`,
  ].join('\n');
}
