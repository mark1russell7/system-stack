import { SAMPLE_STACK, STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { SETUP_SCHEMA, type Profile, type SetupLayer, type Step } from "./layer.ts";
import { SAMPLE_SETUP } from "./sample.ts";
import { SETUP_EXIT, SETUP_MODES, setupScript, shellWord } from "./script.ts";

const STACK: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "a", kind: "host" },
    { id: "b", kind: "host" },
  ],
};

/** This function gives the script of the host `a` for one profile with the steps, or fails the test. */
function scriptOf(steps: readonly Step[], variables: SetupLayer["variables"] = undefined): string {
  const layer: SetupLayer = { schema: SETUP_SCHEMA, ...(variables === undefined ? {} : { variables }), profiles: [{ name: "p", part: "a", hosts: ["a"], steps }] };
  const result = setupScript(layer, STACK, "a");
  if (!result.ok) throw new Error(JSON.stringify(result.faults));
  return result.script;
}

describe("shellWord", () => {
  it("keeps a text of the safe characters, and quotes each other text", () => {
    expect(shellWord("plain-text_1.0/a:b")).toBe("plain-text_1.0/a:b");
    expect(shellWord("a b")).toBe("'a b'");
    expect(shellWord("it's")).toBe("'it'\\''s'");
    expect(shellWord("$HOME `x`")).toBe("'$HOME `x`'");
  });

  it("gives an empty word for an empty text", () => {
    expect(shellWord("")).toBe("''");
    expect(shellWord([])).toBe("''");
  });

  it("expands only the variables of a text", () => {
    expect(shellWord({ $var: "A" })).toBe('"$A"');
    expect(shellWord([{ $var: "A" }, " and ", { $var: "B" }])).toBe(`"$A"' and '"$B"`);
  });
});

