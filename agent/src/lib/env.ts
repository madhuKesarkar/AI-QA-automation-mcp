import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

export interface AgentConfig {
  linearApiKey: string;
  anthropicApiKey: string;
  sandboxUrl: string;
  qaUrl: string;
  maxRounds: number;
  gitUserName: string;
  gitUserEmail: string;
}

export class ConfigError extends Error {}

/** Loads and validates required env vars. Throws ConfigError with a
 * specific, actionable message rather than a generic "undefined" crash —
 * this is what `doctor` surfaces to the user. */
export function loadConfig(): AgentConfig {
  const required = ['LINEAR_API_KEY', 'ANTHROPIC_API_KEY', 'SANDBOX_URL', 'QA_URL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Copy agent/.env.example to .env and fill these in.`
    );
  }

  return {
    linearApiKey: process.env.LINEAR_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    sandboxUrl: process.env.SANDBOX_URL!,
    qaUrl: process.env.QA_URL!,
    maxRounds: Number(process.env.MAX_ROUNDS ?? '3'),
    gitUserName: process.env.GIT_USER_NAME ?? 'bw-qa-loop-bot',
    gitUserEmail: process.env.GIT_USER_EMAIL ?? 'qa-bot@example.com',
  };
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Real, runnable checks — not just "hope it works". Each check is
 * independent so `doctor` reports everything wrong at once, not just
 * the first failure. */
export function runDoctorChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // Docker
  try {
    const version = execSync('docker --version', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    checks.push({ name: 'Docker', ok: true, detail: version });
  } catch {
    checks.push({
      name: 'Docker',
      ok: false,
      detail: 'docker not found on PATH. Install Docker Desktop or docker-ce.',
    });
  }

  // .env presence
  const envExists = existsSync('.env');
  checks.push({
    name: '.env file',
    ok: envExists,
    detail: envExists ? 'found ./.env' : 'not found — copy agent/.env.example to ./.env',
  });

  // Required vars (only meaningful if .env is loaded already by the caller)
  const required = ['LINEAR_API_KEY', 'ANTHROPIC_API_KEY', 'SANDBOX_URL', 'QA_URL'];
  for (const key of required) {
    const present = Boolean(process.env[key]);
    checks.push({
      name: `env: ${key}`,
      ok: present,
      detail: present ? 'set' : 'missing',
    });
  }

  // storageState files (session cookies captured once by a human login —
  // see selectorAgent.ts for why this exists)
  for (const env of ['sandbox', 'qa']) {
    const path = `./agent/storageState.${env}.json`;
    const exists = existsSync(path);
    checks.push({
      name: `storageState (${env})`,
      ok: exists,
      detail: exists
        ? `found ${path}`
        : `not found — run 'bw-qa-loop capture-session --env=${env}' once, signed in as a human`,
    });
  }

  return checks;
}
