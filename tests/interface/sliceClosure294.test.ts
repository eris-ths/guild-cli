// Slice B (#294) — per-executor slice closure: interface-layer surface.
//
// Slice A (eb6bf57) added the domain primitives — `Request.executorRecords`,
// `executorStatus`, `completeSlice` / `failSlice`, hydrate tolerance for
// legacy flat-array `executors:` — and a wave-level `complete(by)`
// that routes to per-slice closure when `by` is an assigned executor.
//
// Slice B pivots the interface layer to read the structured form
// directly and surfaces the slice-vs-wave distinction at the verbs:
//
//   - `gate complete` / `gate fail`: when the call closes one slice
//     but other executors remain open, the wave state stays put and
//     the output is `✓ slice closed/failed: <id> by <by>` plus a
//     listing of the remaining open slices. When the call closes the
//     last slice (or the wave has no executors), the historical
//     wave-terminal output (`✓ completed: <id>`) is preserved.
//   - `gate wave-status`: per-executor `slice_status` (pending /
//     completed / failed / unknown) renders as a bracketed tag; the
//     legacy `unknown` shape (pre-#294 record) renders as `[?]` so a
//     reader can distinguish "we don't know" from `[pending]`.
//   - miki concern #1 (typo-safety): when a wave has assigned
//     executors and `--by` is not one of them, `complete` / `fail`
//     refuse before writing (exit 1), so a misspelt actor never
//     silently closes the whole wave via the Slice A fallback path.
//
// Each test exercises ONE of those contract points end-to-end through
// the CLI binary, mirroring the integration style of
// `tests/interface/multiExecutor.test.ts` and `waveStatus295.test.ts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(here, '../../../bin/gate.mjs');

function bootstrap(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'guild-slice294-'));
  writeFileSync(
    join(root, 'guild.config.yaml'),
    'content_root: .\nhost_names: [eris]\n',
  );
  mkdirSync(join(root, 'members'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(
  cwd: string,
  args: string[],
  actor?: string,
): { stdout: string; stderr: string; status: number } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (actor !== undefined) env['GUILD_ACTOR'] = actor;
  else delete env['GUILD_ACTOR'];
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

function registerAll(root: string, names: string[]): void {
  for (const n of names) {
    run(root, ['register', '--name', n]);
  }
}

/**
 * Stand up a multi-executor wave already in `executing` so the slice-
 * close paths can be exercised. Returns the request id.
 */
function bootstrapTwoExecWave(
  root: string,
  executors: [string, string],
  action = 'parallel slice work',
): string {
  const created = run(root, [
    'request',
    '--from', 'alice',
    '--action', action,
    '--reason', 'two-executor slice closure',
    '--executors', executors.join(','),
    '--format', 'json',
  ]);
  if (created.status !== 0) {
    throw new Error(`request failed: ${created.stderr}`);
  }
  const id = (JSON.parse(created.stdout) as { id: string }).id;
  const ap = run(root, ['approve', id, '--by', 'eris']);
  assert.equal(ap.status, 0, `approve failed: ${ap.stderr}`);
  const ex = run(root, ['execute', id, '--by', executors[0]]);
  assert.equal(ex.status, 0, `execute failed: ${ex.stderr}`);
  return id;
}

// -------------------- partial closure: 1 of 2 slices closes --------------------

test('#294: gate complete partial — 1 of 2 slices closed, wave state unchanged', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  // miki closes their slice. leysia's is still pending → wave stays
  // executing, output should announce "slice closed" + remaining.
  const closed = run(root, [
    'complete', id,
    '--by', 'miki',
    '--note', 'miki slice done',
  ]);
  assert.equal(closed.status, 0, `complete failed: ${closed.stderr}`);
  assert.match(closed.stdout, /✓ slice closed: .* by miki/);
  assert.match(closed.stdout, /open slices remaining:/);
  assert.match(closed.stdout, /- leysia \(status: pending\)/);
  assert.match(closed.stdout, /next: each remaining executor must run/);

  // miki should NOT appear in "remaining" (their slice is closed).
  const remainingBlock = closed.stdout.split('open slices remaining:')[1] ?? '';
  assert.doesNotMatch(remainingBlock, /- miki /);

  // Wave is still in `executing`; the wave-level terminal output must
  // NOT have fired.
  assert.doesNotMatch(closed.stdout, /^✓ completed:/m);
  const show = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(payload['state'], 'executing');
});

// -------------------- last-slice closure: wave transitions --------------------

test('#294: gate complete last-slice — closes wave to completed', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  // miki first (partial), then leysia (final → wave terminal).
  const partial = run(root, ['complete', id, '--by', 'miki', '--note', 'm done']);
  assert.equal(partial.status, 0);
  assert.match(partial.stdout, /✓ slice closed/);

  const final = run(root, ['complete', id, '--by', 'leysia', '--note', 'l done']);
  assert.equal(final.status, 0, `final complete failed: ${final.stderr}`);
  // Final call closes the wave: historical "✓ completed: <id>" output
  // is preserved (NOT the slice-close form).
  assert.match(final.stdout, /✓ completed:/);
  assert.doesNotMatch(final.stdout, /open slices remaining:/);

  const show = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(payload['state'], 'completed');
});

