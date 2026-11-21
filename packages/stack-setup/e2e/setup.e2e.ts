// The check of the setup script on a real host. A unit test cannot tell if a shell runs the script, or if a second run changes nothing.
// This file starts `sudo`, `apt`, `systemd` and `shellcheck`, so it is not in the unit tests: the job `setup` of the CI workflow starts it
// on a runner of CI, which is a new machine for each job. Each name and each value of this file is an example: no value is a secret.
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { SETUP_EXIT, SETUP_SCHEMA, setupScript, type SetupLayer } from "../src/index.ts";

const HOST = "ci-host";
const USER = "stack-setup-e2e";
const FOLDER = "/etc/stack-setup-e2e";
const SWAP = "/var/lib/stack-setup-e2e.swap";
const DOWNLOAD = "/opt/stack-setup-e2e/LICENSE";

/** The values of the two variables. They are examples. */
const TOKEN = "an-example-of-a-token";
const GREETING = "a greeting with 'quotes', $dollars and `ticks`";

/** The license of this repository at a commit of its main branch, and the SHA-256 of that file. */
const LICENSE_URL = "https://raw.githubusercontent.com/mark1russell7/system-stack/eef7f9f3a56e95c93944b3d0efb2d0b68c1d37a0/LICENSE";
const LICENSE_SHA256 = "f5ac83ec2855d37f186d28771ce2abd671ff029dee51dc7c0c9cfb8a3109f9fc";

/** An example of a public key. No private key belongs to it. */
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAnExampleKeyOfTheEndToEndTestOfTheSetup stack-setup-e2e";

const STACK: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: HOST, kind: "host" },
    { id: "e2e-app", kind: "service", needs: [HOST] },
  ],
};

const UNIT = ["[Unit]", "Description=The service of the end-to-end test of the setup", "", "[Service]", "ExecStart=/bin/sleep infinity", "", "[Install]", "WantedBy=multi-user.target", ""].join("\n");

// The profile of the program comes first in the layer. Its part needs the host, so the script has the profile base first.
const LAYER: SetupLayer = {
  schema: SETUP_SCHEMA,
  variables: [{ name: "TOKEN", sensitive: true }, { name: "GREETING" }],
  profiles: [
    {
      name: "app",
      part: "e2e-app",
      hosts: [HOST],
      steps: [
        { kind: "file", id: "env", path: `${FOLDER}/env`, text: ["TOKEN=", { $var: "TOKEN" }, "\n"], mode: "600" },
        { kind: "file", id: "greeting", path: `${FOLDER}/greeting`, text: [{ $var: "GREETING" }, "\n"] },
        { kind: "download", id: "license", url: LICENSE_URL, sha256: LICENSE_SHA256, path: DOWNLOAD },
        { kind: "service", id: "service", name: USER, unit: UNIT },
        { kind: "command", id: "data", run: ["install", "-d", "-m", "755", "/srv/stack-setup-e2e"], check: ["test", "-d", "/srv/stack-setup-e2e"] },
        { kind: "command", id: "home-data", run: ["mkdir", "-p", `/home/${USER}/data`], check: ["test", "-d", `/home/${USER}/data`], as: USER },
      ],
    },
    {
      name: "base",
      part: HOST,
      hosts: [HOST],
      steps: [
        { kind: "package", id: "packages", manager: "apt", names: ["units", "pv"] },
        { kind: "user", id: "user", name: USER, groups: ["adm"], shell: "/bin/sh", keys: [KEY] },
        { kind: "swap", id: "swap", path: SWAP, mib: 16 },
      ],
    },
  ],
};

/** A layer with a command whose check fails also after the change. */
const FAILING: SetupLayer = {
  schema: SETUP_SCHEMA,
  profiles: [{ name: "fail", part: HOST, hosts: [HOST], steps: [{ kind: "command", id: "never", run: ["true"], check: ["false"] }] }],
};

let folder = "";
let script = "";
let failing = "";

/** This function gives the text of a script, or stops the test with the faults of the gate. */
function scriptText(layer: SetupLayer): string {
  const result = setupScript(layer, STACK, HOST);
  if (!result.ok) throw new Error(`The gate has faults: ${JSON.stringify(result.faults)}`);
  return result.script;
}

/** This function starts a program, and gives its exit code and its output. */
function start(program: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(program, args, { encoding: "utf8", timeout: 300_000 });
}

/** This function starts the setup script as root, with the values of the variables. */
function setup(file: string, mode: string, values: Readonly<Record<string, string>> = { TOKEN, GREETING }): SpawnSyncReturns<string> {
  return start("sudo", ["env", ...Object.entries(values).map(([name, value]) => `${name}=${value}`), "sh", file, mode]);
}

