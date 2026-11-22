# The bench of independentStop

`independentStop` sums `2^m` states at each point, for `m` cuts in the minimal sets. This folder measures this cost at 4, 8 and 12 cuts.

- Each input has a fixed seed (`BENCH_SEED`). Each cut is in a minimal set, so a state has `m` bits.
- The workflow `bench.yml` starts 6 jobs in CI. Each job times each case in fresh child processes with `freshArms` of `@mark1russell7/rigor-bench`.
- The value of a case in a job is the median time of one call over the children of its arm.
- An A/A arm repeats the case of 12 cuts. Its spread is the noise of the job.
- `limits.json` keeps the frozen limit of each case, with its values, the commit and the date. The rule is `runLimit`: the worst value of 5 runs or more plus their spread.
- A job is a no read when its A/A spread is above the noise cap, or when its CPU model has no frozen value. A no read is not a pass.
- The gate of a case needs 3 jobs or more that read it. With fewer, the case is a no read. A job above its limit blocks the run.
- Timed runs give valid values only in CI. On a local computer, start only the tests of this folder.