// -------------------- fail path: same shape as complete --------------------

test('#294: gate fail partial — 1 of 2 slices failed, wave state unchanged', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  const failed = run(root, [
    'fail', id,
    '--by', 'miki',
    '--reason', 'test environment broke',
  ]);
  assert.equal(failed.status, 0, `fail failed: ${failed.stderr}`);
  assert.match(failed.stdout, /✓ slice failed: .* by miki/);
  assert.match(failed.stdout, /open slices remaining:/);
  assert.match(failed.stdout, /- leysia \(status: pending\)/);

  // Wave stays executing — any-fail-wave-fail composition only fires
  // once every slice is terminal.
  const show = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(payload['state'], 'executing');
});

test('#294: gate fail last-slice — composes wave to failed (any-fail rule)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  // miki succeeds; leysia fails — under any-fail-wave-fail the wave
  // ends as `failed`.
  const m = run(root, ['complete', id, '--by', 'miki', '--note', 'ok']);
  assert.equal(m.status, 0);
  const l = run(root, ['fail', id, '--by', 'leysia', '--reason', 'crash']);
  assert.equal(l.status, 0, `final fail failed: ${l.stderr}`);
  assert.match(l.stdout, /✓ failed:/);
  assert.doesNotMatch(l.stdout, /open slices remaining:/);

  const show = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(payload['state'], 'failed');
});

// -------------------- miki concern #1: typo-safety --------------------

