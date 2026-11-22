# The bench of independentStop

Up to 12 cuts in the minimal sets, `independentStop` sums `2^m` states at each point, for `m` cuts. This folder measures this cost at 4, 8 and 12 cuts. Past 12 cuts, `independentStop` uses the Shannon expansion of `pathSetReliability`. The bench does not measure that cost yet.

- Each input has a fixed seed (`BENCH_SEED`). Each cut is in a minimal set, so a state has `m` bits.
- The workflow `bench.yml` starts 6 jobs in CI. Each job times each case in fresh child processes with `freshArms` of `@mark1russell7/rigor-bench`.
- The value of a case in a job is the median time of one call over the children of its arm.
- An A/A arm repeats the case of 12 cuts. Its spread is the noise of the job.
- `limits.json` keeps the frozen limit of each case, with its values, the commit and the date. The rule is `runLimit`: the worst value of 5 runs or more plus their spread.
- The runners of CI have different CPU models. The frozen limits pool 24 jobs of 4 runs on 6 CPU models, so one limit holds for each of these models. The timed code is the same in the 4 commits of these runs.
- The pooled limit is a ceiling. It stops only a large regression: approximately 1.5 times on the EPYC 7763 and 2.4 times on the EPYC 9V45. It does not hold a gain.
- A limit for each CPU model comes after a freeze run on a second day. The jobs on the 9V45 have two levels with low A/A noise, so one name can be two machine kinds.
- `node bench/main.ts read --in <folder> --freeze <file> --commit <sha>` freezes the limits of the records under a folder. Give `--commit` when the runs come from several commits.
- A job is a no read when its A/A spread is above the noise cap, or when its CPU model has no frozen value. A no read is not a pass.
- The gate of a case needs 3 jobs or more that read it. With fewer, the case is a no read. A job above its limit blocks the run.
- Timed runs give valid values only in CI. On a local computer, start only the tests of this folder.
