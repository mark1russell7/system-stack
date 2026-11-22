import type { Stack } from "@mark1russell7/system-stack";
import { escapeShell } from "@mark1russell7/text/shell";
import { checkSetup, hasSetupError, type SetupFault } from "./check.ts";
import { DEFAULT_MODE, DEFAULT_SHELL, modeText } from "./forms.ts";
import {
  changesAptSources,
  stepAddress,
  stepTexts,
  textParts,
  textVariables,
  unitPath,
  SETUP_SCHEMA,
  type ArchiveStep,
  type CommandStep,
  type DownloadStep,
  type FileStep,
  type PackageStep,
  type ServiceStep,
  type SetupLayer,
  type SetupText,
  type Step,
  type SwapStep,
  type UserStep,
} from "./layer.ts";
import { profileOrder } from "./order.ts";

// The generator of the setup script of one host. The script is POSIX `sh`, and each step checks before it changes:
// a step with a passing check changes nothing. A second run of the script thus shows no change.
// The script holds no value of a variable. It reads each value from its environment when it runs.

/** The exit codes of a setup script. */
export const SETUP_EXIT: { readonly ok: 0; readonly failed: 1; readonly changes: 2; readonly usage: 64 } = { ok: 0, failed: 1, changes: 2, usage: 64 };

/** The modes of a setup script, its first argument. `apply` is the default. */
export const SETUP_MODES: readonly ["apply", "check"] = ["apply", "check"];

/** The result of the generator: the script, or the faults of the gate. */
export type SetupScript = { readonly ok: true; readonly script: string } | { readonly ok: false; readonly faults: readonly SetupFault[] };

/** The shell functions that the steps use. The script has only the functions that its steps use. */
type Helper = "installed" | "apt_install" | "in_group" | "login_shell" | "user_home" | "file_is" | "swap_on" | "in_fstab" | "root_folder";

const HELPERS: readonly (readonly [Helper, readonly string[]])[] = [
  [
    "installed",
    [
      "# This function tells if the package $1 is installed.",
      "installed() {",
      `  [ "$(dpkg-query -W -f='\${Status}' "$1" 2>/dev/null || true)" = "install ok installed" ]`,
      "}",
    ],
  ],
  [
    "apt_install",
    [
      "# This function installs the packages. The first call reads the lists of the packages.",
      "apt_install() {",
      '  if [ "$apt_updated" -eq 0 ]; then',
      "    apt-get update -q || return 1",
      "    apt_updated=1",
      "  fi",
      '  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "$@"',
      "}",
    ],
  ],
  [
    "in_group",
    [
      "# This function tells if the user $1 is in the group $2.",
      "in_group() {",
      `  id -nG "$1" 2>/dev/null | tr ' ' '\\n' | grep -qxF "$2"`,
      "}",
    ],
  ],
  ["login_shell", ["# This function gives the login shell of the user $1.", "login_shell() {", '  getent passwd "$1" | cut -d: -f7', "}"]],
  ["user_home", ["# This function gives the home folder of the user $1.", "user_home() {", '  getent passwd "$1" | cut -d: -f6', "}"]],
  [
    "file_is",
    [
      "# This function tells if the file $1 has the text of the temporary file, the mode $2, the owner $3 and the group $4.",
      "file_is() {",
      `  [ -f "$1" ] && cmp -s "$tmp" "$1" && [ "$(stat -c '%a %U %G' "$1")" = "$2 $3 $4" ]`,
      "}",
    ],
  ],
  ["swap_on", ["# This function tells if the swap file $1 is on.", "swap_on() {", '  swapon --show=NAME --noheadings 2>/dev/null | grep -qxF "$1"', "}"]],
  [
    "in_fstab",
    [
      "# This function tells if /etc/fstab has the swap file $1.",
      "in_fstab() {",
      `  awk -v path="$1" '$1 == path && $3 == "swap" { found = 1 } END { exit !found }' /etc/fstab`,
      "}",
    ],
  ],
  [
    "root_folder",
    [
      "# This function tells if only root can change the folder $1: root owns it, it is not a link, and its group and other users cannot write in it.",
      "root_folder() {",
      '  [ -d "$1" ] && [ ! -L "$1" ] && [ -z "$(find "$1" -maxdepth 0 \\( ! -user root -o -perm /022 \\) -print)" ]',
      "}",
    ],
  ],
];

