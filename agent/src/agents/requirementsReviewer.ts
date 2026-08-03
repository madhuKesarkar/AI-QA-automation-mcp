import { mkdirSync, writeFileSync } from 'node:fs';
import { callClaude } from '../lib/anthropic.js';
import { fetchTicket, fetchLinearDocumentContent } from '../lib/linear.js';
import { fetchGoogleDocContent } from '../lib/googleDocs.js';
import { log } from '../lib/logger.js';
import type { Ticket, RequirementsDoc } from '../types.js';

/** The agent must EXPLICITLY flag uncertain or undecided sections rather
 * than generating plausible-sounding specs. False confidence here poisons
 * everything downstream. */
const SYSTEM_PROMPT = `You are a QA requirements reviewer. Your job is to consolidate
requirement information from multiple sources (Linear ticket, linked documents, design
specs) into a single, unambiguous requirements document for test planning.

Hard rules:
- Do NOT fill in gaps with plausible-sounding requirements. If something is unclear,
  flag it explicitly under UNCERTAIN sections.
- If a behavior is not explicitly specified, mark it UNCERTAIN rather than guessing.
- Every requirement must trace to a specific source (ticket AC, linked doc section, etc).
- Contradictions between sources must be flagged — do not resolve them silently.
- Output format is strict — follow it exactly:

REQUIREMENTS:
<full consolidated requirements as numbered sections with source citations>

UNCERTAIN:
<bullet list of unresolved items, or "none">

SOURCES_USED:
<bullet list of source URLs/names that contributed content, or "none">`;

export async function runRequirementsReviewerAgent(
  linearApiKey: string,
  identifier: string,
  workDir: string,
  googleDocsApiKey?: string
): Promise<RequirementsDoc> {
  log('requirements-reviewer', `Reviewing requirements for ${identifier}...`);

  mkdirSync(workDir, { recursive: true });

  // Step 1: Fetch the Linear ticket
  const ticket = await fetchTicket(linearApiKey, identifier);
  writeFileSync(`${workDir}/ticket.json`, JSON.stringify(ticket, null, 2) + '\n', 'utf-8');
  log('requirements-reviewer', `Fetched ticket: "${ticket.title}" — ${ticket.linkedResources.length} linked resource(s)`);

  // Step 2: Fetch linked resources
  const fetchedResources = await fetchLinkedResources(ticket, linearApiKey, googleDocsApiKey);
  const accessibleCount = fetchedResources.filter((r) => r.content).length;
  log('requirements-reviewer', `Fetched ${accessibleCount}/${fetchedResources.length} linked resource(s)`);

  // Step 3: Consolidate via Claude
  const userPrompt = buildUserPrompt(ticket, fetchedResources);
  const response = await callClaude(SYSTEM_PROMPT, userPrompt);

  // Step 4: Parse response
  const requirementsMatch = response.match(/REQUIREMENTS:\s*([\s\S]*?)\s*UNCERTAIN:/);
  const uncertainMatch = response.match(/UNCERTAIN:\s*([\s\S]*?)\s*SOURCES_USED:/);
  const sourcesMatch = response.match(/SOURCES_USED:\s*([\s\S]*)$/);

  const requirementsContent = requirementsMatch?.[1]?.trim() ?? '';
  const uncertainText = uncertainMatch?.[1]?.trim() ?? '';
  const sourcesText = sourcesMatch?.[1]?.trim() ?? '';

  const uncertainSections =
    uncertainText.toLowerCase() === 'none'
      ? []
      : uncertainText
          .split('\n')
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);

  const sourcesConsolidated =
    sourcesText.toLowerCase() === 'none'
      ? []
      : sourcesText
          .split('\n')
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean);

  // Step 5: Write requirements.md artifact
  const requirementsPath = `${workDir}/requirements.md`;
  const markdown = buildRequirementsMarkdown(ticket, requirementsContent, uncertainSections, sourcesConsolidated);
  writeFileSync(requirementsPath, markdown, 'utf-8');

  log(
    'requirements-reviewer',
    `requirements.md written — ${uncertainSections.length} UNCERTAIN section(s) flagged.` +
      (uncertainSections.length > 0 ? ` These will block test planning until resolved.` : '')
  );

  return {
    ticket: ticket.identifier,
    title: ticket.title,
    consolidatedRequirements: requirementsContent,
    uncertainSections,
    sourcesConsolidated,
    requirementsPath,
  };
}

