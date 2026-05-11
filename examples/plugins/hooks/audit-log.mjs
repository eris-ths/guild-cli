// Example hook plugin (issue #36 Phase 1 step 5; #290 — Phase 2 extension).
//
// Subscribes to every `after:` event and appends an audit-log line
// to a file under content_root. Demonstrates:
//   - multi-event subscription via the array form of `on`
//   - the `after:` shape — observation only, no veto
//   - reading the request through `ctx.request` (post-mutation
//     snapshot for request-lifecycle events)
//   - reading the session event through `ctx.sessionEvent` (#290 —
//     post-save snapshot for `after:rest` / `after:wake` /
//     `after:farewell`)
//
// To enable:
//
//   # guild.config.yaml
//   plugins:
//     trusted: true
//     hooks:
//       - examples/plugins/hooks/audit-log.mjs
//
// Each request transition appends one JSON line to `audit.log` next
// to guild.config.yaml:
//
//   {"at":"2026-...","event":"after:approve","id":"2026-...","by":"alice","state":"approved"}
//
// Each session boundary (#290) emits a parallel-shaped line keyed on
// the session event id and kind:
//
//   {"at":"2026-...","event":"after:rest","id":"2026-05-11-001","by":"alice","kind":"rest"}

import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the audit log next to THIS plugin file. Real deployments
// might want to honour a content-root-relative path or environment
// override; the example keeps it simple.
const here = dirname(fileURLToPath(import.meta.url));
const AUDIT_LOG = join(here, '..', '..', '..', '..', 'audit.log');

export default {
  on: [
    'after:approve',
    'after:deny',
    'after:execute',
    'after:complete',
    'after:fail',
    'after:review',
    // #290 — session-boundary events. The subject is `ctx.sessionEvent`
    // (a SessionEvent aggregate) rather than `ctx.request`.
    'after:rest',
    'after:wake',
    'after:farewell',
  ],
  run: async (ctx) => {
    // #290: discriminate by which subject field is populated. A
    // request-lifecycle event leaves `ctx.sessionEvent` undefined and
    // vice versa — exactly one is set. Plugins that subscribe to BOTH
    // axes (this one) must branch; plugins that only care about one
    // axis can null-check the field they read and return early when
    // absent.
    let line;
    if (ctx.request) {
      line = JSON.stringify({
        at: new Date().toISOString(),
        event: ctx.event,
        id: ctx.request.id.value,
        by: ctx.actor,
        state: ctx.request.state,
      });
    } else if (ctx.sessionEvent) {
      line = JSON.stringify({
        at: new Date().toISOString(),
        event: ctx.event,
        id: ctx.sessionEvent.id,
        by: ctx.actor,
        kind: ctx.sessionEvent.kind,
      });
    } else {
      // Defensive: a future event kind we don't recognise. Skip
      // rather than crash — the audit log is best-effort and
      // forward-compatible (records-outlive-writers).
      return;
    }
    try {
      appendFileSync(AUDIT_LOG, line + '\n', 'utf8');
    } catch {
      // Per the contract: after-hook errors are warnings, not faults.
      // Swallowing here means the audit logger is best-effort by
      // design — a full disk shouldn't take down the lifecycle.
    }
  },
};