/** The shell functions that report a step. */
const REPORTS: readonly string[] = [
  "# These functions report a step.",
  "ok() {",
  '  echo "ok: $1"',
  "}",
  "change() {",
  "  changes=$((changes + 1))",
  '  echo "change: $1"',
  // The line on the standard error names the condition that fails. The line on the standard output keeps its form.
  '  echo "check: $1: the condition $2 of the check fails" >&2',
  "}",
  "changed() {",
  "  changes=$((changes + 1))",
  '  echo "changed: $1"',
  "}",
  "fail() {",
  '  echo "failed: $1: $2" >&2',
  `  exit ${String(SETUP_EXIT.failed)}`,
  "}",
];

/** The code of one step: its check, its change and the shell functions that they use. */
interface StepCode {
  readonly helpers: readonly Helper[];
  /** The conditions of the check. The check passes when each condition passes. */
  readonly check: readonly string[];
  /** The lines of the change. Each command line ends with `|| return 1`. */
  readonly apply: readonly string[];
  /** `true`: the step uses the temporary file. */
  readonly tmp: boolean;
}

/**
 * This function gives one word of the shell for a text. A literal part is quoted with `escapeShell` of `@mark1russell7/text/shell`.
 * A variable part is `"$NAME"`. Thus the shell expands only the variables of the text.
 */
export function shellWord(text: SetupText): string {
  // Two literal parts next to each other become one literal, so a quoted part is next to a variable or at an end.
  const parts: (string | { readonly $var: string })[] = [];
  for (const part of textParts(text)) {
    const last = parts.at(-1);
    if (typeof part === "string" && typeof last === "string") parts[parts.length - 1] = last + part;
    else parts.push(part);
  }
  const word = parts.map((part) => (typeof part === "string" ? escapeShell(part) : `"$${part.$var}"`)).join("");
  return word === "" ? "''" : word;
}

const q = escapeShell;

/** This function gives the line that writes a text to the temporary file. */
function writeTmp(text: SetupText): string {
  return `printf '%s' ${shellWord(text)} >"$tmp"`;
}

function packageCode(step: PackageStep): StepCode {
  if (step.names.length === 0) return { helpers: [], check: ["true"], apply: [":"], tmp: false };
  return {
    helpers: ["installed", "apt_install"],
    check: step.names.map((name) => `installed ${q(name)}`),
    apply: [`apt_install ${step.names.map(q).join(" ")} || return 1`],
    tmp: false,
  };
}

function userCode(step: UserStep): StepCode {
  const name = q(step.name);
  const shell = q(step.shell ?? DEFAULT_SHELL);
  const groups = step.groups ?? [];
  const helpers: Helper[] = ["login_shell"];
  const check = [`id -u ${name} >/dev/null 2>&1`, `[ "$(login_shell ${name})" = ${shell} ]`];
  const apply = [
    `if ! id -u ${name} >/dev/null 2>&1; then`,
    `  useradd --create-home --shell ${shell} ${name} || return 1`,
    "fi",
    `if [ "$(login_shell ${name})" != ${shell} ]; then`,
    `  usermod --shell ${shell} ${name} || return 1`,
    "fi",
  ];
  if (groups.length > 0) {
    helpers.push("in_group");
    const tests = groups.map((group) => `in_group ${name} ${q(group)}`);
    check.push(...tests);
    apply.push(`if ! { ${tests.join(" && ")}; }; then`, `  usermod -aG ${q(groups.join(","))} ${name} || return 1`, "fi");
  }
  const keys = step.keys;
  if (keys === undefined) return { helpers, check, apply, tmp: false };
  helpers.push("user_home", "file_is");
  // An empty list of keys gives an empty file. A printf with no argument writes one line break.
  const write = keys.length === 0 ? ': >"$tmp"' : `printf '%s\\n' ${keys.map(q).join(" ")} >"$tmp"`;
  check.push(write, `home=$(user_home ${name})`, '[ -n "$home" ]', `[ "$(stat -c '%a %U' "$home/.ssh")" = ${q(`700 ${step.name}`)} ]`, `file_is "$home/.ssh/authorized_keys" 600 ${name} "$(id -gn ${name})"`);
  // The group is explicit: `chown user:` with no group does not set the login group with each `chown`, for example the Rust coreutils.
  apply.push(
    `home=$(user_home ${name}) || return 1`,
    '[ -n "$home" ] || return 1',
    `group=$(id -gn ${name}) || return 1`,
    'mkdir -p "$home/.ssh" || return 1',
    'chmod 700 "$home/.ssh" || return 1',
    `chown ${name}:"$group" "$home/.ssh" || return 1`,
    `${write} || return 1`,
    `install -m 600 -o ${name} -g "$group" "$tmp" "$home/.ssh/authorized_keys" || return 1`,
  );
  return { helpers, check, apply, tmp: true };
}

