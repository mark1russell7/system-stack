import { partsById, type Fault, type FaultLevel, type Stack } from "@mark1russell7/system-stack";
import {
  DEFAULT_MODE,
  isHttpsUrl,
  isOpenMode,
  isPath,
  isServiceName,
  isUserName,
  isVariableName,
  literalText,
  MODE_FORM,
  NAME_FORM,
  PACKAGE_FORM,
  PROGRAM_FORM,
  SHA256_FORM,
  SWAP_MIB_LIMIT,
} from "./forms.ts";
import { stepAddress, stepPaths, stepTexts, textParts, type Profile, type SetupLayer, type SetupText, type Step, type Variable } from "./layer.ts";
import { profileOrder, setupHosts } from "./order.ts";

// The gate of the setup layer. A gate with no error tells that the script of each host is safe to write:
// each record has its form, each variable is known, no secret is in a place that each user can read, and the needs have no cycle.

/** These are the codes of the faults of a setup layer. */
export const SETUP_CODES: readonly [
  "setup-name",
  "setup-variable-twice",
  "setup-profile-twice",
  "setup-step-twice",
  "setup-part",
  "setup-host",
  "setup-variable",
  "setup-variable-unused",
  "setup-secret-exposed",
  "setup-text",
  "setup-path",
  "setup-path-twice",
  "setup-user-twice",
  "setup-mode",
  "setup-url",
  "setup-sha256",
  "setup-swap-size",
  "setup-program",
  "setup-empty",
  "setup-cycle",
] = [
  "setup-name",
  "setup-variable-twice",
  "setup-profile-twice",
  "setup-step-twice",
  "setup-part",
  "setup-host",
  "setup-variable",
  "setup-variable-unused",
  "setup-secret-exposed",
  "setup-text",
  "setup-path",
  "setup-path-twice",
  "setup-user-twice",
  "setup-mode",
  "setup-url",
  "setup-sha256",
  "setup-swap-size",
  "setup-program",
  "setup-empty",
  "setup-cycle",
];

/** A code of a fault of a setup layer. */
export type SetupCode = (typeof SETUP_CODES)[number];

/**
 * A fault of a setup layer. Its field `at` is the place of the fault.
 *
 * - For a step, `at` is the address of the step: the name of its profile, a point and its `id`.
 * - For a profile, `at` is the name of the profile.
 * - For a variable, `at` is `var.` and its name.
 * - For a host with no profile, `at` is the `id` of the host.
 */
export interface SetupFault extends Fault {
  readonly code: SetupCode;
  /** The `id` of the host, for a fault of the steps of one host. */
  readonly host?: string | undefined;
}

/** This function gives a list of names for a message, for example `"a", "b"`. */
function names(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}

/** The writer of the faults of one gate. */
interface Faults {
  readonly list: SetupFault[];
  add(level: FaultLevel, code: SetupCode, at: string, message: string, more?: { readonly other?: string; readonly host?: string }): void;
  error(code: SetupCode, at: string, message: string, more?: { readonly other?: string; readonly host?: string }): void;
}

function faultList(): Faults {
  const list: SetupFault[] = [];
  const add: Faults["add"] = (level, code, at, message, more = {}) => {
    list.push({ level, code, at, message, ...more });
  };
  return { list, add, error: (code, at, message, more) => add("error", code, at, message, more) };
}

/** This function examines the first argument of a command: a literal program. */
function checkProgram(faults: Faults, at: string, label: string, command: readonly SetupText[]): void {
  const first = command[0];
  if (first === undefined) {
    faults.error("setup-program", at, `The ${label} command has no argument.`);
    return;
  }
  const program = literalText(first);
  if (program === undefined || !PROGRAM_FORM.test(program)) {
    faults.error("setup-program", at, `The first argument of the ${label} command is not the name or the path of a program. It is a literal with no "=", and it does not start with "-".`);
  }
}

