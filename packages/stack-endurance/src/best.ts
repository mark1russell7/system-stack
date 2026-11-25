import { type Objective, solveLexicographic } from "@mark1russell7/linear";
import { add, div, equals, mul, neg, ONE, type Rational, sign, sub, toNumber, ZERO } from "@mark1russell7/rational";
import { type CaseOptions, caseDraws, caseStopped, drawDemand, storeAmounts } from "./endurance.ts";
import type { CaseCuts, Converter, Draw, DrawEndurance, Endurance, EnduranceLayer } from "./layer.ts";
import { type CaseParts, caseParts, deviceUse, drawBlock, type DrawBlock, fewestRow, Program, reachOf, valueAt } from "./program.ts";
import { addTo, dense, exact, type Row } from "./rows.ts";

// The best endurance: the days of each draw with the best share of the stores, the most important level first.
// Each step is a linear program over the totals of the spans, with exact rationals (@mark1russell7/linear).

/** A draw whose days are fixed. */
interface Fixed {
  /** The span of the draw in the programs: its days, or 1 for a draw with no end. */
  readonly span: Rational;
  /** True for a draw that holds without end. It takes no stock, and its span is one day. */
  readonly endless: boolean;
  /** The device-days of each day that the draw keeps, by the key of the device. */
  readonly keep: ReadonlyMap<string, Rational>;
  /** The `id` of each converter whose limit stops more runs at the step that fixes the draw. */
  readonly capped: readonly string[];
}

/** A program of one step, with the indexes of its parts. */
interface Step {
  readonly program: Program;
  readonly blocks: readonly DrawBlock[];
  /** The column of the common days of the open draws. */
  readonly floor: number;
  /** The row `days - floor >= 0` of each open draw, by the code of its need. */
  readonly floors: ReadonlyMap<string, number>;
  /** The run columns of the open draws. */
  readonly openRuns: readonly (readonly [Converter, number])[];
  /** The device-days of the open draws for each device, with the device-days of each day that the fixed draws leave. */
  readonly shared: ReadonlyMap<string, { readonly row: Row; readonly room: Rational; readonly converters: readonly Converter[] }>;
}

/**
 * This function gives the days that each draw holds when a case stops its supply. The stores and the devices have their best share.
 * The result has the form of `enduranceOf`, so `caseShortfall` takes it.
 *
 * The share is lexicographic. The draws of the first level get their best days, then the draws of the next level get theirs, and so on.
 * In one level, the share is the best for the draw with the fewest days, then for the next draw, and so on (the leximin share).
 * Thus a draw of a level cannot take a store that another draw of the level needs more.
 *
 * - The function solves a sequence of linear programs over the totals of the spans. Each program has the days of the open draws
 *   and their common floor. For each draw, it has the take of each direct use, the runs of each converter and the share of each stock.
 * - Each step takes the largest floor. A draw whose floor row has a dual value that is not 0 cannot get more days. The step fixes its days.
 *   The dual values of the floor rows add to 1, so each step fixes one draw or more.
 * - A fixed draw keeps its days in each later step. Its share of the stocks can change, so a later draw can get a store that it does not need.
 * - The stores, the direct uses, the converters and the devices follow the rules of `jointDays`. A store counts with all of its amount when its due date is after `at`.
 * - A fixed draw keeps the device-days of each day that it uses at its step, for all the days of the later draws. This is the safe side, as in `enduranceOf`.
 *   The exact share of a device between two spans is not a linear program: the device-days of a day are the runs over the span.
 * - A step with no largest floor gives the open draws no end. Each of them takes no stock, and keeps the fewest device-days of each day.
 * - At the end, a program takes the smallest sum of the shares of the stocks, each over its stock, then the fewest device-days.
 *   These are the takes of the result. A resource in `binding` has no stock left at this point.
 * - A draw in `capped` used a device with no device-days left at the step that fixed it.
 *
 * The programs use exact rationals, so the result has no error of the method. Only the change back to a number rounds.
 * The fewest days of the first level are the joint days (`jointDays`) of the draws of that level.
 *
 * @param layer - The endurance layer
 * @param caseCuts - The case
 * @param options - The date, and the stack or the parts that are also down
 * @returns The endurance of each draw whose supply stops
 * @throws {RangeError} A date is not `YYYY-MM-DD`.
 */