describe("setupScript", () => {
  const sample = setupScript(SAMPLE_SETUP, SAMPLE_STACK, "cloud-host");
  const script = sample.ok ? sample.script : "";

  it("gives a POSIX shell script for a host of the sample", () => {
    expect(sample.ok).toBe(true);
    expect(script.startsWith('#!/bin/sh\n# shellcheck disable=SC2016\n# The setup of the host "cloud-host"')).toBe(true);
    expect(script).toContain("\nset -eu\n");
    expect(script.endsWith("\n")).toBe(true);
  });

  it("puts the steps in the order of the needs", () => {
    const steps = [...script.matchAll(/^# The step (\S+)$/gm)].map((match) => match[1]);
    expect(steps).toEqual(["base.packages", "base.swap", "base.user", "program.binary", "program.env", "program.data", "program.service"]);
  });

  it("reads the mode, and refuses a mode that is not known, a start that is not root and a variable with no value", () => {
    expect(SETUP_MODES).toEqual(["apply", "check"]);
    expect(script).toContain("mode=${1:-apply}\ncase $mode in\n  apply | check) ;;");
    expect(script).toContain(`exit ${String(SETUP_EXIT.usage)}`);
    expect(script).toContain('if [ "$(id -u)" -ne 0 ]; then');
    expect(script).toContain('if [ -z "${ALERTS_TOKEN-}" ]; then');
  });

  it("holds no value of a variable and no description", () => {
    expect(script).toContain(`printf '%s' ALERTS_TOKEN="$ALERTS_TOKEN"'\n' >"$tmp"`);
    expect(script).not.toContain("The token of the push service");
  });

  it("checks each step before its change, and the check again after the change", () => {
    expect(script).toContain('if check_1 >/dev/null 2>&1; then\n  ok base.packages\nelif [ "$mode" = check ]; then\n  change base.packages\nelse');
    expect(script).toContain('  apply_1 >&2 || fail base.packages "the change failed"\n  check_1 >/dev/null 2>&1 || fail base.packages "the condition $? of the check fails after the change"');
    expect(script).toContain(`echo "changes: $changes"\nif [ "$mode" = check ] && [ "$changes" -gt 0 ]; then\n  exit ${String(SETUP_EXIT.changes)}\nfi\n`);
  });

  it("writes the code of each kind of step", () => {
    expect(script).toContain("check_1() {\n  installed ca-certificates || return 1\n  installed curl || return 2\n}");
    expect(script).toContain("apt_install ca-certificates curl || return 1");
    expect(script).toContain("dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none || return 1");
    expect(script).toContain("[ \"$(stat -c '%s %a %U' /swapfile)\" = '1073741824 600 root' ]");
    expect(script).toContain("useradd --create-home --shell /usr/sbin/nologin alerts || return 1");
    expect(script).toContain("usermod -aG systemd-journal alerts || return 1");
    expect(script).toContain('curl -fsSL --proto =https --proto-redir =https --tlsv1.2 --retry 4 --retry-max-time 120 -o "$tmp" https://example.org/alerts/1.4.0/alerts || return 1');
    expect(script).toContain('install -D -m 755 -o root -g root "$tmp" /opt/alerts/alerts || return 1');
    expect(script).toContain("file_is /etc/alerts/env 600 root root");
    expect(script).toContain("env install -d -o alerts -g alerts /var/lib/alerts || return 1");
    expect(script).toContain("check_6() {\n  env test -d /var/lib/alerts || return 1\n}");
    expect(script).toContain("systemctl enable --quiet alerts || return 1");
    expect(script).toContain("systemctl is-active --quiet alerts");
  });

  it("has only the shell functions that its steps use", () => {
    for (const name of ["installed", "apt_install", "in_group", "login_shell", "file_is", "swap_on", "in_fstab", "ok", "change", "changed", "fail"]) expect(script, name).toContain(`\n${name}() {`);
    expect(script).not.toContain("user_home() {");
    const packages = scriptOf([{ kind: "package", id: "p", manager: "apt", names: ["jq"] }]);
    expect(packages).toContain("installed() {");
    expect(packages).not.toContain("file_is() {");
    // No step uses the temporary file, so the script makes none.
    expect(packages).not.toContain("mktemp");
    expect(packages).not.toContain("trap");
  });

  it("gives no step function to a host with no step", () => {
    const empty = scriptOf([]);
    expect(empty).not.toContain("ok() {");
    expect(empty).toContain('echo "changes: $changes"');
  });

  it("writes the keys of a user, and an empty file for an empty list", () => {
    const keys = scriptOf([{ kind: "user", id: "u", name: "app", keys: ["ssh-ed25519 AAAA one"] }]);
    expect(keys).toContain("user_home() {");
    expect(keys).toContain(`printf '%s\\n' 'ssh-ed25519 AAAA one' >"$tmp" || return 1`);
    expect(keys).toContain("[ \"$(stat -c '%a %U' \"$home/.ssh\")\" = '700 app' ]");
    expect(keys).toContain('file_is "$home/.ssh/authorized_keys" 600 app "$(id -gn app)" || return 7');
    // The group is explicit, so no `chown` reads `app:` with no group.
    expect(keys).toContain('group=$(id -gn app) || return 1');
    expect(keys).toContain('chown app:"$group" "$home/.ssh" || return 1');
    expect(keys).toContain('install -m 600 -o app -g "$group" "$tmp" "$home/.ssh/authorized_keys" || return 1');
    expect(keys).not.toMatch(/chown app: /);
    expect(scriptOf([{ kind: "user", id: "u", name: "app", keys: [] }])).toContain(': >"$tmp" || return 1');
    // With no field keys, the step does not change the file.
    expect(scriptOf([{ kind: "user", id: "u", name: "app" }])).not.toContain("authorized_keys");
  });

  it("writes a file with its mode in the form of stat, and its owner", () => {
    const file = scriptOf([{ kind: "file", id: "f", path: "/etc/a", text: "x", mode: "0640", owner: "app", group: "adm" }]);
    expect(file).toContain(`install -D -m 640 -o app -g adm "$tmp" /etc/a || return 1`);
    expect(file).toContain("file_is /etc/a 640 app adm");
  });

  it("starts a command as its user, and only through a program", () => {
    expect(scriptOf([{ kind: "command", id: "c", run: ["mkdir", "-p", "/srv/a"], check: ["test", "-d", "/srv/a"], as: "app" }])).toContain("runuser -u app -- mkdir -p /srv/a || return 1");
    expect(scriptOf([{ kind: "command", id: "c", run: ["true"], check: ["true"], as: "root" }])).toContain("env true || return 1");
  });

  it("writes only the unit of a service that does not start", () => {
    const unit = scriptOf([{ kind: "service", id: "s", name: "app", unit: "[Unit]\n", enable: false }]);
    expect(unit).toContain("systemctl daemon-reload");
    expect(unit).not.toContain("systemctl enable");
    expect(unit).not.toContain("unit_new");
  });

  it("names only the variables of the steps of the host", () => {
    const profiles: Profile[] = [
      { name: "one", part: "a", hosts: ["a"], steps: [{ kind: "file", id: "f", path: "/etc/a", text: { $var: "A" } }] },
      { name: "two", part: "b", hosts: ["b"], steps: [{ kind: "file", id: "f", path: "/etc/b", text: { $var: "B" } }] },
    ];
    const result = setupScript({ schema: SETUP_SCHEMA, variables: [{ name: "A" }, { name: "B" }], profiles }, STACK, "a");
    expect(result.ok && result.script.includes("${A-}")).toBe(true);
    expect(result.ok && result.script.includes("${B-}")).toBe(false);
  });

  it("gives the faults of the gate, and no script, for a layer with an error", () => {
    const result = setupScript({ schema: SETUP_SCHEMA, profiles: [{ name: "p", part: "a", hosts: ["a"], steps: [{ kind: "file", id: "f", path: "etc", text: "x" }] }] }, STACK, "a");
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.faults.map((fault) => fault.code)).toEqual(["setup-path"]);
  });

  it("gives a fault for a host that no profile names", () => {
    const result = setupScript(SAMPLE_SETUP, SAMPLE_STACK, "home-host");
    expect(result).toEqual({ ok: false, faults: [{ level: "error", code: "setup-host", at: "home-host", message: 'No profile of the layer names the host "home-host".', host: "home-host" }] });
  });

  it("gives the same script for the same records", () => {
    expect(setupScript(SAMPLE_SETUP, SAMPLE_STACK, "cloud-host")).toEqual(sample);
  });
});
