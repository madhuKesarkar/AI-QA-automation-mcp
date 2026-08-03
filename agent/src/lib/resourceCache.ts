import { existsSync, readFileSync } from 'node:fs';

/** One entry in a ticket's resource cache manifest. `match` is tested as a
 * substring of the resource URL (so it survives query params and the
 * markdown-link artifacts Linear descriptions sometimes produce); `file` is
 * the cached content file, relative to <workDir>/resources/. */
interface ManifestEntry {
  match: string;
  file: string;
}

/** Reads a pre-fetched resource cache for a ticket.
 *
 * The headless agent can fetch Linear docs and public Google Docs on its own,
 * but not Figma, private Google Docs, Slack, or Orchard prototypes. Rather
 * than let those sources silently become UNCERTAIN gaps, a human (or an
 * MCP-enabled step running outside the sandbox) can drop the fetched content
 * into <workDir>/resources/ and list it in <workDir>/resources/index.json:
 *
 *   [ { "match": "<doc-or-file-id>", "file": "prd.md" }, ... ]
 *
 * The reviewer consults this cache BEFORE its own fetchers, so cached content
 * always wins. Returns the file content for the first entry whose `match`
 * occurs in `url`, or null if nothing matches. */
export function readCachedResource(workDir: string, url: string): string | null {
  const manifestPath = `${workDir}/resources/index.json`;
  if (!existsSync(manifestPath)) return null;

  let entries: ManifestEntry[];
  try {
    entries = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestEntry[];
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;

  for (const entry of entries) {
    if (entry?.match && url.includes(entry.match)) {
      const filePath = `${workDir}/resources/${entry.file}`;
      if (existsSync(filePath)) return readFileSync(filePath, 'utf-8');
    }
  }
  return null;
}