export function bestEndurance(layer: EnduranceLayer, caseCuts: CaseCuts, options: CaseOptions): Endurance {
  const stoppedParts = caseStopped(caseCuts, options);
  const stock = storeAmounts(layer, options.at, stoppedParts);
  const draws = caseDraws(layer, caseCuts, stoppedParts);
  const parts = caseParts(layer, stoppedParts, stock, new Set(draws.map((draw) => draw.need)));
  // The count of devices of each key. The gate refuses two counts for one device.
  const devices = new Map([...deviceUse([...parts.cooks, ...parts.makers].map((converter) => [converter, 0] as const)).limits].map(([key, limit]) => [key, limit.devices] as const));
  const fixed = new Map<string, Fixed>();

  for (const level of levelGroups(layer, draws)) {
    let open = level;
    while (open.length > 0) {
      const step = buildStep(parts, caseCuts, draws, fixed, open, devices, "span");
      const solved = solveLexicographic(step.program.constraints(), [
        { sense: "max", coefficients: dense(new Map([[step.floor, ONE]]), step.program.count) },
        { sense: "min", coefficients: dense(fewestRow(step.openRuns), step.program.count) },
      ]);
      if (solved.status !== "optimal") {
        if (solved.status === "infeasible") throw new Error("The step of the best endurance has no point. The point of the last step is a point of it.");
        fixEndless(parts, caseCuts, draws, fixed, open, devices);
        break;
      }
      const floor = solved.values[0] ?? ZERO;
      const first = solved.stages[0]?.result;
      const dual = first?.status === "optimal" ? first.dual : [];
      let done = open.filter((draw) => sign(dual[step.floors.get(draw.need) as number] ?? ZERO) !== 0);
      // The dual values of the floor rows add to 1. Thus `done` is not empty. The fallback fixes each open draw at the floor.
      if (done.length === 0) done = open;
      const full = new Set([...step.shared].filter(([, limit]) => equals(valueAt(limit.row, solved.x), mul(limit.room, floor))).map(([key]) => key));
      for (const draw of done) {
        const block = step.blocks.find((item) => item.draw.need === draw.need) as DrawBlock;
        const keep = new Map<string, Rational>();
        for (const [key, limit] of deviceUse(block.runs).limits) keep.set(key, sign(floor) > 0 ? div(valueAt(limit.row, solved.x), floor) : ZERO);
        const { reach } = reachOf(parts, new Set([draw.need]));
        const capped = sign(floor) > 0
          ? [...reach]
              .filter((converter) => converter.perDay !== undefined && (!(converter.perDay > 0) || [...full].some((key) => step.shared.get(key)?.converters.includes(converter))))
              .map((converter) => converter.id)
              .sort()
          : [];
        fixed.set(draw.need, { span: floor, endless: false, keep, capped });
      }
      const fixedNow = new Set(done.map((draw) => draw.need));
      open = open.filter((draw) => !fixedNow.has(draw.need));
    }
  }

  const needs: Record<string, DrawEndurance> = {};
  if (draws.length === 0) return { case: caseCuts.case, at: options.at, needs };
  const last = buildStep(parts, caseCuts, draws, fixed, [], devices, "span");
  const least: Row = new Map();
  for (const block of last.blocks) for (const [resource, index] of block.shares) addTo(least, index, div(ONE, exact(stock.get(resource) ?? 1)));
  const objectives: Objective[] = [
    { sense: "min", coefficients: dense(least, last.program.count) },
    { sense: "min", coefficients: dense(fewestRow(last.blocks.flatMap((block) => [...block.runs])), last.program.count) },
  ];
  const solved = solveLexicographic(last.program.constraints(), objectives);
  if (solved.status !== "optimal") throw new Error("The last program of the best endurance has no optimum. The point of the last step is a point of it.");
  const withStore = new Set(layer.stores.map((store) => store.resource));
  for (const block of last.blocks) {
    const need = block.draw.need;
    const fix = fixed.get(need) as Fixed;
    if (fix.endless) {
      needs[need] = { days: Infinity, binding: [], takes: {} };
      continue;
    }
    const takes: Record<string, number> = {};
    for (const [resource, index] of block.shares) if (sign(solved.x[index] ?? ZERO) > 0) takes[resource] = toNumber(solved.x[index] ?? ZERO);
    const { closure } = reachOf(parts, new Set([need]));
    const binding = [...closure]
      .filter((resource) => withStore.has(resource))
      .filter((resource) => {
        // A resource with no live stock has no share, so its take is 0 and it is used up.
        const taken = last.blocks.reduce((sum, item) => {
          const index = item.shares.get(resource);
          return index === undefined ? sum : add(sum, solved.x[index] ?? ZERO);
        }, ZERO);
        return equals(taken, exact(stock.get(resource) ?? 0));
      })
      .sort();
    const days = toNumber(fix.span);
    needs[need] = fix.capped.length === 0 ? { days, binding, takes } : { days, binding, takes, capped: fix.capped };
  }
  return { case: caseCuts.case, at: options.at, needs };
}

/** This function gives the draws of each level, in the order of `levels`. The draws of a level that is not in `levels` come last, together. */
function levelGroups(layer: EnduranceLayer, draws: readonly Draw[]): Draw[][] {
  const rank = (draw: Draw): number => {
    const index = layer.levels.indexOf(draw.level);
    return index < 0 ? layer.levels.length : index;
  };
  const out: Draw[][] = [];
  let previous = -1;
  for (const draw of draws) {
    if (rank(draw) !== previous) out.push([]);
    previous = rank(draw);
    out[out.length - 1]?.push(draw);
  }
  return out;
}

