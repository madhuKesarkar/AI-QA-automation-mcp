import type { Ticket } from '../types.js';

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
 * Acceptance criteria are parsed out of the description's checklist items
 * (Linear stores AC as markdown checkboxes in the description body) —
 * this is a heuristic, not a guarantee; the scenario writer stage treats
 * an empty result as a signal to flag needsHuman rather than proceed. */
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

  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description ?? '',
    acceptanceCriteria,
    url: node.url,
    labels: node.labels.nodes.map((l) => l.name),
  };
}

function extractAcceptanceCriteria(description: string): string[] {
  // Matches markdown checklist lines: "- [ ] does the thing" / "- [x] ..."
  const lines = description.split('\n');
  return lines
    .filter((line) => /^\s*-\s*\[[ xX]\]/.test(line))
    .map((line) => line.replace(/^\s*-\s*\[[ xX]\]\s*/, '').trim())
    .filter(Boolean);
}

/** Posts a comment to a ticket. Used by the linearReporter stage — this
 * is the only stage allowed to write back to Linear. */
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

/** Adds a label to a ticket by name (label must already exist in the
 * workspace — see Epic 5's label-set ticket). Used to move tickets
 * through the qa:plan-pending -> qa:plan-approved -> qa:automated
 * state machine. */
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
