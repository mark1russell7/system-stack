# @mark1russell7/stack-setup

The setup inside a host, from the records of a system stack. The package has typed steps, their order from the needs, a gate and a generator of a shell script.

It is the setup add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The core knows only parts and needs. This package tells how a host gets its packages, users, files, programs, swap and services.

Nobody writes the script by hand. The script is a result of a query over the records, so it changes when the stack changes.

Each function is a plain function with no clock, no network and no file. Only the script makes changes, on the host that starts it.

## The rule

Each step checks before it changes. A step whose check passes changes nothing. Thus a second run of the script shows no change.

After a change, the check of the step must pass. If it does not pass, the script stops with a fault. The fault gives the number of the condition that fails, and no value.

The script holds no secret. A text reads a variable with `{ $var: "NAME" }`, and the script reads the value from its environment.

The generator starts with the gate. A layer with an error gives no script.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-setup` | The records of a layer, the order of the profiles, the gate, the generator of the script and a sample. |
| `@mark1russell7/stack-setup/schema` | `setupSchema`, the zod schema of a layer, with `parseSetup`. |
| `@mark1russell7/stack-setup/add-on` | `setupAddOn`, the add-on in the form of the layer contract of the core. |

The root entry has no schema library. Thus a page that only shows a script gets no zod.

## Install

```sh
npm install @mark1russell7/stack-setup @mark1russell7/system-stack
```

## A layer

A setup layer has variables and profiles. Its format has the name `setup/1`. A stack keeps it in `Stack.layers`, with the key `setup/1`.

A profile sets up one part of the stack on one or more hosts. It has a list of steps.

```ts
import type { SetupLayer } from "@mark1russell7/stack-setup";

