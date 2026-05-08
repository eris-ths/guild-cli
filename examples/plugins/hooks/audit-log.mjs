// Example hook plugin (issue #36 Phase 1 step 5).
//
// Subscribes to every `after:` event and appends an audit-log line
// to a file under content_root. Demonstrates:
//   - multi-event subscription via the array form of `on`
//   - the `after:` shape — observation only, no veto
//   - reading the request through `ctx.request` (post-mutation
//     snapshot for after-events)
//
// To enable:
//
//   # guild.config.yaml
//   plugins:
//     trusted: true
//     hooks:
//       - examples/plugins/hooks/audit-log.mjs
//
// Each transition appends one JSON line to `audit.log` next to
// guild.config.yaml:
//
//   {"at":"2026-...","event":"after:approve","id":"2026-...","by":"alice","state":"approved"}

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
  ],
  run: async (ctx) => {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      event: ctx.event,
      id: ctx.request.id.value,
      by: ctx.actor,
      state: ctx.request.state,
    });
    try {
      appendFileSync(AUDIT_LOG, line + '\n', 'utf8');
    } catch {
      // Per the contract: after-hook errors are warnings, not faults.
      // Swallowing here means the audit logger is best-effort by
      // design — a full disk shouldn't take down the lifecycle.
    }
  },
};