// async function fetchLinkedResources(ticket: Ticket, googleDocsApiKey?: string): Promise<Ticket['linkedResources']> {
//   const results = await Promise.allSettled(
//     ticket.linkedResources.map(async (resource) => {
//       let content: string | null = null;

//       if (resource.type === 'google-doc') {
//         content = await fetchGoogleDocContent(resource.url, googleDocsApiKey);
//       }
//       // Figma and Slack require auth flows beyond this version's scope —
//       // mark them as inaccessible so the agent explicitly flags the gap.

//       return { ...resource, content: content ?? undefined };
//     })

async function fetchLinkedResources(
  ticket: Ticket,
  linearApiKey: string,
  googleDocsApiKey?: string
): Promise<Ticket['linkedResources']> {
  const results = await Promise.allSettled(
    ticket.linkedResources.map(async (resource) => {
      let content: string | null = null;

      if (resource.type === 'google-doc') {
        content = await fetchGoogleDocContent(resource.url, googleDocsApiKey);
      } else if (resource.type === 'linear-doc') {
        content = await fetchLinearDocumentContent(linearApiKey, resource.url);
      }
      // Figma, Slack, and Orchard prototypes require auth/tooling flows
      // beyond this version's scope — mark them as inaccessible so the
      // agent explicitly flags the gap.

      return { ...resource, content: content ?? undefined };
    })
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    log('requirements-reviewer', `Could not fetch ${ticket.linkedResources[i].url}: ${(result.reason as Error).message}`);
    return ticket.linkedResources[i]; // content stays undefined
  });

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    log('requirements-reviewer', `Could not fetch ${ticket.linkedResources[i].url}: ${(result.reason as Error).message}`);
    return ticket.linkedResources[i]; // content stays undefined
  });
}

function buildUserPrompt(ticket: Ticket, resources: Ticket['linkedResources']): string {
  const resourceSections = resources
    .map((r) => {
      if (r.content) {
        return `--- Source: ${r.url} ---\n${r.content}\n--- End ---`;
      }
      return `--- Source: ${r.url} (INACCESSIBLE — ${r.type} requires auth or public sharing) ---`;
    })
    .join('\n\n');

  return `Ticket: ${ticket.identifier} — ${ticket.title}
Ticket URL: ${ticket.url}

Description:
${ticket.description}

Acceptance Criteria (from Linear checklist):
${ticket.acceptanceCriteria.length > 0
  ? ticket.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')
  : '(none found in ticket — flag all requirements as needing confirmation)'}

Linked Resources:
${resources.length > 0 ? resourceSections : '(none)'}`;
}

function buildRequirementsMarkdown(
  ticket: Ticket,
  requirements: string,
  uncertainSections: string[],
  sources: string[]
): string {
  const uncertainBlock =
    uncertainSections.length > 0
      ? `\n## ⚠️ UNCERTAIN — Do Not Test Until Resolved\n\n${uncertainSections.map((s) => `- ${s}`).join('\n')}\n`
      : '';

  const sourcesBlock =
    sources.length > 0
      ? `\n## Sources Consolidated\n\n${sources.map((s) => `- ${s}`).join('\n')}\n`
      : '';

  return `# Requirements: ${ticket.identifier} — ${ticket.title}

> Auto-generated by requirements-reviewer agent. Uncertain sections must be
> resolved by a human before the test-planner proceeds.

Ticket: ${ticket.url}
${uncertainBlock}
## Requirements

${requirements}
${sourcesBlock}`;
}
