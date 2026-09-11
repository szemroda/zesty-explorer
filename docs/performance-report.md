# Performance report

Calibration date: 2026-09-11. Dataset seed: `2026`.

Machine: AMD Ryzen 7 9800X3D, 16 logical cores, 31 GiB RAM, Windows x64. Runtime: Node.js v24.15.0. Browser: Playwright Chromium 153.0.8010.12. Browser measurements use the production build at a 1600 × 1000 viewport.

## ExplorerCore p95

Times are milliseconds. Dataset size is the total across equal parent and child snapshots.

| Operation              | 1,000 | 10,000 | 50,000 |
| ---------------------- | ----: | -----: | -----: |
| Normalize              |  2.31 |  12.69 |  28.41 |
| Custom index           |  0.07 |   0.16 |   0.56 |
| Native index           |  0.08 |   0.36 |   2.93 |
| Custom join            |  0.11 |   1.06 |  28.20 |
| Native join            |  0.25 |   1.00 |  12.75 |
| Descendant predicate   |  0.36 |   6.92 | 199.74 |
| Recursive free text    |  0.95 |  13.48 | 266.29 |
| Facets                 |  0.56 |   0.56 |   1.17 |
| Sort                   |  0.20 |   0.91 |   6.18 |
| Page selection         | <0.01 |  <0.01 |  <0.01 |
| Loaded relation lookup | <0.01 |  <0.01 |  <0.01 |

The 10,000-item computation target of 250 ms and the 50,000-item target of one second both pass. The initial 50,000-item free-text result was 3,070 ms. Memoizing descendant matches reduced it to 266 ms without changing the `ExplorerCore` interface.

## Browser p50 / p95

The calibrated 10,000-item production run reported:

| Interaction                            |    p50 |    p95 |
| -------------------------------------- | -----: | -----: |
| Debounced filter, including DOM update | 287.38 | 543.35 |
| Key event to next paint                |   6.70 |   7.60 |
| Sort to next paint                     |  19.80 | 244.10 |
| Loaded expansion to next paint         |  26.70 |  28.80 |

The table mounted 100 rows, matching the selected page rather than the 10,000-item snapshot. Chromium reported 45.2 MiB used JavaScript heap after the run. No interaction long task remained after initial loading in this production sample.

The checked-in tests store per-operation local p95 baselines and fail above twice those values. The browser suite uses the same two-times rule for settled filtering, typing, warmed sorting, and expansion, while also enforcing the absolute product targets. Small sub-millisecond operations have deliberately padded baselines to avoid timer-noise failures.

## Main-thread decision

No Web Worker is warranted for version one. The optimized pure core meets the 10,000- and 50,000-item computation budgets, typing paints well below 100 ms, loaded expansion is below 100 ms, and only the current page is mounted. Moving computation to a Worker would add serialization and cancellation complexity without addressing DOM commit work. Revisit this decision if later representative runs miss these same gates.

Run `pnpm test:performance` for core measurements and `pnpm test:e2e` for the production-browser measurements.
