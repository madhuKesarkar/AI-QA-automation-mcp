import type { Ticket, LinkedResource } from '../types.js';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

async function linearRequest<T>(apiKey: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Linear API returned errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  if (!json.data) {
    throw new Error('Linear API returned no data');
  }
  return json.data;
}

/** Fetches a ticket by its human-readable identifier, e.g. "FINOPS-456".
 * Acceptance criteria are parsed out of the description's checklist items.
 * Linked resources (Google Docs, Figma, Slack) are extracted for the
 * requirements-reviewer agent to fetch. */
export async function fetchTicket(apiKey: string, identifier: string): Promise<Ticket> {
  const query = `
    query IssueByIdentifier($id: String!) {
      issues(filter: { number: { eq: $id } }, first: 1) {
        nodes {
          id
          identifier
          title
          description
          url
          labels { nodes { name } }
        }
      }
    }
  `;

  const numberPart = identifier.split('-').pop();
  if (!numberPart || Number.isNaN(Number(numberPart))) {
    throw new Error(`Could not parse issue number from identifier "${identifier}"`);
  }

  const data = await linearRequest<{
    issues: { nodes: Array<{ id: string; identifier: string; title: string; description: string; url: string; labels: { nodes: Array<{ name: string }> } }> };
  }>(apiKey, query, { id: Number(numberPart) });

  const node = data.issues.nodes.find((n) => n.identifier === identifier);
  if (!node) {
    throw new Error(`Ticket "${identifier}" not found (or not visible to this API key)`);
  }

  const acceptanceCriteria = extractAcceptanceCriteria(node.description ?? '');
  const linkedResources = extractLinkedResources(node.description ?? '');

  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? '',
    acceptanceCriteria,
    url: node.url,
    labels: node.labels.nodes.map((l) => l.name),
    linkedResources,
  };
}

function extractAcceptanceCriteria(description: string): string[] {
  const lines = description.split('\n');
  return lines
    .filter((line) => /^\s*-\s*\[[ xX]\]/.test(line))
    .map((line) => line.replace(/^\s*-\s*\[[ xX]\]\s*/, '').trim())
    .filter(Boolean);
}

/** Extracts Google Docs, Figma, and Slack URLs from the ticket description.
 * The requirements-reviewer agent will attempt to fetch content from these. */
function extractLinkedResources(description: string): LinkedResource[] {
  const resources: LinkedResource[] = [];
  const urlPattern = /https?:\/\/[^\s\)>\"]+/g;
  const matches = description.match(urlPattern) ?? [];

  for (const url of matches) {
    if (url.includes('docs.google.com')) {
      resources.push({ type: 'google-doc', url });
    } else if (url.includes('figma.com')) {
      resources.push({ type: 'figma', url });
    } else if (url.includes('slack.com')) {
      resources.push({ type: 'slack', url });
    }
  }

  // Deduplicate by URL
  return resources.filter((r, i, arr) => arr.findIndex((x) => x.url === r.url) === i);
}

/** Posts a comment to a ticket. Only the statusReporter agent is
 * allowed to call this — all other agents write to disk only. */
export async function postComment(apiKey: string, issueId: string, body: string): Promise<void> {
  const mutation = `
    mutation CommentCreate($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
      }
    }
  `;
  const data = await linearRequest<{ commentCreate: { success: boolean } }>(apiKey, mutation, {
    issueId,
    body,
  });
  if (!data.commentCreate.success) {
    throw new Error('Linear commentCreate returned success: false');
  }
}

/** Adds a label to a ticket by name. Label must already exist in the workspace. */
export async function addLabel(apiKey: string, issueId: string, labelName: string): Promise<void> {
  const findLabelQuery = `
    query LabelByName($name: String!) {
      issueLabels(filter: { name: { eq: $name } }, first: 1) {
        nodes { id }
      }
    }
  `;
  const labelData = await linearRequest<{ issueLabels: { nodes: Array<{ id: string }> } }>(
    apiKey,
    findLabelQuery,
    { name: labelName }
  );
  const labelId = labelData.issueLabels.nodes[0]?.id;
  if (!labelId) {
    throw new Error(`Label "${labelName}" does not exist in this Linear workspace — create it first`);
  }

  const mutation = `
    mutation IssueAddLabel($issueId: String!, $labelId: String!) {
      issueAddLabel(id: $issueId, labelId: $labelId) {
        success
      }
    }
  `;
  await linearRequest(apiKey, mutation, { issueId, labelId });
}

/** Removes a label from a ticket by name. Used by the webhook dispatcher
 * to clear trigger labels once the pipeline has started, preventing
 * re-triggering on the same event. */
export async function removeLabel(apiKey: string, issueId: string, labelName: string): Promise<void> {
  const findLabelQuery = `
    query LabelByName($name: String!) {
      issueLabels(filter: { name: { eq: $name } }, first: 1) {
        nodes { id }
      }
    }
  `;
  const labelData = await linearRequest<{ issueLabels: { nodes: Array<{ id: string }> } }>(
    apiKey,
    findLabelQuery,
    { name: labelName }
  );
  const labelId = labelData.issueLabels.nodes[0]?.id;
  if (!labelId) return; // label doesn't exist — nothing to remove

  const mutation = `
    mutation IssueRemoveLabel($issueId: String!, $labelId: String!) {
      issueRemoveLabel(id: $issueId, labelId: $labelId) {
        success
      }
    }
  `;
  await linearRequest(apiKey, mutation, { issueId, labelId });
}