function fileCode(step: FileStep): StepCode {
  const path = q(step.path);
  const mode = modeText(step.mode ?? DEFAULT_MODE);
  const owner = q(step.owner ?? "root");
  const group = q(step.group ?? "root");
  const write = writeTmp(step.text);
  return {
    helpers: ["file_is"],
    check: [write, `file_is ${path} ${mode} ${owner} ${group}`],
    apply: [`${write} || return 1`, `install -D -m ${mode} -o ${owner} -g ${group} "$tmp" ${path} || return 1`],
    tmp: true,
  };
}

/** The count of times that a download starts again after a transient error. The waits between them are 1, 2, 4 and 8 seconds, or the Retry-After of the server. */
const DOWNLOAD_RETRIES = 4;
/** The largest time in seconds of the retries of one download. */
const DOWNLOAD_RETRY_SECONDS = 120;

function downloadCode(step: DownloadStep): StepCode {
  const path = q(step.path);
  const mode = modeText(step.mode ?? DEFAULT_MODE);
  const sha = q(step.sha256);
  return {
    helpers: [],
    check: [`[ -f ${path} ]`, `[ "$(sha256sum ${path} | cut -d' ' -f1)" = ${sha} ]`, `[ "$(stat -c '%a %U %G' ${path})" = ${q(`${mode} root root`)} ]`],
    apply: [
      // curl tries again after a transient error (a time-out, or the HTTP status 408, 429, 500, 502, 503 or 504), and obeys Retry-After.
      `curl -fsSL --proto =https --proto-redir =https --tlsv1.2 --retry ${DOWNLOAD_RETRIES} --retry-max-time ${DOWNLOAD_RETRY_SECONDS} -o "$tmp" ${q(step.url)} || return 1`,
      `if [ "$(sha256sum "$tmp" | cut -d' ' -f1)" != ${sha} ]; then`,
      '  echo "setup: the SHA-256 of the download does not agree" >&2',
      "  return 1",
      "fi",
      `install -D -m ${mode} -o root -g root "$tmp" ${path} || return 1`,
    ],
    tmp: true,
  };
}

/** This function gives the folders above a path, from `/`: for `/opt/a/b`, they are `/`, `/opt` and `/opt/a`. */
function foldersAbove(path: string): string[] {
  const segments = path.split("/").slice(1, -1);
  return ["/", ...segments.map((_, index) => `/${segments.slice(0, index + 1).join("/")}`)];
}

/**
 * The code of an archive. First the change makes sure that only root can change each folder above the folder. Thus no other
 * user can put a link or a folder in the path between two commands. Then it extracts the archive into a new folder next to the
 * folder, as root, with no owner from the archive. It removes the write of the group and of other users, and the set-user-ID
 * and set-group-ID bits. Then it renames the old folder and the new folder. A process that runs a program of the old folder keeps its file.
 * The check examines that the folder is a folder and not a link. It also examines the mark, the owner and the mode of each file, and the folders above it.
 */
