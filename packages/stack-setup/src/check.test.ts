import { SAMPLE_STACK, STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkSetup, hasSetupError, SETUP_CODES, type SetupCode } from "./check.ts";
import { SETUP_SCHEMA, type Profile, type SetupLayer, type Step, type Variable } from "./layer.ts";
import { SAMPLE_SETUP } from "./sample.ts";

const STACK: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "h", kind: "host" },
    { id: "app", kind: "service", needs: ["h"] },
    { id: "x", kind: "service", needs: ["y"] },
    { id: "y", kind: "service", needs: ["x"] },
  ],
};

/** This function gives a layer with one profile of the part `app` on the host `h`. */
function withSteps(steps: readonly Step[], variables?: readonly Variable[]): SetupLayer {
  return { schema: SETUP_SCHEMA, ...(variables === undefined ? {} : { variables }), profiles: [{ name: "app", part: "app", hosts: ["h"], steps }] };
}

const codes = (layer: SetupLayer, stack: Stack = STACK): SetupCode[] => checkSetup(layer, stack).map((fault) => fault.code);
const file = (more: Partial<Extract<Step, { kind: "file" }>> = {}): Step => ({ kind: "file", id: "f", path: "/etc/app/conf", text: "a=1\n", ...more });

describe("checkSetup", () => {
  it("passes the sample layer with no fault", () => {
    expect(checkSetup(SAMPLE_SETUP, SAMPLE_STACK)).toEqual([]);
  });

  it("has a code for each fault that it gives", () => {
    expect(new Set(SETUP_CODES).size).toBe(SETUP_CODES.length);
  });

  it("refuses names that do not have their form", () => {
    const steps: Step[] = [
      { kind: "package", id: "bad id", manager: "apt", names: ["Bad_Name"] },
      { kind: "user", id: "u", name: "Root", groups: ["ok", "no way"] },
      { kind: "service", id: "s", name: "app.service", unit: "[Unit]\n" },
      file({ owner: "-x" }),
    ];
    const faults = checkSetup(withSteps(steps), STACK).filter((fault) => fault.code === "setup-name");
    expect(faults.map((fault) => fault.at)).toEqual(["app.bad id", "app.bad id", "app.u", "app.u", "app.s", "app.f"]);
  });

  it("refuses a variable with a name of the shell, and a variable twice", () => {
    const layer = withSteps([file({ text: [{ $var: "PATH" }, { $var: "LC_ALL" }, { $var: "TWO" }] })], [{ name: "PATH" }, { name: "LC_ALL" }, { name: "TWO" }, { name: "TWO" }]);
    expect(codes(layer)).toEqual(["setup-name", "setup-name", "setup-variable-twice"]);
  });

  it("refuses two profiles with one name and two steps with one id", () => {
    const profile: Profile = { name: "app", part: "app", hosts: ["h"], steps: [file(), file({ path: "/etc/app/two" })] };
    expect(codes({ schema: SETUP_SCHEMA, profiles: [profile, { ...profile, steps: [] }] })).toEqual(["setup-step-twice", "setup-profile-twice", "setup-empty"]);
  });

  it("refuses a part or a host that the stack does not have, and a profile with no host", () => {
    const layer: SetupLayer = {
      schema: SETUP_SCHEMA,
      profiles: [
        { name: "a", part: "nothing", hosts: ["h"], steps: [file()] },
        { name: "b", part: "app", hosts: ["nowhere"], steps: [file({ path: "/etc/b" })] },
        { name: "c", part: "app", hosts: [], steps: [file({ path: "/etc/c" })] },
      ],
    };
    const faults = checkSetup(layer, STACK);
    expect(faults.map((fault) => [fault.code, fault.at])).toEqual([
      ["setup-part", "a"],
      ["setup-host", "b"],
      ["setup-host", "c"],
    ]);
    expect(faults[1]?.host).toBe("nowhere");
  });

  it("refuses a read of a variable that the layer does not have, and warns for a variable that no step reads", () => {
    const faults = checkSetup(withSteps([file({ text: ["a=", { $var: "MISSING" }] })], [{ name: "UNUSED" }]), STACK);
    expect(faults.map((fault) => [fault.level, fault.code, fault.at])).toEqual([
      ["error", "setup-variable", "app.f"],
      ["warning", "setup-variable-unused", "var.UNUSED"],
    ]);
    expect(hasSetupError(faults)).toBe(true);
    expect(hasSetupError(faults.filter((fault) => fault.level === "warning"))).toBe(false);
  });

  it("lets a secret be only in a file that no other user can read", () => {
    const secret: Variable[] = [{ name: "TOKEN", sensitive: true }];
    const read = { $var: "TOKEN" };
    expect(codes(withSteps([file({ text: read, mode: "600" })], secret))).toEqual([]);
    expect(codes(withSteps([file({ text: read, mode: "0640" })], secret))).toEqual([]);
    expect(codes(withSteps([file({ text: read })], secret))).toEqual(["setup-secret-exposed"]);
    expect(codes(withSteps([file({ text: read, mode: "604" })], secret))).toEqual(["setup-secret-exposed"]);
    expect(codes(withSteps([{ kind: "service", id: "s", name: "app", unit: ["Environment=T=", read] }], secret))).toEqual(["setup-secret-exposed"]);
    expect(codes(withSteps([{ kind: "command", id: "c", run: ["login", read], check: ["true"] }], secret))).toEqual(["setup-secret-exposed"]);
    // The input of a command can hold a secret: other users cannot read the input of a process.
    expect(codes(withSteps([{ kind: "command", id: "c", run: ["login", "--key=file:/dev/stdin"], check: ["true"], input: read }], secret))).toEqual([]);
    expect(codes(withSteps([{ kind: "command", id: "c", run: ["login"], check: ["test", read], input: read }], secret))).toEqual(["setup-secret-exposed"]);
    // A variable that is not sensitive can be in each text.
    expect(codes(withSteps([{ kind: "command", id: "c", run: ["echo", { $var: "NAME" }], check: ["true"] }], [{ name: "NAME" }]))).toEqual([]);
  });

  it("refuses the character NUL in a text, and a key that is not one line", () => {
    expect(codes(withSteps([file({ text: "a\0b" })]))).toEqual(["setup-text"]);
    expect(codes(withSteps([{ kind: "user", id: "u", name: "app", keys: ["ssh-ed25519 AAAA one", "two\nthree"] }]))).toEqual(["setup-text"]);
    expect(codes(withSteps([{ kind: "user", id: "u", name: "app", keys: [" "] }]))).toEqual(["setup-text"]);
  });

  it("refuses a path that is not an absolute path of the safe characters", () => {
    for (const path of ["etc/app", "/", "/etc/", "/etc//app", "/etc/../shadow", "/etc/./app", "/etc/app conf", "/etc/$app", "/etc/app\n"]) {
      expect(codes(withSteps([file({ path })])), path).toEqual(["setup-path"]);
    }
    expect(codes(withSteps([file({ path: "/etc/app-1/conf.d/a_b@c+d" })]))).toEqual([]);
    expect(codes(withSteps([{ kind: "user", id: "u", name: "app", shell: "bash" }]))).toEqual(["setup-path"]);
  });

  it("refuses two steps of one host that write one path or set up one user", () => {
    const layer: SetupLayer = {
      schema: SETUP_SCHEMA,
      profiles: [
        { name: "one", part: "app", hosts: ["h"], steps: [file(), { kind: "user", id: "u", name: "app" }, { kind: "service", id: "s", name: "app", unit: "[Unit]\n" }] },
        { name: "two", part: "app", hosts: ["h"], steps: [file({ id: "g" }), { kind: "user", id: "u", name: "app" }, file({ id: "unit", path: "/etc/systemd/system/app.service" })] },
      ],
    };
    const faults = checkSetup(layer, STACK);
    expect(faults.map((fault) => [fault.code, fault.at, fault.other])).toEqual([
      ["setup-path-twice", "two.g", "one.f"],
      ["setup-user-twice", "two.u", "one.u"],
      ["setup-path-twice", "two.unit", "one.s"],
    ]);
  });

  it("refuses a file step of /etc/fstab on a host with a swap step", () => {
    const steps: Step[] = [
      { kind: "swap", id: "swap", path: "/swapfile", mib: 512 },
      file({ path: "/etc/fstab" }),
    ];
    expect(checkSetup(withSteps(steps), STACK).map((fault) => [fault.code, fault.at, fault.other])).toEqual([["setup-path-twice", "app.f", "app.swap"]]);
  });

  it("refuses a mode, an address, a SHA-256 or a swap size that does not have its form", () => {
    const download = (more: Partial<Extract<Step, { kind: "download" }>>): Step => ({ kind: "download", id: "d", url: "https://example.org/a", sha256: "a".repeat(64), path: "/opt/a", ...more });
    expect(codes(withSteps([file({ mode: "rw" })]))).toEqual(["setup-mode"]);
    expect(codes(withSteps([file({ mode: "80" })]))).toEqual(["setup-mode"]);
    expect(codes(withSteps([download({})]))).toEqual([]);
    for (const url of ["http://example.org/a", "https://", "https://example.org/a b", "ftp://example.org/a"]) expect(codes(withSteps([download({ url })])), url).toEqual(["setup-url"]);
    // The fault does not repeat an address with a password.
    const secret = checkSetup(withSteps([download({ url: "https://user:a-password@example.org/a" })]), STACK);
    expect(secret.map((fault) => fault.code)).toEqual(["setup-url"]);
    expect(JSON.stringify(secret)).not.toContain("a-password");
    expect(codes(withSteps([download({ sha256: "A".repeat(64) })]))).toEqual(["setup-sha256"]);
    for (const mib of [0, 1.5, 65537, Number.NaN]) expect(codes(withSteps([{ kind: "swap", id: "s", path: "/swapfile", mib }])), String(mib)).toEqual(["setup-swap-size"]);
  });

  it("refuses an archive outside the folder of an app, a mark outside its folder and a count to strip out of its range", () => {
    const archive = (more: Partial<Extract<Step, { kind: "archive" }>>): Step => ({
      kind: "archive",
      id: "a",
      url: "https://example.org/a.tar.xz",
      sha256: "a".repeat(64),
      into: "/opt/a",
      strip: 1,
      mark: { path: "/opt/a/bin/a", sha256: "b".repeat(64) },
      ...more,
    });
    expect(codes(withSteps([archive({})]))).toEqual([]);
    for (const into of ["/srv/a", "/opt/a/b", "/opt/libs", "/usr/local/a", "/usr/local/a/b"]) {
      expect(codes(withSteps([archive({ into, mark: { path: `${into}/m`, sha256: "b".repeat(64) } })])), into).toEqual([]);
    }
    // Only the folder of an app passes: a folder of the system, or a name that the FHS keeps, is refused at each depth.
    const system = ["/opt", "/srv", "/usr/local", "/opt/lib", "/opt/bin/a", "/usr/local/bin", "/usr/local/lib/a", "/usr/local/share/a"];
    const others = ["/usr/lib/x86_64-linux-gnu", "/var/lib/dpkg", "/etc/systemd/system", "/usr/share/keyrings", "/etc/a/b", "/home/a/tools", "/var/tmp/a"];
    for (const into of [...system, ...others, "/bin/a", "/tmp/a", "/proc/a/b", "opt/a", "/opt/a/../b", "/opt/a/"]) {
      expect(codes(withSteps([archive({ into, mark: { path: `${into}/m`, sha256: "b".repeat(64) } })])), into).toContain("setup-archive");
    }
    expect(codes(withSteps([archive({ mark: { path: "/opt/ab/m", sha256: "b".repeat(64) } })]))).toEqual(["setup-archive"]);
    expect(codes(withSteps([archive({ mark: { path: "/opt/a", sha256: "b".repeat(64) } })]))).toEqual(["setup-archive"]);
    for (const strip of [-1, 1.5, 17]) expect(codes(withSteps([archive({ strip })])), String(strip)).toEqual(["setup-archive"]);
    expect(codes(withSteps([archive({ url: "http://example.org/a.tar.xz" })]))).toEqual(["setup-url"]);
    expect(codes(withSteps([archive({ sha256: "A".repeat(64) })]))).toEqual(["setup-sha256"]);
    expect(codes(withSteps([archive({ mark: { path: "/opt/a/m", sha256: "x" } })]))).toEqual(["setup-sha256"]);
    // The folder of an archive is a path that the step writes.
    expect(codes(withSteps([archive({}), file({ id: "f", path: "/opt/a" })]))).toEqual(["setup-path-twice"]);
    // The archive step replaces its whole folder, so no other step writes a path in it, and no archive is in the folder of another.
    expect(codes(withSteps([file({ id: "f", path: "/opt/a/etc/x" }), archive({})]))).toEqual(["setup-path-twice"]);
    const inner = archive({ id: "b", into: "/opt/a/b", mark: { path: "/opt/a/b/m", sha256: "b".repeat(64) } });
    expect(codes(withSteps([archive({}), inner]))).toEqual(["setup-path-twice"]);
    expect(codes(withSteps([archive({}), file({ id: "f", path: "/opt/ab/x" })]))).toEqual([]);
  });

  it("refuses a command that is empty or whose first argument is not a literal program", () => {
    const command = (run: Extract<Step, { kind: "command" }>["run"], check: Extract<Step, { kind: "command" }>["check"] = ["true"]): Step => ({ kind: "command", id: "c", run, check });
    expect(codes(withSteps([command(["install", "-d", "/srv/a"], ["test", "-d", "/srv/a"])]))).toEqual([]);
    expect(codes(withSteps([command(["/usr/bin/env", "true"])]))).toEqual([]);
    for (const run of [[], ["A=1", "x"], ["-x"], [""], ["a b"]]) expect(codes(withSteps([command(run)])), JSON.stringify(run)).toEqual(["setup-program"]);
    expect(codes(withSteps([command([{ $var: "PROGRAM" }])], [{ name: "PROGRAM" }]))).toEqual(["setup-program"]);
    expect(codes(withSteps([command(["true"], [])]))).toEqual(["setup-program"]);
  });

  it("warns for a package step with no package", () => {
    const faults = checkSetup(withSteps([{ kind: "package", id: "p", manager: "apt", names: [] }]), STACK);
    expect(faults.map((fault) => [fault.level, fault.code])).toEqual([["warning", "setup-empty"]]);
  });

  it("refuses profiles of one host whose parts need each other", () => {
    const layer: SetupLayer = {
      schema: SETUP_SCHEMA,
      profiles: [
        { name: "x", part: "x", hosts: ["h"], steps: [file()] },
        { name: "y", part: "y", hosts: ["h"], steps: [file({ path: "/etc/y" })] },
      ],
    };
    expect(checkSetup(layer, STACK).map((fault) => [fault.code, fault.at, fault.host])).toEqual([["setup-cycle", "x", "h"]]);
    // On two different hosts, the two profiles have no order, so they have no cycle.
    expect(codes({ ...layer, profiles: [layer.profiles[0] as Profile, { ...(layer.profiles[1] as Profile), hosts: ["app"] }] })).toEqual([]);
  });
});