/** This function examines the fields of one step that are not texts. */
function checkStep(faults: Faults, at: string, step: Step): void {
  const mode = (value: string | undefined): void => {
    if (value !== undefined && !MODE_FORM.test(value)) faults.error("setup-mode", at, `The mode "${value}" is not a mode in octal, for example "644".`);
  };
  const path = (value: string, label = "path"): void => {
    if (!isPath(value)) faults.error("setup-path", at, `The ${label} "${value}" is not an absolute path of letters, digits and "._@+-", with no "." or ".." segment.`);
  };
  const user = (value: string | undefined, label: string): void => {
    if (value !== undefined && !isUserName(value)) faults.error("setup-name", at, `The ${label} "${value}" does not have the form of the name of a user or of a group.`);
  };
  switch (step.kind) {
    case "package":
      if (step.names.length === 0) faults.add("warning", "setup-empty", at, "The step names no package.");
      for (const name of step.names) if (!PACKAGE_FORM.test(name)) faults.error("setup-name", at, `The name "${name}" does not have the form of the name of a package.`);
      return;
    case "user":
      user(step.name, "user");
      for (const group of step.groups ?? []) user(group, "group");
      if (step.shell !== undefined) path(step.shell, "shell");
      for (const key of step.keys ?? []) {
        if (key.trim() === "" || /[\0\r\n]/.test(key)) faults.error("setup-text", at, "A key is empty, or it has a line break or the character NUL. Each key is one line of `authorized_keys`.");
      }
      return;
    case "file":
      path(step.path);
      mode(step.mode);
      user(step.owner, "owner");
      user(step.group, "group");
      return;
    case "download":
      // The message does not repeat the address: an address with a password would put the password in a log.
      if (!isHttpsUrl(step.url)) faults.error("setup-url", at, "The address is not an HTTPS address with a host name, and with no user and no password.");
      if (!SHA256_FORM.test(step.sha256)) faults.error("setup-sha256", at, "The SHA-256 is not 64 lowercase hexadecimal digits.");
      path(step.path);
      mode(step.mode);
      return;
    case "swap":
      path(step.path);
      if (!Number.isInteger(step.mib) || step.mib < 1 || step.mib > SWAP_MIB_LIMIT) faults.error("setup-swap-size", at, `The size ${String(step.mib)} MiB is not a whole number from 1 to ${String(SWAP_MIB_LIMIT)}.`);
      return;
    case "service":
      if (!isServiceName(step.name)) faults.error("setup-name", at, `The name "${step.name}" does not have the form of the name of a service, with no ".service".`);
      return;
    case "command":
      checkProgram(faults, at, "run", step.run);
      checkProgram(faults, at, "check", step.check);
      user(step.as, "user");
      return;
  }
}

/**
 * This function tells why a sensitive variable cannot be in a text of a step, or gives `undefined` when it can.
 * A secret can be only in a file that no other user can read.
 */
function secretPlace(step: Step): string | undefined {
  switch (step.kind) {
    case "file": {
      const mode = step.mode ?? DEFAULT_MODE;
      return MODE_FORM.test(mode) && isOpenMode(mode) ? `the mode ${mode} lets each user read the file` : undefined;
    }
    case "service":
      return "each user can read the unit of a service";
    case "command":
      return "each user can read the arguments of a process";
    default:
      return "the step has no place for a secret";
  }
}

/** This function examines the texts of a step: the character NUL and the variables. */
function checkTexts(faults: Faults, at: string, step: Step, variables: ReadonlyMap<string, Variable>, used: Set<string>): void {
  let nul = false;
  for (const text of stepTexts(step)) {
    for (const part of textParts(text)) {
      if (typeof part === "string") {
        nul ||= part.includes("\0");
        continue;
      }
      used.add(part.$var);
      const variable = variables.get(part.$var);
      if (variable === undefined) {
        faults.error("setup-variable", at, `The step reads the variable "${part.$var}", and the layer has no variable with that name.`);
      } else if (variable.sensitive === true) {
        const place = secretPlace(step);
        if (place !== undefined) faults.error("setup-secret-exposed", at, `The step has the sensitive variable "${part.$var}", and ${place}.`);
      }
    }
  }
  if (nul) faults.error("setup-text", at, "A text of the step has the character NUL. An argument of the shell cannot hold it.");
}

/** This function examines the steps of each host together: the paths, the users and the order of the profiles. */
function checkHosts(faults: Faults, layer: SetupLayer, stack: Stack): void {
  for (const host of setupHosts(layer)) {
    const writers = new Map<string, string>();
    const users = new Map<string, string>();
    let swap: string | undefined;
    let fstab: string | undefined;
    for (const profile of layer.profiles) {
      if (!profile.hosts.includes(host)) continue;
      for (const step of profile.steps) {
        const at = stepAddress(profile, step);
        for (const path of stepPaths(step)) {
          const first = writers.get(path);
          if (first === undefined) writers.set(path, at);
          else faults.error("setup-path-twice", at, `The steps "${first}" and "${at}" both write "${path}" on the host "${host}".`, { other: first, host });
          if (path === "/etc/fstab") fstab ??= at;
        }
        if (step.kind === "swap") swap ??= at;
        if (step.kind === "user") {
          const first = users.get(step.name);
          if (first === undefined) users.set(step.name, at);
          else faults.error("setup-user-twice", at, `The steps "${first}" and "${at}" both set up the user "${step.name}" on the host "${host}".`, { other: first, host });
        }
      }
    }
    if (swap !== undefined && fstab !== undefined) {
      faults.error("setup-path-twice", fstab, `The step writes "/etc/fstab", and the swap step "${swap}" adds a line to it on the host "${host}".`, { other: swap, host });
    }
    for (const cycle of profileOrder(layer, stack, host).cycles) {
      faults.error("setup-cycle", cycle[0] ?? host, `On the host "${host}", the needs of the parts of the profiles ${names(cycle)} make a cycle.`, { host });
    }
  }
}