function archiveCode(step: ArchiveStep): StepCode {
  const into = q(step.into);
  const fresh = q(`${step.into}.setup-new`);
  const old = q(`${step.into}.setup-old`);
  const mark = q(step.mark.path);
  const sha = q(step.sha256);
  const above = foldersAbove(step.into).map((folder) => q(folder));
  return {
    helpers: ["root_folder"],
    check: [
      `[ -d ${into} ]`,
      `[ ! -L ${into} ]`,
      `[ -f ${mark} ]`,
      `[ "$(sha256sum ${mark} | cut -d' ' -f1)" = ${q(step.mark.sha256)} ]`,
      `[ -z "$(find ${into} \\( ! -user root -o ! -group root \\) -print -quit)" ]`,
      `[ -z "$(find ${into} ! -type l -perm /6022 -print -quit)" ]`,
      ...above.map((folder) => `root_folder ${folder}`),
    ],
    apply: [
      // From `/` down, each folder above is a folder that only root can change. A folder that is not there gets the mode 755.
      `for above in ${above.join(" ")}; do`,
      '  if [ ! -e "$above" ] && [ ! -L "$above" ]; then',
      '    mkdir -m 755 "$above" || return 1',
      "  fi",
      '  if ! root_folder "$above"; then',
      '    echo "setup: only root can change the folder $above above the archive" >&2',
      "    return 1",
      "  fi",
      "done",
      `curl -fsSL --proto =https --proto-redir =https --tlsv1.2 --retry ${String(DOWNLOAD_RETRIES)} --retry-max-time ${String(DOWNLOAD_RETRY_SECONDS)} -o "$tmp" ${q(step.url)} || return 1`,
      `if [ "$(sha256sum "$tmp" | cut -d' ' -f1)" != ${sha} ]; then`,
      '  echo "setup: the SHA-256 of the archive does not agree" >&2',
      "  return 1",
      "fi",
      `rm -rf ${fresh} ${old} || return 1`,
      // No -p: a path that is there makes mkdir fail. The mode 700 keeps other users out until the modes are correct.
      `mkdir -m 700 ${fresh} || return 1`,
      `tar -xf "$tmp" -C ${fresh} --strip-components=${String(step.strip ?? 0)} --no-same-owner || return 1`,
      `chown -R -h root:root ${fresh} || return 1`,
      // As root, tar keeps the modes of the archive. chmod removes the write of other users and the set-ID bits, so no file gives a user the rights of root.
      `chmod -R go-w,ug-s ${fresh} || return 1`,
      `chmod 755 ${fresh} || return 1`,
      `if [ -e ${into} ]; then`,
      `  mv ${into} ${old} || return 1`,
      "fi",
      `mv ${fresh} ${into} || return 1`,
      `rm -rf ${old} || return 1`,
    ],
    tmp: true,
  };
}

function swapCode(step: SwapStep): StepCode {
  const path = q(step.path);
  const form = q(`${String(step.mib * 1048576)} 600 root`);
  return {
    helpers: ["swap_on", "in_fstab"],
    check: [`swap_on ${path}`, `[ "$(stat -c '%s %a %U' ${path})" = ${form} ]`, `in_fstab ${path}`],
    apply: [
      `if [ "$(stat -c '%s %a %U' ${path} 2>/dev/null || true)" != ${form} ]; then`,
      `  if swap_on ${path}; then`,
      `    swapoff ${path} || return 1`,
      "  fi",
      `  rm -f ${path} || return 1`,
      `  dd if=/dev/zero of=${path} bs=1M count=${String(step.mib)} status=none || return 1`,
      `  chmod 600 ${path} || return 1`,
      `  mkswap ${path} || return 1`,
      "fi",
      `if ! swap_on ${path}; then`,
      `  swapon ${path} || return 1`,
      "fi",
      `if ! in_fstab ${path}; then`,
      `  printf '%s none swap sw 0 0\\n' ${path} >>/etc/fstab || return 1`,
      "fi",
    ],
    tmp: false,
  };
}

