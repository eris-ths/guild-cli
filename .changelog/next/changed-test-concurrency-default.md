- **Test runner default concurrency raised from 4 → 8** (override via
  `TEST_CONCURRENCY=<N>`). The suite is subprocess-spawn-bound (~119
  of 173 tests `spawnSync` a fresh `gate.mjs`), not CPU-bound, so
  oversubscription pays even on the 4-vCPU GitHub `ubuntu-latest`
  runner. Local measurement on a 10-core mac: 4 → 513s, 8 → ~310s,
  12 → 224s, 20 → 159s. The doc-comment block in `tests/run.mjs` carries
  the table so future tuning has a baseline.
