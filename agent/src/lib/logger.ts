const STAGE_COLORS: Record<string, string> = {
  cli: '\x1b[36m',
  webhook: '\x1b[36m',
  'requirements-reviewer': '\x1b[35m',
  'test-planner': '\x1b[33m',
  executor: '\x1b[34m',
  'bug-analyser': '\x1b[31m',
  'status-reporter': '\x1b[32m',
};
const RESET = '\x1b[0m';

export function log(stage: string, message: string): void {
  const color = STAGE_COLORS[stage] ?? '';
  console.log(`${color}[${stage}]${RESET} ${message}`);
}

export function logError(stage: string, message: string): void {
  console.error(`\x1b[31m[${stage}] ERROR:${RESET} ${message}`);
}