function serviceCode(step: ServiceStep): StepCode {
  const name = q(step.name);
  const unit = q(unitPath(step.name));
  const write = writeTmp(step.unit);
  const file = `file_is ${unit} 644 root root`;
  if (step.enable === false) {
    return {
      helpers: ["file_is"],
      check: [write, file],
      apply: [`${write} || return 1`, `if ! ${file}; then`, `  install -D -m 644 -o root -g root "$tmp" ${unit} || return 1`, "  systemctl daemon-reload || return 1", "fi"],
      tmp: true,
    };
  }
  return {
    helpers: ["file_is"],
    check: [write, file, `systemctl is-enabled --quiet ${name}`, `systemctl is-active --quiet ${name}`],
    apply: [
      "unit_new=0",
      `${write} || return 1`,
      `if ! ${file}; then`,
      `  install -D -m 644 -o root -g root "$tmp" ${unit} || return 1`,
      "  systemctl daemon-reload || return 1",
      "  unit_new=1",
      "fi",
      `systemctl enable --quiet ${name} || return 1`,
      'if [ "$unit_new" -eq 1 ]; then',
      `  systemctl restart ${name} || return 1`,
      "else",
      `  systemctl start ${name} || return 1`,
      "fi",
    ],
    tmp: true,
  };
}

function commandCode(step: CommandStep): StepCode {
  // `env` starts the program from the PATH, so no function, builtin or keyword of the shell is the program.
  const start = step.as === undefined || step.as === "root" ? "env" : `runuser -u ${q(step.as)} --`;
  const line = (command: readonly SetupText[]): string => [start, ...command.map(shellWord)].join(" ");
  // printf is a builtin of the shell, so the input is not in the arguments of a process.
  const run = step.input === undefined ? line(step.run) : `printf '%s' ${shellWord(step.input)} | ${line(step.run)}`;
  return { helpers: [], check: [line(step.check)], apply: [`${run} || return 1`], tmp: false };
}

/**
 * This function gives the texts that the check of a step reads. The `run` and the `input` of a command step are parts
 * of the change, not of the check. Thus the mode `check` needs no value for a variable of them only.
 */
function checkTexts(step: Step): readonly SetupText[] {
  return step.kind === "command" ? step.check : stepTexts(step);
}

/** This function gives the code of a step. */
function stepCode(step: Step): StepCode {
  switch (step.kind) {
    case "package":
      return packageCode(step);
    case "user":
      return userCode(step);
    case "file":
      return fileCode(step);
    case "download":
      return downloadCode(step);
    case "archive":
      return archiveCode(step);
    case "swap":
      return swapCode(step);
    case "service":
      return serviceCode(step);
    case "command":
      return commandCode(step);
  }
}

/**
 * This function gives the lines of one step: its two functions and the report.
 * The exit code of the check is the number of its first condition that fails. Thus a change in the mode `check` and a fault after the change name the condition.
 * They print no value.
 */
function stepLines(number: number, address: string, code: StepCode, aptSource: boolean): string[] {
  const check = `check_${String(number)}`;
  const apply = `apply_${String(number)}`;
  const at = q(address);
  const conditions = code.check.map((condition, index) => `  ${condition} || return ${String(index + 1)}`);
  return [
    `# The step ${address}`,
    `${check}() {`,
    ...conditions,
    "}",
    `${apply}() {`,
    ...code.apply.map((line) => `  ${line}`),
    "}",
    // `||` keeps a failing check from a stop of `set -e`, and it keeps the exit code of the check.
    "condition=0",
    `${check} >/dev/null 2>&1 || condition=$?`,
    'if [ "$condition" -eq 0 ]; then',
    `  ok ${at}`,
    'elif [ "$mode" = check ]; then',
    `  change ${at} "$condition"`,
    "else",
    `  ${apply} >&2 || fail ${at} "the change failed"`,
    `  ${check} >/dev/null 2>&1 || fail ${at} "the condition $? of the check fails after the change"`,
    `  changed ${at}`,
    // A new source or key of apt needs new lists, so the next package step reads them again.
    ...(aptSource ? ["  apt_updated=0"] : []),
    "fi",
  ];
}

