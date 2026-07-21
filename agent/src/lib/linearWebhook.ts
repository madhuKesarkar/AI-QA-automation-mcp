import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';
import { log, logError } from './logger.js';
import { LINEAR_LABELS } from '../types.js';

/** The shape of a Linear webhook label event payload (simplified).
 * Linear sends the full issue state; we only need what drives dispatch. */
export interface LinearWebhookPayload {
  action: string; // "update", "create", etc.
  type: string; // "Issue"
  data: {
    id: string;
    identifier: string;
    title: string;
    url: string;
    labelIds?: string[];
    labels?: Array<{ id: string; name: string }>;
    // Linear includes the diff in updatedFrom for update events
    updatedFrom?: {
      labelIds?: string[];
    };
  };
}

export type PipelineTrigger = 'planning' | 'execution' | null;

/** Determines which pipeline to trigger based on newly-added labels.
 * We check the diff (updatedFrom) to detect which label was just added,
 * not just the current label set — this prevents re-triggering on
 * unrelated issue updates that happen to still have the label. */
export function detectTrigger(payload: LinearWebhookPayload): PipelineTrigger {
  if (payload.type !== 'Issue' || payload.action !== 'update') return null;

  const currentLabels = (payload.data.labels ?? []).map((l) => l.name);
  const previousLabelIds = payload.data.updatedFrom?.labelIds ?? [];
  const currentLabelIds = payload.data.labelIds ?? [];

  // Find newly added labels (in current but not in previous)
  const addedLabelIds = currentLabelIds.filter((id) => !previousLabelIds.includes(id));
  if (addedLabelIds.length === 0) return null;

  // Map added IDs back to names
  const addedLabelNames = (payload.data.labels ?? [])
    .filter((l) => addedLabelIds.includes(l.id))
    .map((l) => l.name);

  if (addedLabelNames.includes(LINEAR_LABELS.READY_FOR_QA_EXECUTION)) return 'execution';
  if (addedLabelNames.includes(LINEAR_LABELS.READY_FOR_QA)) return 'planning';

  // Also check if current labels include trigger labels even without diff
  // (handles cases where Linear doesn't send updatedFrom)
  if (currentLabels.includes(LINEAR_LABELS.READY_FOR_QA_EXECUTION)) return 'execution';
  if (currentLabels.includes(LINEAR_LABELS.READY_FOR_QA)) return 'planning';

  return null;
}

/** Validates the Linear webhook HMAC signature.
 * Returns true if secret is not configured (dev mode). */
export function validateSignature(body: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true; // skip validation if no secret configured
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(body).digest('hex');
  // Linear sends "sha256=<hex>" — strip the prefix
  const received = signature.replace(/^sha256=/, '');
  return expected === received;
}

/** Starts an HTTP server that listens for Linear webhook events and
 * calls the appropriate pipeline handler.
 *
 * This is intentionally simple — one endpoint, one purpose. For
 * production you'd put this behind a reverse proxy with TLS. */
export function startWebhookServer(
  port: number,
  webhookSecret: string | undefined,
  onPlanningTrigger: (payload: LinearWebhookPayload) => Promise<void>,
  onExecutionTrigger: (payload: LinearWebhookPayload) => Promise<void>
): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404).end('Not found');
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const signature = req.headers['linear-signature'] as string | undefined;
    if (!validateSignature(body, signature, webhookSecret)) {
      log('webhook', 'Rejected: invalid signature');
      res.writeHead(401).end('Unauthorized');
      return;
    }

    let payload: LinearWebhookPayload;
    try {
      payload = JSON.parse(body) as LinearWebhookPayload;
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }

    const trigger = detectTrigger(payload);
    if (!trigger) {
      // Not a trigger we care about — ack and move on
      res.writeHead(200).end('ok');
      return;
    }

    log('webhook', `Trigger: ${trigger} for ${payload.data.identifier}`);
    res.writeHead(202).end('accepted'); // Respond immediately — pipeline runs async

    try {
      if (trigger === 'planning') {
        await onPlanningTrigger(payload);
      } else {
        await onExecutionTrigger(payload);
      }
    } catch (err) {
      logError('webhook', `Pipeline error for ${payload.data.identifier}: ${(err as Error).message}`);
    }
  });

  server.listen(port, () => {
    log('webhook', `Listening on port ${port} — POST /webhook`);
  });
}
