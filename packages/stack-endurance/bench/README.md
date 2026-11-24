# The bench of independentStop

Up to 12 cuts in the minimal sets, `independentStop` sums `2^m` states at each point, for `m` cuts. This folder measures this cost at 4, 8 and 12 cuts. Past 12 cuts, `independentStop` uses the Shannon expansion of `pathSetReliability`. The case of 14 cuts measures that cost. It is in the default budget `INDEPENDENT_MAX_WORK`, and 15 cuts are too. At 16 cuts, the expansion has 17662 steps, and the budget refuses it.

- Each input has a fixed seed (`BENCH_SEED`). Each cut is in a minimal set, so a state has `m` bits.
- The workflow `bench.yml` starts 6 jobs in CI. Each job has 20 rounds: 4 times the count of arms (`JOB_ROUNDS`). Each job times each case in fresh child processes with `freshArms` of `@mark1russell7/rigor-bench`.
- The value of a case in a job is the median time of one call over the children of its arm.
- An A/A arm repeats the case of 12 cuts. Its spread is the noise of the job.
- `limits.json` keeps the frozen limit of each case, with its values, the commit and the date. The rule is `runLimit`: the worst value of 5 runs or more plus their spread.
- The runners of CI have different CPU models. The frozen limits hold 78 jobs of 13 runs on 7 CPU models, from two days. The timed code of the 8 commits of these runs is the same.
- Each CPU model with jobs of 5 runs or more has its own limit: `runLimit` of the values of its jobs (`modelTables`). The gate takes the limit of the exact CPU name of a job.
- The other models of the freeze get the ceiling: the limit over all the jobs. A read at the ceiling has the note of `limitOnModel`. It stops only a large regression, and it does not hold a gain.
- At 12 cuts, the limit of the EPYC 7763 is 1.05 times its median value. Its group limit is 1.015 times that median. The ceiling is 1.68 times that median.
- The limits of the first day blocked 1 of 19 jobs of the second day on a model with its own limit. The job was above on 2 cases, by 0.07% and 0.26%. The limits of the second day blocked no job of the first day.
- A freeze of 60 jobs blocked 1 of 6 jobs of a later run with the same timed code. That job on the Xeon 6975P-C was above by 1.5% at 4 cuts and 1.9% at 14 cuts. The 2 other jobs of that model in the run were 11% to 13% under the limit at 14 cuts. The freeze of 78 jobs holds this run, so the limit of the 6975P-C at 14 cuts is 1.36 times its median. Its group limit is 1.15 times its median.
- The jobs on the 9V45 have two levels at 12 cuts: 31 ms, and 34 to 35 ms. The jobs on the 8573C have two levels too. The record of a job has no field that tells the two machine kinds apart, so the limit of a model holds its two levels.
- `node bench/main.ts read --in <folder> --freeze <file> --commit <sha>` freezes the limits of the records under a folder. Give `--commit` when the runs come from several commits. Each job of the file keeps its run and the commit that it timed.
- A limit of a model is near the noise of its jobs, so a block can come from noise. When a commit changes no timed code, freeze again with the records of the whole run. Do it in a pull request. The rule then widens a limit only by a value of CI.
- When a commit changes the timed code, a block is a finding. Find the cause before you change a limit.
- At these margins, the gate cannot tell a slowdown of 1.5% from a change of the runners. So, on the same day, start the bench of the base commit. If the base blocks too, freeze again from that run, then read the pull request again.
- A job is a no read when its A/A spread is above the noise cap, or when its CPU model has no frozen value. A no read is not a pass.
- The gate of a case needs 3 jobs or more that read it. With fewer, the case is a no read.
- The jobs of one CPU model in one run time one commit on one kind of runner. On the limit of their model, they make one group (`groupCases`).
- A group blocks the run only when its lowest value is above the limit. A change of the code makes each job of the group slower, so the lowest value shows it. One slow machine makes one job slower, and the group stays within.
- A group of 2 jobs or more reads against the group limit of its model (`groupTables`). It is `runLimit` of the lowest value of each run of the model in the freeze.
- `limits.json` keeps each group limit with its runs. `limitFaults` computes each group limit again from the jobs of the file.
- One slow machine in a run of the freeze widens the limit of one job by 2 times its excess. In a run of 2 jobs or more, the group limit stays the same, because the other jobs of its run give the lowest value.
- A lone slow job in a run of the freeze widens the group limit too, because its value is the lowest value of its run. In the current freeze, lone jobs give the highest lowest value of the EPYC 7763 at each case.
- A group of 1 job reads against the limit of one job. Its only value is its lowest value, so its limit must hold the slow machines of the freeze.
- A job at the ceiling is a group of its own. A job with a no read is not in a group, so its value does not keep a group within.
- Each job keeps its own outcome against the limit of one job. The report gives it in the column "Gate of the job alone". The gate of the run reads the groups.
- The report shows each group with a lowest value at 97% of its limit or more. It also shows each group with a job beyond the limit of one job.
- A commit can change the timed code, and the rule of one job can give beyond. In that case, read the table of groups before the merge.
- We read each run with a freeze of the 12 other runs. The groups blocked no run. The rule of one job blocked 1 of 13 runs: the run with the slow 6975P-C job.
- With one run out, the median uniform slowdown that blocks a run is 1.8%. The least is 1.0%, and the most is 4.9%. With only the limits of one job, these values were 2.9%, 1.9% and 5.1%.
- A slowdown of 2% blocks 11 of the 13 runs. With only the limits of one job, it blocked 1 run. The 2 other runs have only groups of 1 job on the EPYC 7763 and the 6975P-C.
- Timed runs give valid values only in CI. On a local computer, start only the tests of this folder.
