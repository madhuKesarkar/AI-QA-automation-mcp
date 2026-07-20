/** Fetches readable text content from a Google Doc.
 *
 * Two modes:
 *  1. API key (GOOGLE_DOCS_API_KEY) — works for publicly shared docs.
 *     Set the doc to "Anyone with the link can view" and this works
 *     without OAuth.
 *  2. No key — falls back to the HTML export URL, which works for
 *     public docs but is fragile (Google may block headless fetches).
 *
 * For private docs the team would need a service-account OAuth flow —
 * that's out of scope for this initial version. The requirements-reviewer
 * will mark these resources as inaccessible rather than fail. */

/** Extracts the Google Doc ID from a docs.google.com URL. */
export function extractDocId(url: string): string | null {
  // Handles /document/d/<ID>/edit, /document/d/<ID>/view, etc.
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

/** Fetches a Google Doc's plain text content via the Docs REST API. */
export async function fetchGoogleDocContent(url: string, apiKey?: string): Promise<string | null> {
  const docId = extractDocId(url);
  if (!docId) return null;

  if (apiKey) {
    return fetchViaApi(docId, apiKey);
  }

  // Fallback: HTML export (works for public docs only)
  return fetchViaHtmlExport(docId);
}

async function fetchViaApi(docId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${docId}?key=${apiKey}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;

    const doc = await res.json() as { body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } };
    return extractTextFromDocBody(doc);
  } catch {
    return null;
  }
}

async function fetchViaHtmlExport(docId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${docId}/export?format=txt`,
      { redirect: 'follow' }
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractTextFromDocBody(doc: { body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } }): string {
  const paragraphs = doc.body?.content ?? [];
  return paragraphs
    .flatMap((block) => block.paragraph?.elements ?? [])
    .map((el) => el.textRun?.content ?? '')
    .join('')
    .trim();
}
