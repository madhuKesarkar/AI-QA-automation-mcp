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
 * Linked resources (Google Docs, Figma, Slack, Linear docs, Orchard
 * prototypes) are extracted for the requirements-reviewer agent to fetch. */
export async function fetchTicket(apiKey: string, identifier: string): Promise<Ticket> {
  const query = `
    query IssueByIdentifier($id: Float!) {
      issues(filter: { number: { eq: $id } }, first: 20) {
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

/** Extracts Google Docs, Figma, Slack, Linear document, and Orchard
 * prototype URLs from the ticket description. The requirements-reviewer
 * agent will attempt to fetch content from these (Linear docs and Google
 * Docs are fetchable; Figma, Slack, and Orchard prototypes are flagged
 * as inaccessible pending future work). */
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
    } else if (url.includes('linear.app/') && url.includes('/document/')) {
      resources.push({ type: 'linear-doc', url });
    } else if (url.includes('orchard.brightwheelhq.com')) {
      resources.push({ type: 'orchard-prototype', url });
    }
  }

  // Deduplicate by URL
  return resources.filter((r, i, arr) => arr.findIndex((x) => x.url === r.url) === i);
}

/** Fetches the content of a Linear document (not an issue) by its URL,
 * e.g. https://linear.app/brightwheel/document/<slug>-<id>. Linear
 * document URLs end with a slug followed by a UUID-like ID segment;
 * we extract that trailing ID segment and query the `document` field. */
export async function fetchLinearDocumentContent(apiKey: string, url: string): Promise<string> {
  const idMatch = url.match(/-([a-f0-9]{12,})(?:[/?#]|$)/i);
  if (!idMatch) {
    throw new Error(`Could not parse a document ID from Linear document URL: ${url}`);
  }
  const docId = idMatch[1];

  const query = `
    query DocumentById($id: String!) {
      document(id: $id) {
        title
        content
      }
    }
  `;

  const data = await linearRequest<{ document: { title: string; content: string } | null }>(
    apiKey,
    query,
    { id: docId }
  );

  if (!data.document) {
    throw new Error(`Linear document not found or not accessible: ${url}`);
  }

  return `# ${data.document.title}\n\n${data.document.content}`;
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
      issueLabels(filter: { name: { eq: $name } }, first: 20) {
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
      issueLabels(filter: { name: { eq: $name } }, first: 20) {
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