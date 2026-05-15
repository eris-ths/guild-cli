- **`tools/lore-scope.sh` moved to `scripts/lore-scope.sh`.** Top-level
  `tools/` held a single shell script that paralleled `scripts/`
  without a meaningful distinction. Merging removes a one-script
  directory and brings the root listing down 1 (part of #385's
  cold-reader discoverability pass). Test file moved
  `tests/tools/` → `tests/scripts/` to match. Doc refs in
  `lore/README.md`, `docs/glossary.md`, and source comments updated.
