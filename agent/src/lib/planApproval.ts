import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rmSync } from 'node:fs';
import { log } from './logger.js';
import type { PlanApproval, PlanPr } from '../types.js';

const execFileAsync = promisify(execFile);

/** Branch a ticket's plan is proposed on. One per ticket: re-planning replaces
 * the proposal rather than accumulating branches. */
function planBranch(ticket: string): string {
  return `qa-plan/${ticket.toLowerCase()}`;
}

async function git(
  repoRoot: string,
  args: string[],
  extraEnv?: Record<string, string>
): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd: repoRoot,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    maxBuffer: 1024 * 1024 * 20,
  });
  return result.stdout.trim();
}

/** Paths arrive as './project-envs/FOO/x.feature' or 'tests/steps/x.ts';
 * git plumbing wants them repo-relative with no leading './'. */
function repoRelative(path: string): string {
  return path.replace(/^\.\//, '');
}

/** Proposes a plan for review by pushing it to a branch and opening a PR.
 *
 * Deliberately built out of git plumbing (hash-object / update-index /
 * commit-tree) against a temporary index rather than checkout + add + commit:
 * this runs inside whatever working tree the operator or webhook server happens
 * to have open, and switching branches underneath them — or committing whatever
 * else they had staged — would be its own outage. Nothing here touches the
 * working tree or the real index. */
export async function openPlanPr(opts: {
  ticket: string;
  repoRoot: string;
  files: string[]; // plan artifacts to propose: .feature, plan .md, requirements.md, steps .ts
  title: string;
  body: string;
}): Promise<PlanPr> {
  const { ticket, repoRoot, files, title, body } = opts;
  const branch = planBranch(ticket);
  const indexFile = `${repoRoot}.git/qa-plan-index-${ticket.toLowerCase()}`;
  const indexEnv = { GIT_INDEX_FILE: indexFile };

  await git(repoRoot, ['fetch', '--quiet', 'origin', 'main']);
  const base = await git(repoRoot, ['rev-parse', 'origin/main']);
  const baseTree = await git(repoRoot, ['rev-parse', `${base}^{tree}`]);

  try {
    await git(repoRoot, ['read-tree', base], indexEnv);

    for (const file of files) {
      const relative = repoRelative(file);
      const blob = await git(repoRoot, ['hash-object', '-w', relative]);
      await git(
        repoRoot,
        ['update-index', '--add', '--cacheinfo', `100644,${blob},${relative}`],
        indexEnv
      );
    }

    const tree = await git(repoRoot, ['write-tree'], indexEnv);

    if (tree === baseTree) {
      // The plan on disk is byte-identical to main: already approved, and there
      // is nothing to propose. Report the merged commit so the caller can go
      // straight to execution.
      log('plan-approval', `Plan for ${ticket} is already identical to origin/main (${base.slice(0, 8)}).`);
      return { ticket, branch, commitSha: base, prUrl: '', alreadyOnMain: true };
    }

    const commit = await git(repoRoot, [
      'commit-tree',
      tree,
      '-p',
      base,
      '-m',
      `QA plan for ${ticket}\n\n${body}\n\nRefs ${ticket}`,
    ]);

    await pushPlanBranch(repoRoot, commit, branch);
    log('plan-approval', `Pushed plan commit ${commit.slice(0, 8)} to ${branch}.`);

    const prUrl = await openOrReusePr(repoRoot, branch, title, body);
    return { ticket, branch, commitSha: commit, prUrl, alreadyOnMain: false };
  } finally {
    rmSync(indexFile, { force: true });
  }
}

async function pushPlanBranch(repoRoot: string, commit: string, branch: string): Promise<void> {
  try {
    await git(repoRoot, ['push', 'origin', `${commit}:refs/heads/${branch}`]);
  } catch {
    // The branch exists from an earlier planning run for this same ticket, and
    // plan generation is not deterministic, so the new plan is not a
    // fast-forward. Replacing an agent-authored, per-ticket proposal branch is
    // the intended behaviour — but say so out loud, since anyone who reviewed
    // the previous revision is now reviewing a different one.
    log('plan-approval', `${branch} is not a fast-forward — replacing the previous proposal for this ticket.`);
    await git(repoRoot, ['push', '--force', 'origin', `${commit}:refs/heads/${branch}`]);
  }
}

async function openOrReusePr(
  repoRoot: string,
  branch: string,
  title: string,
  body: string
): Promise<string> {
  try {
    const existing = await execFileAsync(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'],
      { cwd: repoRoot, env: process.env }
    );
    const url = existing.stdout.trim();
    if (url) {
      log('plan-approval', `Reusing open PR ${url} — the push updated it.`);
      return url;
    }

    const created = await execFileAsync(
      'gh',
      ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body],
      { cwd: repoRoot, env: process.env }
    );
    return created.stdout.trim().split('\n').pop() ?? '';
  } catch (err) {
    // The branch is pushed either way, so a human can still open the PR by
    // hand — the plan is not lost, it is just not yet proposed.
    const detail = (err as { stderr?: string; message?: string }).stderr ?? (err as Error).message;
    log(
      'plan-approval',
      `Could not open a PR via gh (${(detail ?? '').trim().slice(0, 200)}). ` +
        `The plan branch ${branch} is pushed — open the PR manually to request approval.`
    );
    return '';
  }
}

/** Is the plan on disk the plan that was approved?
 *
 * Approval is defined as "merged to main", and the check is byte-level: each
 * artifact's blob hash must match what origin/main has at that path. That is
 * what makes the answer provable rather than a matter of trust — plan
 * generation is nondeterministic (re-running FINOPS-445 moved 68 → 83
 * scenarios and rewrote ~1100 lines), so "a plan for this ticket was approved
 * at some point" says nothing about the bytes that are about to execute. */
export async function verifyPlanApproved(opts: {
  ticket: string;
  repoRoot: string;
  files: string[];
}): Promise<PlanApproval> {
  const { ticket, repoRoot, files } = opts;

  try {
    await git(repoRoot, ['fetch', '--quiet', 'origin', 'main']);
  } catch (err) {
    return {
      ticket,
      approved: false,
      reason: `Could not fetch origin/main to check approval: ${(err as Error).message}`,
      files: [],
    };
  }

  const mergedCommit = await git(repoRoot, ['rev-parse', 'origin/main']);
  const recorded: PlanApproval['files'] = [];

  for (const file of files) {
    const relative = repoRelative(file);

    let onMain: string;
    try {
      onMain = await git(repoRoot, ['rev-parse', `origin/main:${relative}`]);
    } catch {
      return {
        ticket,
        approved: false,
        reason:
          `${relative} is not on origin/main — this plan has not been approved. ` +
          `Merge the plan PR first (branch ${planBranch(ticket)}).`,
        files: [],
      };
    }

    const local = await git(repoRoot, ['hash-object', relative]);
    if (local !== onMain) {
      return {
        ticket,
        approved: false,
        reason:
          `${relative} on disk (${local.slice(0, 8)}) differs from the approved version on ` +
          `origin/main (${onMain.slice(0, 8)}). The reviewed plan is not the plan about to run — ` +
          `either restore the approved plan or get the new one merged.`,
        files: [],
      };
    }

    recorded.push({ path: relative, sha: onMain });
  }

  return { ticket, approved: true, mergedCommit, files: recorded };
}