/**
 * This function gives the setup script of one host. The gate `checkSetup` comes first: a layer with an error gives no script.
 *
 * The script:
 * - It is POSIX `sh`, and it passes `shellcheck -s sh`. It needs root, `apt`, `systemd` and the GNU tools of Debian or Ubuntu.
 * - Its first argument is the mode. `apply` makes each change. `check` makes no change, and it exits with 2 when a step has a change.
 * - It exits with 64 for a usage fault. A usage fault is a mode that is not known, a start that is not root, or a variable with no value.
 * - Each step starts its check first. Only a step with a failing check makes its change, and then its check must pass.
 * - It reads the value of each variable from its environment. It names the variables of the steps of this host only.
 * - The mode `check` needs the value of a variable only when a check reads it. The `input` of a command step is not a check.
 * - It holds no description of a record. Only names, paths and the texts of the steps are in it.
 *
 * The steps come in the order of `profileOrder`: a profile comes after each profile of the host whose part its part needs.
 *
 * @param layer - The setup layer.
 * @param stack - The stack.
 * @param host - The `id` of the host.
 * @returns The script, or the faults of the gate.
 */
export function setupScript(layer: SetupLayer, stack: Stack, host: string): SetupScript {
  const faults = checkSetup(layer, stack);
  if (hasSetupError(faults)) return { ok: false, faults };
  const { profiles } = profileOrder(layer, stack, host);
  if (profiles.length === 0) {
    return { ok: false, faults: [...faults, { level: "error", code: "setup-host", at: host, message: `No profile of the layer names the host "${host}".`, host }] };
  }
  const steps = profiles.flatMap((profile) => profile.steps.map((step) => ({ address: stepAddress(profile, step), step, code: stepCode(step) })));
  const variables: string[] = [];
  for (const { step } of steps) for (const text of stepTexts(step)) for (const name of textVariables(text)) if (!variables.includes(name)) variables.push(name);
  const checked = new Set(steps.flatMap(({ step }) => checkTexts(step).flatMap((text) => textVariables(text))));
  const helpers = new Set(steps.flatMap(({ code }) => code.helpers));
  const tmp = steps.some(({ code }) => code.tmp);
  const lines: string[] = [
    "#!/bin/sh",
    // A directive next to the shebang holds for the whole file. Each literal text is in single quotes on purpose, so the shell expands no "$" in it.
    "# shellcheck disable=SC2016",
    `# The setup of the host ${JSON.stringify(host)}, from a layer ${SETUP_SCHEMA} of a system stack.`,
    "# Each literal text is in single quotes, so the shell expands nothing in it. The shell expands only the variables of the layer.",
    "# Start it as root with the mode apply or check. The mode check makes no change.",
    "# The exit codes: 0 when each step is ok, 1 when a step fails, 2 when the mode check finds a change, 64 for a usage fault.",
    "set -eu",
    "",
    "mode=${1:-apply}",
    "case $mode in",
    `  ${SETUP_MODES.join(" | ")}) ;;`,
    "  *)",
    `    echo "usage: $0 [${SETUP_MODES.join("|")}]" >&2`,
    `    exit ${String(SETUP_EXIT.usage)}`,
    "    ;;",
    "esac",
    'if [ "$(id -u)" -ne 0 ]; then',
    '  echo "setup: start the script as root" >&2',
    `  exit ${String(SETUP_EXIT.usage)}`,
    "fi",
  ];
  for (const name of variables) {
    const test = `[ -z "\${${name}-}" ]`;
    lines.push(`if ${checked.has(name) ? test : `[ "$mode" = apply ] && ${test}`}; then`, `  echo "setup: the variable ${name} has no value" >&2`, `  exit ${String(SETUP_EXIT.usage)}`, "fi");
  }
  lines.push("");
  if (tmp) lines.push('tmp=$(mktemp)', `trap 'rm -f "$tmp"' EXIT`, `trap 'exit ${String(SETUP_EXIT.failed)}' INT TERM HUP`);
  lines.push("changes=0");
  if (helpers.has("apt_install")) lines.push("apt_updated=0");
  for (const [name, text] of HELPERS) if (helpers.has(name)) lines.push("", ...text);
  if (steps.length > 0) lines.push("", ...REPORTS);
  const apt = helpers.has("apt_install");
  steps.forEach(({ address, step, code }, index) => lines.push("", ...stepLines(index + 1, address, code, apt && changesAptSources(step))));
  lines.push(
    "",
    'echo "changes: $changes"',
    'if [ "$mode" = check ] && [ "$changes" -gt 0 ]; then',
    `  exit ${String(SETUP_EXIT.changes)}`,
    "fi",
    "",
  );
  return { ok: true, script: lines.join("\n") };
}