/** This function gives the output of a command as root. */
function asRoot(args: readonly string[]): string {
  const run = start("sudo", args);
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

/** This function gives the count of the changes in the last line of the output of a script. */
function changes(output: string): number {
  const match = /^changes: (\d+)$/m.exec(output);
  assert.ok(match, output);
  return Number(match[1]);
}

/** This function gives the report of each step, for example `ok: base.packages`. */
function reports(output: string): string[] {
  return output.split("\n").filter((line) => /^(ok|change|changed): /.test(line));
}

before(() => {
  folder = mkdtempSync(join(tmpdir(), "stack-setup-"));
  script = join(folder, "setup.sh");
  failing = join(folder, "failing.sh");
  writeFileSync(script, scriptText(LAYER));
  writeFileSync(failing, scriptText(FAILING));
});

after(() => {
  rmSync(folder, { recursive: true, force: true });
});

test("the script holds no value of a variable", () => {
  const text = scriptText(LAYER);
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes("a greeting"));
});

test("shellcheck finds nothing in the script", () => {
  const run = start("shellcheck", ["-s", "sh", script, failing]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("the script refuses a usage fault and changes nothing", () => {
  assert.equal(start("sh", [script, "check"]).status, SETUP_EXIT.usage, "not root");
  assert.equal(setup(script, "repair").status, SETUP_EXIT.usage, "a mode that is not known");
  assert.equal(setup(script, "check", { TOKEN }).status, SETUP_EXIT.usage, "a variable with no value");
  assert.equal(start("id", [USER]).status, 1, "the user is not there");
});

test("the mode check finds the changes and makes none", () => {
  const run = setup(script, "check");
  assert.equal(run.status, SETUP_EXIT.changes, run.stdout + run.stderr);
  assert.ok(changes(run.stdout) > 0);
  assert.equal(start("id", [USER]).status, 1, "the user is not there");
});

test("the first apply makes the changes in the order of the needs", () => {
  const run = setup(script, "apply");
  assert.equal(run.status, SETUP_EXIT.ok, run.stdout + run.stderr);
  assert.ok(changes(run.stdout) > 0);
  const steps = reports(run.stdout).map((line) => line.replace(/^\w+: /, ""));
  assert.deepEqual(steps, ["base.packages", "base.user", "base.swap", "app.env", "app.greeting", "app.license", "app.service", "app.data", "app.home-data"]);
});

test("the second apply changes nothing, and the mode check passes", () => {
  const apply = setup(script, "apply");
  assert.equal(apply.status, SETUP_EXIT.ok, apply.stdout + apply.stderr);
  assert.equal(changes(apply.stdout), 0);
  for (const line of reports(apply.stdout)) assert.match(line, /^ok: /);
  const check = setup(script, "check");
  assert.equal(check.status, SETUP_EXIT.ok, check.stdout + check.stderr);
  assert.equal(changes(check.stdout), 0);
});

test("the host has each record of the layer", () => {
  assert.equal(asRoot(["stat", "-c", "%a %U %G", `${FOLDER}/env`]), "600 root root\n");
  assert.equal(asRoot(["cat", `${FOLDER}/env`]), `TOKEN=${TOKEN}\n`);
  assert.equal(asRoot(["stat", "-c", "%a %U %G", `${FOLDER}/greeting`]), "644 root root\n");
  assert.equal(asRoot(["cat", `${FOLDER}/greeting`]), `${GREETING}\n`);
  assert.equal(asRoot(["sha256sum", DOWNLOAD]).split(" ")[0], LICENSE_SHA256);
  assert.equal(start("systemctl", ["is-active", USER]).stdout, "active\n");
  assert.equal(start("systemctl", ["is-enabled", USER]).stdout, "enabled\n");
  assert.ok(start("id", ["-nG", USER]).stdout.split(" ").map((group) => group.trim()).includes("adm"));
  assert.equal(start("getent", ["passwd", USER]).stdout.trim().split(":")[6], "/bin/sh");
  assert.equal(asRoot(["cat", `/home/${USER}/.ssh/authorized_keys`]), `${KEY}\n`);
  assert.equal(asRoot(["stat", "-c", "%a %U", `/home/${USER}/.ssh`, `/home/${USER}/.ssh/authorized_keys`]), `700 ${USER}\n600 ${USER}\n`);
  assert.equal(asRoot(["stat", "-c", "%U", `/home/${USER}/data`]), `${USER}\n`);
  assert.ok(asRoot(["swapon", "--show=NAME", "--noheadings"]).split("\n").includes(SWAP));
  assert.ok(asRoot(["cat", "/etc/fstab"]).split("\n").includes(`${SWAP} none swap sw 0 0`));
});

test("the script repairs a file that changed, and only that file", () => {
  asRoot(["sh", "-c", `printf 'changed\\n' > ${FOLDER}/greeting`]);
  const check = setup(script, "check");
  assert.equal(check.status, SETUP_EXIT.changes, check.stdout + check.stderr);
  assert.deepEqual(
    reports(check.stdout).filter((line) => !line.startsWith("ok: ")),
    ["change: app.greeting"],
  );
  const apply = setup(script, "apply");
  assert.equal(apply.status, SETUP_EXIT.ok, apply.stdout + apply.stderr);
  assert.equal(changes(apply.stdout), 1);
  assert.equal(asRoot(["cat", `${FOLDER}/greeting`]), `${GREETING}\n`);
});

test("a step whose check fails after the change stops the script", () => {
  const run = setup(failing, "apply", {});
  assert.equal(run.status, SETUP_EXIT.failed, run.stdout + run.stderr);
  assert.match(run.stderr, /^failed: fail\.never: the check fails after the change$/m);
});
