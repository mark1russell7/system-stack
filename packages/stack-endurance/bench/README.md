# The bench of independentStop

Up to 12 cuts in the minimal sets, `independentStop` sums `2^m` states at each point, for `m` cuts. This folder measures this cost at 4, 8 and 12 cuts. Past 12 cuts, `independentStop` uses the Shannon expansion of `pathSetReliability`. The case of 14 cuts measures that cost. It is in the default budget `INDEPENDENT_MAX_WORK`, and 15 cuts are too. At 16 cuts, the expansion has 17662 steps, and the budget refuses it.

- Each input has a fixed seed (`BENCH_SEED`). Each cut is in a minimal set, so a state has `m` bits.
- The workflow `bench.yml` starts 6 jobs in CI. Each job has 20 rounds: 4 times the count of arms (`JOB_ROUNDS`). Each job times each case in fresh child processes with `freshArms` of `@mark1russell7/rigor-bench`.
- The value of a case in a job is the median time of one call over the children of its arm.
- An A/A arm repeats the case of 12 cuts. Its spread is the noise of the job.
- `limits.json` keeps the frozen limit of each case, with its values, the commit and the date. The rule is `runLimit`: the worst value of 5 runs or more plus their spread.
- The runners of CI have different CPU models. The frozen limits hold 60 jobs of 10 runs on 7 CPU models, from two days. The timed code of the two commits is the same.
- Each CPU model with 5 jobs or more has its own limit: `runLimit` of the values of its jobs (`modelTables`). The gate finds the limit of a job with `cpuEntry` of rigor-bench.
- The other models of the freeze get the ceiling: the limit over all the jobs. A read at the ceiling has the note of `limitOnModel`. It stops only a large regression, and it does not hold a gain.
- At 12 cuts, the limit of the EPYC 7763 is 1.04 times its median value. The ceiling is 1.68 times that median.
- The limits of the first day blocked 1 of 36 jobs of the second day on a model with its own limit. The job was above on 2 cases, by 0.07% and 0.26%. The limits of the second day blocked no job of the first day.
- The jobs on the 9V45 have two levels at 12 cuts: 31 ms, and 34 to 35 ms. The jobs on the 8573C have two levels too. The record of a job has no field that tells the two machine kinds apart, so the limit of a model holds its two levels.
- `node bench/main.ts read --in <folder> --freeze <file> --commit <sha>` freezes the limits of the records under a folder. Give `--commit` when the runs come from several commits.
- A job is a no read when its A/A spread is above the noise cap, or when its CPU model has no frozen value. A no read is not a pass.
- The gate of a case needs 3 jobs or more that read it. With fewer, the case is a no read. A job above its limit blocks the run.
- Timed runs give valid values only in CI. On a local computer, start only the tests of this folder.