const layer: SetupLayer = {
  schema: "setup/1",
  variables: [{ name: "APP_TOKEN", sensitive: true, description: "The token of the program" }],
  profiles: [
    {
      name: "app",
      part: "app",
      hosts: ["host-a"],
      steps: [
        { kind: "user", id: "user", name: "app", shell: "/usr/sbin/nologin" },
        { kind: "file", id: "env", path: "/etc/app/env", text: ["APP_TOKEN=", { $var: "APP_TOKEN" }, "\n"], mode: "600" },
      ],
    },
  ],
};
```

## The steps

| Kind | The change | The check |
| --- | --- | --- |
| `package` | It installs the packages with `apt-get`. | Each package is installed. |
| `user` | It makes a user with a home folder. It sets the login shell, the groups and the SSH keys. | The user has the shell, each group and the keys. |
| `file` | It writes a file with its text, its mode, its owner and its group. | The file has the text, the mode, the owner and the group. |
| `download` | It downloads a file over HTTPS, and it compares the SHA-256. After a transient error, it tries again 4 times in 120 seconds or less. | The file has the SHA-256 and the mode. |
| `archive` | It downloads an archive over HTTPS, and it compares the SHA-256. It extracts the archive into a new folder that only root can change, and puts this folder in the place of the old folder. | The mark file has its SHA-256. Root owns each file of the folder, and only root can change it and each folder above it. |
| `swap` | It makes a swap file of a size in MiB. It turns it on and adds it to `/etc/fstab`. | The file has the size, the swap is on, and `/etc/fstab` has it. |
| `service` | It writes the unit of a `systemd` service, and it enables and starts the service. | The unit has the text, and the service is enabled and active. |
| `command` | It starts a program with its arguments, as root or as a user. It can give a text on the standard input of the program. | Its own check command passes. |

A `command` step starts its program through `env` or `runuser`. Thus no function or builtin of the shell is the program.

The `input` of a `command` step goes to the program through the builtin `printf`. Other users cannot read the input of a process. Thus the input can hold a sensitive variable, for example a key to join a network.

The output of each change goes to the standard error, and thus to the log of the run. A program that prints its input puts the value in the log. Do not start the script with `sh -x`: the trace shows the `printf` line with the value.

The folder of an `archive` step is the folder of an app: `/opt/<name>`, `/srv/<name>` or `/usr/local/<name>`, or a folder in it. The FHS does not keep the name, so `/opt/lib` and `/usr/local/bin` are refused. The gate refuses each other folder, because the step replaces the whole folder.

Before the download, the step makes sure that only root can change each folder above the folder. Root owns each of these folders, and its group and other users cannot write in it. Thus no other user can put a link in the path between two commands. The step makes a folder above that is not there, with the mode `755`.

On some hosts, a group can write in `/opt` or `/usr/local`. For example, `/usr/local` of an old Debian host is `root:staff` with the mode `2775`. The step fails on such a host. To repair the host, start `chown root /usr/local` and `chmod go-w /usr/local` as root. Then the members of the group cannot write in the folder.

The step removes the write of the group and of other users, and the set-user-ID and set-group-ID bits, from each file of the archive. No other step of the host writes a path in the folder.

An `archive` step keeps a program of the old folder that operates. The old folder moves away before the new folder takes its place. The host needs `tar` and the program of the compression, for example `xz-utils` for a `.tar.xz` file.

After a `file` or `download` step changes a file in `/etc/apt/` or `/usr/share/keyrings/`, the next `package` step reads the lists of `apt` again. Thus the `package` step must come after the source step. Put it later in the same profile, or in a profile whose part needs the part of the source step.

## The order

`profileOrder` gives the profiles of a host in the order of the needs. A profile comes after each profile of the host whose part its part needs.

Two profiles whose parts need each other make a cycle. The gate gives the fault `setup-cycle` for it.

## The gate

`checkSetup` gives each fault of a layer for a stack. A list with no error tells that the gate passes.

| Code | Level | The fault |
| --- | --- | --- |
| `setup-name` | error | A name does not have its form: the name of a profile, a variable, a user, a group, a service or a package, or the `id` of a step. |
| `setup-variable-twice` | error | The layer has two variables with one name. |
| `setup-profile-twice` | error | The layer has two profiles with one name. |
| `setup-step-twice` | error | A profile has two steps with one `id`. |
| `setup-part` | error | The part of a profile is not a part of the stack. |
| `setup-host` | error | A profile names no host, or a host that is not a part of the stack. |
| `setup-variable` | error | A text reads a variable that the layer does not have. |
| `setup-secret-exposed` | error | A sensitive variable is in a unit, in the arguments of a command or in a file that each user can read. |
| `setup-text` | error | A text has the character NUL, or a key is not one line. |
| `setup-path` | error | A path is not an absolute path of the safe characters. |
| `setup-path-twice` | error | Two steps of one host write one path, or a step writes a path in the folder of an `archive` step. |
| `setup-user-twice` | error | Two steps of one host set up one user. |
| `setup-mode` | error | A mode is not a mode in octal. |
| `setup-url` | error | An address is not an HTTPS address with a host name. An address with a user or a password is a fault. |
| `setup-sha256` | error | A SHA-256 is not 64 lowercase hexadecimal digits. |
| `setup-swap-size` | error | The size of a swap file is not a whole number of MiB from 1 to 65536. |
| `setup-archive` | error | The folder of an archive is not the folder of an app in `/opt`, `/srv` or `/usr/local`. Or its mark is not in the folder, or its count to strip is not 0 to 16. |
| `setup-program` | error | A command is empty, or its first argument is not a literal program. |
| `setup-cycle` | error | The parts of the profiles of one host need each other. |
| `setup-variable-unused` | warning | No step reads a variable. |
| `setup-empty` | warning | A profile has no step, or a package step names no package. |

## The script

`setupScript` gives the script of one host. The script is POSIX `sh`, and it passes `shellcheck -s sh`. It needs root, `apt-get`, `systemd` and the GNU tools.

```ts
import { SAMPLE_STACK } from "@mark1russell7/system-stack";
import { SAMPLE_SETUP, setupScript } from "@mark1russell7/stack-setup";

const result = setupScript(SAMPLE_SETUP, SAMPLE_STACK, "cloud-host");
if (result.ok) console.log(result.script);
```

The first argument of the script is the mode:

- `apply` makes each change. It is the default.
- `check` makes no change. It tells each step that has a change.

Give the value of each variable in the environment of the script:

```sh
sudo env APP_TOKEN="$APP_TOKEN" sh setup.sh check
```

| Exit code | The result |
| --- | --- |
| 0 | Each step is ok. |
| 1 | A step failed. |
| 2 | The mode `check` found a change. |
| 64 | A usage fault: a mode that is not known, a start that is not root, or a variable with no value. |

Each step writes one line: `ok`, `change` or `changed`, and the address of the step. The last line gives the count of the changes.

## The test on a host

A unit test cannot tell if a shell operates the script correctly. The test `e2e/setup.e2e.ts` starts a script on a CI runner, which is a new machine for each job.

The test examines `shellcheck` and the exit codes. It examines a first start with changes, and a second start with no change. It also examines the records on the host and the repair of a changed file.

```sh
pnpm --filter @mark1russell7/stack-setup run test:setup
```

The test needs root through `sudo`. Start it only on a machine that you can discard.

## License

MIT
