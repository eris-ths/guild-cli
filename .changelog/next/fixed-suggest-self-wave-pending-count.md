- **`gate suggest` / `gate boot` no longer undercount pending when a
  self-wave is open.** A request the actor both authored and is the
  executor of (a self-wave) is deliberately kept off the suggestion
  ladder — its only open transition is a self-approve, which
  `actionableTransitions` won't nudge. But `deriveSuggestedNextNullReason`
  skipped those requests entirely, so the null-reason's pending tally
  read one lower than `boot`'s `queues: pending` line for the same
  substrate (e.g. queues showed `pending=2` while the reason said "1
  pending"). The two surfaces now reconcile: the reason carries a
  dedicated self-wave clause ("N pending request(s) you authored also
  name you as executor (self-wave) — `gate suggest` does not nudge
  self-approve …"). This also closes a silent-gap sub-case where a
  *lone* self-wave pending produced no reason at all (the not-mine total
  was zero) while `queues: pending=1` showed it — the exact "silence
  reads as a bug" failure the reason field was added to prevent.