test('#294 / miki concern: complete --by non-member on non-empty executors → exit 1', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia', 'noir']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  // `noir` is a registered member but NOT in the wave's executors.
  // Without the handler-level reject this would route through the
  // Slice A fallback and silently close the whole wave.
  const r = run(root, ['complete', id, '--by', 'noir', '--note', 'should refuse']);
  assert.equal(r.status, 1, `expected exit 1 from non-member complete, stdout=${r.stdout}`);
  assert.match(r.stderr, /noir is not in this wave's executors/);
  assert.match(r.stderr, /\(miki, leysia\)/);
  assert.match(r.stderr, /typo\?/);
  assert.match(r.stderr, /next: re-run 'gate complete/);

  // Critically: the wave must not have transitioned. The substrate
  // record stays in `executing` and neither slice was stamped.
  const show = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(payload['state'], 'executing');
  const execs = payload['executors'] as Array<Record<string, string>>;
  assert.deepEqual(
    execs.map((e) => e['status']),
    ['pending', 'pending'],
  );
});

test('#294 / miki concern: fail --by non-member on non-empty executors → exit 1', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia', 'noir']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  const r = run(root, ['fail', id, '--by', 'noir', '--reason', 'should refuse']);
  assert.equal(r.status, 1, `expected exit 1 from non-member fail, stdout=${r.stdout}`);
  assert.match(r.stderr, /noir is not in this wave's executors/);
  assert.match(r.stderr, /next: re-run 'gate fail/);

  const show = run(root, ['show', id, '--format', 'json']);
  const payload = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(payload['state'], 'executing');
});

// -------------------- wave-status: structured form rendering --------------------

test('#294: gate wave-status renders mixed slice status (pending / completed)', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  // Close miki's slice; leysia stays pending. wave-status should
  // surface that mix.
  const closed = run(root, ['complete', id, '--by', 'miki', '--note', 'm done']);
  assert.equal(closed.status, 0);

  const ws = run(root, ['wave-status', id, '--format', 'text']);
  assert.equal(ws.status, 0, `wave-status failed: ${ws.stderr}`);
  // miki — completed slice; leysia — pending slice.
  assert.match(ws.stdout, /miki\s+\[completed\]/);
  assert.match(ws.stdout, /leysia\s+\[pending\]/);
  // The close note surfaces under miki's line.
  assert.match(ws.stdout, /note: m done/);

  // JSON form mirrors the same per-executor structure.
  const wsJson = run(root, ['wave-status', id, '--format', 'json']);
  assert.equal(wsJson.status, 0);
  const j = JSON.parse(wsJson.stdout) as {
    executors: Array<{ name: string; slice_status: string; slice_note: string | null }>;
  };
  const miki = j.executors.find((e) => e.name === 'miki');
  const leysia = j.executors.find((e) => e.name === 'leysia');
  assert.ok(miki && leysia, 'wave-status JSON missing executors');
  assert.equal(miki!.slice_status, 'completed');
  assert.equal(miki!.slice_note, 'm done');
  assert.equal(leysia!.slice_status, 'pending');
});

test('#294: gate wave-status surfaces failed slice tag', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  const f = run(root, ['fail', id, '--by', 'miki', '--reason', 'env crash']);
  assert.equal(f.status, 0);
  const ws = run(root, ['wave-status', id, '--format', 'text']);
  assert.equal(ws.status, 0);
  assert.match(ws.stdout, /miki\s+\[failed\]/);
  assert.match(ws.stdout, /leysia\s+\[pending\]/);
});

// -------------------- legacy unknown rendering ([?] marker) --------------------

test('#294: gate wave-status legacy executors hydrate as [?]', (t) => {
  const { root, cleanup } = bootstrap();
  t.after(cleanup);
  registerAll(root, ['alice', 'miki', 'leysia']);
  const id = bootstrapTwoExecWave(root, ['miki', 'leysia']);

  // Locate the on-disk record and rewrite the structured `executors:`
  // back to the legacy flat array, simulating a pre-#294 record that
  // has not yet been mutated post-upgrade. Slice A's hydrate tolerance
  // says these load with status='unknown'.
  const path = join(root, 'requests', 'executing', `${id}.yaml`);
  const original = readFileSync(path, 'utf8');
  // Replace the structured executors block with a legacy flat array.
  // The block spans from `executors:` to the next top-level key.
  const legacy = original.replace(
    /executors:\n(?: {2}- name:.*\n(?: {4}status:.*\n)?(?: {4}completed_at:.*\n)?(?: {4}note:.*\n)?)+/,
    'executors:\n  - miki\n  - leysia\n',
  );
  assert.notEqual(legacy, original, 'failed to rewrite executors block to legacy form');
  writeFileSync(path, legacy);

  const ws = run(root, ['wave-status', id, '--format', 'text']);
  assert.equal(ws.status, 0, `wave-status failed: ${ws.stderr}`);
  // Both executors render with the `[?]` legacy marker.
  assert.match(ws.stdout, /miki\s+\[\?\]/);
  assert.match(ws.stdout, /leysia\s+\[\?\]/);

  // JSON form carries slice_status='unknown' literally so machine
  // consumers can branch on it.
  const wsJson = run(root, ['wave-status', id, '--format', 'json']);
  assert.equal(wsJson.status, 0);
  const j = JSON.parse(wsJson.stdout) as {
    executors: Array<{ name: string; slice_status: string }>;
  };
  for (const e of j.executors) {
    assert.equal(e.slice_status, 'unknown', `expected unknown for ${e.name}`);
  }
});
