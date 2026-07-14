const STAGE_COLORS: Record<string, string> = {
  fetch: '\x1b[36m',
  scenarios: '\x1b[35m',
  selectors: '\x1b[33m',
  runner: '\x1b[34m',
  report: '\x1b[32m',
  reporter: '\x1b[32m',
};
const RESET = '\x1b[0m';

export function log(stage: string, message: string): void {
  const color = STAGE_COLORS[stage] ?? '';
  console.log(`${color}[${stage}]${RESET} ${message}`);
}

export function logError(stage: string, message: string): void {
  console.error(`\x1b[31m[${stage}] ERROR:${RESET} ${message}`);
}
