import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

export interface AgentConfig {
  linearApiKey: string;
  awsRegion: string;
  bedrockModelId: string; // Bedrock model ID or inference-profile ARN for callClaude
  sandboxUrl: string;
  qaUrl: string;
  gitUserName: string;
  gitUserEmail: string;
  // Optional — used by statusReporter; pipeline still runs without it
  slackWebhookUrl?: string;
  // Optional — used by requirementsReviewer to fetch Google Docs
  googleDocsApiKey?: string;
  // Optional — port for the webhook server command
  webhookPort: number;
  // Optional — secret for validating Linear webhook payloads
  linearWebhookSecret?: string;
}

export class ConfigError extends Error {}

/** Loads and validates required env vars. Throws ConfigError with a
 * specific, actionable message rather than a generic "undefined" crash —
 * this is what `doctor` surfaces to the user. */
export function loadConfig(): AgentConfig {
  const required = ['LINEAR_API_KEY', 'AWS_REGION', 'BEDROCK_MODEL_ID', 'SANDBOX_URL', 'QA_URL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Copy agent/.env.example to .env and fill these in.`
    );
  }

  return {
    linearApiKey: process.env.LINEAR_API_KEY!,
    awsRegion: process.env.AWS_REGION!,
    bedrockModelId: process.env.BEDROCK_MODEL_ID!,
    sandboxUrl: process.env.SANDBOX_URL!,
    qaUrl: process.env.QA_URL!,
    gitUserName: process.env.GIT_USER_NAME ?? 'bw-qa-loop-bot',
    gitUserEmail: process.env.GIT_USER_EMAIL ?? 'qa-bot@example.com',
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    googleDocsApiKey: process.env.GOOGLE_DOCS_API_KEY,
    webhookPort: Number(process.env.WEBHOOK_PORT ?? '3456'),
    linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
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

  // Required vars
  const required = ['LINEAR_API_KEY', 'AWS_REGION', 'BEDROCK_MODEL_ID', 'SANDBOX_URL', 'QA_URL'];
  for (const key of required) {
    const present = Boolean(process.env[key]);
    checks.push({
      name: `env: ${key}`,
      ok: present,
      detail: present ? 'set' : 'missing',
    });
  }

  // Optional vars — warn but don't fail
  const optional: Array<[string, string]> = [
    ['SLACK_WEBHOOK_URL', 'Slack notifications will be skipped'],
    ['GOOGLE_DOCS_API_KEY', 'Google Docs linked from tickets will not be fetched'],
    ['LINEAR_WEBHOOK_SECRET', 'Webhook signature validation will be skipped (not recommended for production)'],
  ];
  for (const [key, note] of optional) {
    const present = Boolean(process.env[key]);
    checks.push({
      name: `env: ${key} (optional)`,
      ok: true, // optional — never fail doctor
      detail: present ? 'set' : `not set — ${note}`,
    });
  }

  // storageState files (session cookies captured once by a human login)
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
