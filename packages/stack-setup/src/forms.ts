import { textParts, type SetupText } from "./layer.ts";

// The forms of the values of a setup layer. The gate and the script use them. The root entry does not export this module.

/** The form of the name of a profile and of the `id` of a step. */
export const NAME_FORM: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The form of the name of a variable. */
export const VARIABLE_FORM: RegExp = /^[A-Z][A-Z0-9_]*$/;

/** These names belong to the shell, to the login or to `sudo`. A variable of a layer cannot have them. */
export const SHELL_NAMES: readonly string[] = [
  "BASH_ENV",
  "CDPATH",
  "DEBIAN_FRONTEND",
  "ENV",
  "HISTFILE",
  "HOME",
  "IFS",
  "LANG",
  "LANGUAGE",
  "LINENO",
  "LOGNAME",
  "MAIL",
  "MAILPATH",
  "OLDPWD",
  "OPTARG",
  "OPTIND",
  "PATH",
  "PPID",
  "PS1",
  "PS2",
  "PS4",
  "PWD",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
];

/** These prefixes belong to the locale or to `sudo`. A variable of a layer cannot start with them. */
export const SHELL_PREFIXES: readonly string[] = ["LC_", "SUDO_"];

/** The form of the name of a user or of a group. */
export const USER_FORM: RegExp = /^[a-z_][a-z0-9_-]*\$?$/;

/** The largest length of the name of a user or of a group. */
export const USER_LENGTH = 32;

/** The form of the name of a service of systemd, with no `.service`. */
export const SERVICE_FORM: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** The form of the name of an `apt` package. */
export const PACKAGE_FORM: RegExp = /^[a-z0-9][a-z0-9+.-]+$/;

/** The characters of a path. */
export const PATH_FORM: RegExp = /^\/[A-Za-z0-9._@+/-]+$/;

/** The form of a mode in octal. */
export const MODE_FORM: RegExp = /^[0-7]{3,4}$/;

/** The form of a SHA-256. */
export const SHA256_FORM: RegExp = /^[0-9a-f]{64}$/;

/** The form of a program, the first argument of a command. It has no `=`, and it does not start with `-`. */
export const PROGRAM_FORM: RegExp = /^[A-Za-z0-9_./+][A-Za-z0-9_./+-]*$/;

/** The characters of an address: printable ASCII with no space. */
export const URL_FORM: RegExp = /^[\x21-\x7e]+$/;

/** The mode of a file and of a download when a step has none. */
export const DEFAULT_MODE = "644";

/** The login shell of a user when a step has none. */
export const DEFAULT_SHELL = "/bin/bash";

/** The largest size of a swap file in MiB. */
export const SWAP_MIB_LIMIT = 65536;

/** This function tells if a text is the name of a variable that a layer can have. */
export function isVariableName(name: string): boolean {
  return VARIABLE_FORM.test(name) && !SHELL_NAMES.includes(name) && !SHELL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** This function tells if a text is the name of a user or of a group. */
export function isUserName(name: string): boolean {
  return name.length <= USER_LENGTH && USER_FORM.test(name);
}

/** This function tells if a text is the name of a service. The name has no `.service` at its end. */
export function isServiceName(name: string): boolean {
  return SERVICE_FORM.test(name) && !name.endsWith(".service");
}

/** This function tells if a text is an absolute path with no `.` or `..` segment, no `//` and no `/` at its end. */
export function isPath(path: string): boolean {
  if (!PATH_FORM.test(path) || path.endsWith("/") || path.includes("//")) return false;
  return path
    .split("/")
    .slice(1)
    .every((segment) => segment !== "." && segment !== "..");
}

/** The form of the host of an address, with an optional port. It has no user and no password. */
export const HOST_FORM: RegExp = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?$/;

/**
 * This function tells if a text is an HTTPS address: `https://`, a host name with an optional port, and an optional path.
 * An address with a user or a password is not an HTTPS address of a layer, because the script shows each address.
 */
export function isHttpsUrl(url: string): boolean {
  if (!URL_FORM.test(url) || !url.startsWith("https://")) return false;
  const rest = url.slice("https://".length);
  const end = rest.search(/[/?#]/);
  return HOST_FORM.test(end === -1 ? rest : rest.slice(0, end));
}

/** This function gives a mode in the form of `stat -c %a`: octal digits with no zero at the start, for example `644`. */
export function modeText(mode: string): string {
  return Number.parseInt(mode, 8).toString(8);
}

/** This function tells if a mode lets each user of the host read the file. The mode has the form `MODE_FORM`. */
export function isOpenMode(mode: string): boolean {
  // The last octal digit is the access of the other users.
  return Number.parseInt(mode, 8) % 8 !== 0;
}

/** This function gives the text of a literal: the joined parts, or `undefined` when a part is a variable. */
export function literalText(text: SetupText): string | undefined {
  let literal = "";
  for (const part of textParts(text)) {
    if (typeof part !== "string") return undefined;
    literal += part;
  }
  return literal;
}
