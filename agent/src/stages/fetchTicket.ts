import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchTicket } from '../lib/linear.js';
import { log } from '../lib/logger.js';
import type { Ticket } from '../types.js';

export async function runFetchStage(apiKey: string, identifier: string, workDir: string): Promise<Ticket> {
  log('fetch', `Fetching ${identifier} from Linear...`);
  const ticket = await fetchTicket(apiKey, identifier);

  mkdirSync(workDir, { recursive: true });
  writeFileSync(`${workDir}/ticket.json`, JSON.stringify(ticket, null, 2) + '\n', 'utf-8');

  log('fetch', `"${ticket.title}" — ${ticket.acceptanceCriteria.length} acceptance criteria found`);
  if (ticket.acceptanceCriteria.length === 0) {
    log(
      'fetch',
      'No markdown-checklist acceptance criteria found in the description. ' +
        'The scenario writer will flag this ticket as needing human input rather than guessing.'
    );
  }
  return ticket;
}
