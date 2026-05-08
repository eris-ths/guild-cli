// Example policy hook (issue #36 Phase 1 step 7).
//
// A `before:approve` veto enforcing a simple org-policy: the actor
// approving a request must not be its author. Demonstrates the
// `before:` flavour — returning `{ allow: false, reason }` blocks
// the transition before any mutation lands.
//
// Note: guild-cli already has a built-in self-approve gate
// (#233 — `features.self_approve` in guild.config.yaml). This
// plugin is the "what would it look like in user-land?" version,
// useful as a template for other policy gates that don't warrant
// a core feature flag.
//
// To enable:
//
//   # guild.config.yaml
//   plugins:
//     trusted: true
//     hooks:
//       - examples/plugins/hooks/policy-no-self-approve.mjs
//
// Result:
//
//   $ gate approve <id> --by <self>
//   error: hook vetoed approve on <id>: org policy: <self> authored this request
//
// Composes with built-in checks: this fires AFTER the built-in
// self-approve gate (which has its own `forbidden` mode under
// profile=swarm). If both are enabled, the built-in fires first;
// the hook is only reached when the built-in is `allowed` or `warn`.

export default {
  on: 'before:approve',
  run: async (ctx) => {
    const author = ctx.request.from.value;
    if (ctx.actor === author) {
      return {
        allow: false,
        reason: `org policy: ${ctx.actor} authored this request — a different actor must approve`,
      };
    }
    // Falling through (returning undefined) means "no objection" —
    // the bus continues to the next subscriber, then to the
    // mutation.
  },
};
