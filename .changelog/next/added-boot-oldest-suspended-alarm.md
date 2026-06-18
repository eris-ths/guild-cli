- **`gate boot` cross_passage — oldest-paused alarm.** Each passage's
  orientation summary now carries `oldest_suspended_age_days` and
  `oldest_suspended_cliff` (null when nothing is paused). A bare
  `suspended` count reads the same whether the oldest pause is two hours
  or two months old, so a long-forgotten thread hides inside the count;
  surfacing the oldest pause's age plus its one-line cliff turns boot
  into a forgotten-thread alarm. Text mode renders an `↳ oldest paused
  Nd ago: <cliff>` line under the passage when the oldest pause is at
  least a day old. Found by dogfood: an agora play sat suspended 39 days
  with its conclusion intact, because re-entry only ever saw the count.
  Closes the other half of records-outlive-writers — records must also be
  *findable* on re-entry, not merely countable.
