// The records of the setup add-on. They are one layer of a stack, with the key `setup/1` in `Stack.layers`.
// Each record tells a step of the setup inside a host: a package, a user, a file, a download, a swap file, a service or a command.
// The add-on knows no provider and no cloud. The host is a part of the stack, and the steps are data.

/** The name of the format of a setup layer. It is the key of the layer in `Stack.layers`. */
export const SETUP_SCHEMA = "setup/1";

/** A value that the script reads from its environment at its start, for example a key. No record holds its value. */
export interface VariableRead {
  /** The name of a variable of the layer. */
  readonly $var: string;
}

/**
 * A text of a step.
 *
 * - A string is literal. The script quotes it, so the shell expands nothing in it.
 * - `{ "$var": "NAME" }` is the value of a variable of the layer, from the environment when the script runs.
 * - A list joins its parts into one text, for example `["token=", { "$var": "TOKEN" }, "\n"]`.
 */
export type SetupText = string | VariableRead | readonly (string | VariableRead)[];

/** A variable of the layer. A person or a program gives its value in the environment of the script. A variable has no default. */
export interface Variable {
  /** The name: capital letters, digits and `_`, with a letter first. The script itself uses only lowercase names. */
  readonly name: string;
  /** `true`: the value is a secret. The gate refuses it in a file that each user can read, and in a unit of a service. */
  readonly sensitive?: boolean | undefined;
  readonly description?: string | undefined;
}

/** The fields of each step. */
interface StepBase {
  /** The name of the step in its profile. The address of a step is the name of the profile, a point and this name. */
  readonly id: string;
  readonly description?: string | undefined;
}

/** Packages of the system package manager. The step installs each package that is not installed. */
export interface PackageStep extends StepBase {
  readonly kind: "package";
  /** The package manager. Only `apt` is known. */
  readonly manager: "apt";
  /** The names of the packages. */
  readonly names: readonly string[];
}

/** A user account of the host. */
export interface UserStep extends StepBase {
  readonly kind: "user";
  /** The login name. */
  readonly name: string;
  /** The extra groups of the user. Each group exists before the step. The step adds the user to each group, and removes none. */
  readonly groups?: readonly string[] | undefined;
  /** The login shell. The default is `/bin/bash`. */
  readonly shell?: string | undefined;
  /**
   * The public SSH keys, each one a line of `authorized_keys`. The step writes the file with these keys only.
   * With no field, the step does not change the file.
   */
  readonly keys?: readonly string[] | undefined;
}

/** A file with a text. The step writes the file when its text, its mode or its owner is different. */
export interface FileStep extends StepBase {
  readonly kind: "file";
  /** The absolute path. */
  readonly path: string;
  /** The text of the file. */
  readonly text: SetupText;
  /** The mode in octal, for example `644`. The default is `644`. */
  readonly mode?: string | undefined;
  /** The user that owns the file. The default is `root`. */
  readonly owner?: string | undefined;
  /** The group that owns the file. The default is `root`. */
  readonly group?: string | undefined;
}

/** A file from an HTTPS address, with its checksum. The step keeps a file only when its SHA-256 agrees. */
export interface DownloadStep extends StepBase {
  readonly kind: "download";
  /** The HTTPS address of the file. */
  readonly url: string;
  /** The SHA-256 of the file, as 64 lowercase hexadecimal digits. */
  readonly sha256: string;
  /** The absolute path. */
  readonly path: string;
  /** The mode in octal. The default is `644`. */
  readonly mode?: string | undefined;
}

/** A swap file. The step makes the file, turns it on and adds it to `/etc/fstab`. */
export interface SwapStep extends StepBase {
  readonly kind: "swap";
  /** The absolute path. */
  readonly path: string;
  /** The size in MiB, from 1 to 65536. */
  readonly mib: number;
}

/** A service of systemd. The step writes its unit, and starts the service at each boot. */
export interface ServiceStep extends StepBase {
  readonly kind: "service";
  /** The name of the unit with no `.service`, for example `example-runtime`. */
  readonly name: string;
  /** The text of the unit file. Each user can read a unit, so it reads no secret. */
  readonly unit: SetupText;
  /** `false`: the step writes the unit only. The default is `true`: the service starts with the script and at each boot. */
  readonly enable?: boolean | undefined;
}

/**
 * A command with its check. The step starts `run` only when `check` fails, and then `check` must pass.
 * Each command is a list of arguments, with no shell. The first argument is a literal program.
 */
export interface CommandStep extends StepBase {
  readonly kind: "command";
  /** The command that makes the change. */
  readonly run: readonly SetupText[];
  /** The command that tells if the change is there: exit code 0 tells that it is. */
  readonly check: readonly SetupText[];
  /** The user of the two commands. The default is `root`. */
  readonly as?: string | undefined;
}

/** A step of the setup. */
export type Step = PackageStep | UserStep | FileStep | DownloadStep | SwapStep | ServiceStep | CommandStep;

/** The kinds of a step. */
export const STEP_KINDS: readonly ["package", "user", "file", "download", "swap", "service", "command"] = ["package", "user", "file", "download", "swap", "service", "command"];

/** A kind of a step. */
export type StepKind = Step["kind"];

/**
 * The setup of one part of the stack on its hosts, as steps in order.
 * The setup of a host has the steps of each profile of the host. A profile comes after each profile whose part its part needs.
 */
export interface Profile {
  /** The name of the profile. */
  readonly name: string;
  /** The `id` of the part of the stack that the steps set up, for example a runtime. */
  readonly part: string;
  /** The `id` of each host part that runs the steps. A host can be the part itself. */
  readonly hosts: readonly string[];
  /** The steps, in order. */
  readonly steps: readonly Step[];
}

/** The setup layer of a stack. */
export interface SetupLayer {
  readonly schema: typeof SETUP_SCHEMA;
  readonly variables?: readonly Variable[] | undefined;
  readonly profiles: readonly Profile[];
}

/** This function gives the address of a step: the name of its profile, a point and its `id`. */
export function stepAddress(profile: Profile, step: Step): string {
  return `${profile.name}.${step.id}`;
}

/** This function tells if a value is a variable read: an object with a text field `$var` that is not a list. */
export function isVariableRead(value: unknown): value is VariableRead {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { readonly $var?: unknown }).$var === "string";
}

/** This function gives the parts of a text: each string and each variable read, in order. */
export function textParts(text: SetupText): readonly (string | VariableRead)[] {
  if (typeof text === "string" || isVariableRead(text)) return [text];
  return text;
}

/** This function gives the names of the variables that a text reads, in order, with no repeat. */
export function textVariables(text: SetupText): string[] {
  const names: string[] = [];
  for (const part of textParts(text)) if (typeof part !== "string" && !names.includes(part.$var)) names.push(part.$var);
  return names;
}

/** This function gives each text of a step, for a walk over its variables. */
export function stepTexts(step: Step): readonly SetupText[] {
  switch (step.kind) {
    case "file":
      return [step.text];
    case "service":
      return [step.unit];
    case "command":
      return [...step.run, ...step.check];
    default:
      return [];
  }
}

/** This function gives the paths that a step writes. Two steps of one host cannot write one path. */
export function stepPaths(step: Step): string[] {
  switch (step.kind) {
    case "file":
    case "download":
    case "swap":
      return [step.path];
    case "service":
      return [unitPath(step.name)];
    default:
      return [];
  }
}

/** This function gives the path of the unit file of a service. */
export function unitPath(name: string): string {
  return `/etc/systemd/system/${name}.service`;
}