/** This function examines a profile and its steps. */
function checkProfile(faults: Faults, profile: Profile, parts: ReadonlyMap<string, unknown>, variables: ReadonlyMap<string, Variable>, used: Set<string>): void {
  if (!NAME_FORM.test(profile.name)) faults.error("setup-name", profile.name, `The name of the profile "${profile.name}" does not have the form of a name: letters, digits, "_" and "-".`);
  if (!parts.has(profile.part)) faults.error("setup-part", profile.name, `The part "${profile.part}" of the profile is not a part of the stack.`);
  if (profile.hosts.length === 0) faults.error("setup-host", profile.name, "The profile names no host.");
  for (const host of profile.hosts) if (!parts.has(host)) faults.error("setup-host", profile.name, `The host "${host}" of the profile is not a part of the stack.`, { host });
  if (profile.steps.length === 0) faults.add("warning", "setup-empty", profile.name, "The profile has no step.");
  const ids = new Set<string>();
  for (const step of profile.steps) {
    const at = stepAddress(profile, step);
    if (!NAME_FORM.test(step.id)) faults.error("setup-name", at, `The id of the step "${step.id}" does not have the form of a name: letters, digits, "_" and "-".`);
    if (ids.has(step.id)) faults.error("setup-step-twice", at, `The profile "${profile.name}" has two steps with the id "${step.id}".`);
    ids.add(step.id);
    checkStep(faults, at, step);
    checkTexts(faults, at, step, variables, used);
  }
}

/**
 * This function gives each fault of a setup layer for a stack. A list with no error tells that the gate passes.
 *
 * The errors:
 * - `setup-name`: the name of a profile, a variable, a user, a group, a service or a package does not have its form. Or the `id` of a step does not have its form.
 * - `setup-variable-twice`, `setup-profile-twice`, `setup-step-twice`: two records have one name.
 * - `setup-part`: the part of a profile is not a part of the stack.
 * - `setup-host`: a profile names no host, or a host that is not a part of the stack.
 * - `setup-variable`: a text reads a variable that the layer does not have.
 * - `setup-secret-exposed`: a sensitive variable is in a unit, in a command, or in a file that each user can read.
 * - `setup-text`: a text has the character NUL, or a key is not one line.
 * - `setup-path`: a path is not an absolute path of the safe characters.
 * - `setup-path-twice`: two steps of one host write one path.
 * - `setup-user-twice`: two steps of one host set up one user.
 * - `setup-mode`, `setup-url`, `setup-sha256`, `setup-swap-size`: a mode, an address, a SHA-256 or a size does not have its form.
 * - `setup-program`: a command is empty, or its first argument is not a literal program.
 * - `setup-cycle`: the needs of the parts of the profiles of one host make a cycle.
 *
 * The warnings:
 * - `setup-variable-unused`: no step reads a variable.
 * - `setup-empty`: a profile has no step, or a package step names no package.
 *
 * @param layer - The setup layer.
 * @param stack - The stack. Its parts and their needs give the hosts and the order.
 * @returns The faults.
 */
export function checkSetup(layer: SetupLayer, stack: Stack): SetupFault[] {
  const faults = faultList();
  const parts = partsById(stack);
  const variables = new Map<string, Variable>();
  for (const variable of layer.variables ?? []) {
    const at = `var.${variable.name}`;
    if (!isVariableName(variable.name)) faults.error("setup-name", at, `The name "${variable.name}" does not have the form of a variable: capital letters, digits and "_", with a letter first, and not a name of the shell.`);
    if (variables.has(variable.name)) faults.error("setup-variable-twice", at, `The layer has two variables with the name "${variable.name}".`);
    else variables.set(variable.name, variable);
  }
  const used = new Set<string>();
  const profiles = new Set<string>();
  for (const profile of layer.profiles) {
    if (profiles.has(profile.name)) faults.error("setup-profile-twice", profile.name, `The layer has two profiles with the name "${profile.name}".`);
    profiles.add(profile.name);
    checkProfile(faults, profile, parts, variables, used);
  }
  for (const variable of variables.values()) {
    if (!used.has(variable.name)) faults.add("warning", "setup-variable-unused", `var.${variable.name}`, `No step reads the variable "${variable.name}".`);
  }
  checkHosts(faults, layer, stack);
  return faults.list;
}

/** This function tells if a list of faults has an error. */
export function hasSetupError(faults: readonly SetupFault[]): boolean {
  return faults.some((fault) => fault.level === "error");
}