/**
 * This function gives the program of one step. The fixed draws keep their spans and their device-days. The open draws have a common floor.
 *
 * - With `"span"`, each open draw has a column of its days, not less than the floor. Its runs share the device-days that the fixed draws leave, for the floor.
 *   The device-days of each day are the runs over the span. A span not less than the floor uses fewer of them, so this is the safe side.
 * - With `"day"`, each open draw has a span of one day and takes no stock. Its runs share the device-days of one day.
 */
function buildStep(
  parts: CaseParts,
  caseCuts: CaseCuts,
  draws: readonly Draw[],
  fixed: ReadonlyMap<string, Fixed>,
  open: readonly Draw[],
  devices: ReadonlyMap<string, number>,
  mode: "span" | "day",
): Step {
  const program = new Program();
  const floor = program.next();
  const opened = new Set(open.map((draw) => draw.need));
  const blocks: DrawBlock[] = [];
  const floors = new Map<string, number>();
  const openRuns: (readonly [Converter, number])[] = [];
  const kept = new Map<string, Rational>();
  for (const draw of draws) {
    const fix = fixed.get(draw.need);
    if (fix === undefined && !opened.has(draw.need)) continue;
    const endless = fix?.endless ?? mode === "day";
    const block = drawBlock(program, parts, draw, !endless);
    blocks.push(block);
    const demand = exact(drawDemand(draw, caseCuts));
    const need: Row = new Map(block.gifts);
    if (fix !== undefined) {
      program.push(need, ">=", mul(demand, fix.span));
      const { limits, stopped } = deviceUse(block.runs);
      for (const index of stopped) program.push(new Map([[index, ONE]]), "<=", ZERO);
      for (const [key, limit] of limits) program.push(limit.row, "<=", mul(fix.keep.get(key) ?? ZERO, fix.span));
      for (const [key, value] of fix.keep) kept.set(key, add(kept.get(key) ?? ZERO, value));
      continue;
    }
    openRuns.push(...block.runs);
    if (mode === "day") {
      program.push(need, ">=", demand);
      continue;
    }
    const days = program.next();
    addTo(need, days, neg(demand));
    program.push(need, ">=", ZERO);
    floors.set(draw.need, program.push(new Map([[days, ONE], [floor, neg(ONE)]]), ">=", ZERO));
  }
  const shared = new Map<string, { row: Row; room: Rational; converters: readonly Converter[] }>();
  const { limits, stopped } = deviceUse(openRuns);
  for (const index of stopped) program.push(new Map([[index, ONE]]), "<=", ZERO);
  for (const [key, limit] of limits) {
    const left = sub(exact(devices.get(key) ?? limit.devices), kept.get(key) ?? ZERO);
    const room = sign(left) > 0 ? left : ZERO;
    shared.set(key, { row: limit.row, room, converters: limit.converters });
    if (mode === "day") {
      program.push(limit.row, "<=", room);
      continue;
    }
    const row: Row = new Map(limit.row);
    addTo(row, floor, neg(room));
    program.push(row, "<=", ZERO);
  }
  for (const resource of parts.stocked) {
    const row: Row = new Map();
    for (const block of blocks) {
      const index = block.shares.get(resource);
      if (index !== undefined) addTo(row, index, ONE);
    }
    if (row.size > 0) program.push(row, "<=", exact(parts.stock.get(resource) ?? 0));
  }
  return { program, blocks, floor, floors, openRuns, shared };
}

/**
 * This function fixes the open draws with no end. Each open draw takes no stock, and keeps the fewest device-days of each day.
 * A step with no largest floor has a direction with no take of a stock, so this program has a point.
 */
function fixEndless(parts: CaseParts, caseCuts: CaseCuts, draws: readonly Draw[], fixed: Map<string, Fixed>, open: readonly Draw[], devices: ReadonlyMap<string, number>): void {
  const step = buildStep(parts, caseCuts, draws, fixed, open, devices, "day");
  const solved = solveLexicographic(step.program.constraints(), [{ sense: "min", coefficients: dense(fewestRow(step.openRuns), step.program.count) }]);
  if (solved.status !== "optimal") throw new Error("The draws with no end of the best endurance have no point of one day.");
  for (const draw of open) {
    const block = step.blocks.find((item) => item.draw.need === draw.need) as DrawBlock;
    const keep = new Map<string, Rational>();
    for (const [key, limit] of deviceUse(block.runs).limits) keep.set(key, valueAt(limit.row, solved.x));
    fixed.set(draw.need, { span: ONE, endless: true, keep, capped: [] });
  }
}
