import { SETUP_SCHEMA, type SetupLayer } from "./layer.ts";

/** The unit of the sample service. Each name in it is an example. */
const SAMPLE_UNIT = [
  "[Unit]",
  "Description=The alert program",
  "After=network-online.target",
  "Wants=network-online.target",
  "",
  "[Service]",
  "User=alerts",
  "EnvironmentFile=/etc/alerts/env",
  "ExecStart=/opt/alerts/alerts",
  "Restart=on-failure",
  "",
  "[Install]",
  "WantedBy=multi-user.target",
  "",
].join("\n");

/**
 * A sample setup layer for `SAMPLE_STACK` of the core. Each name, address and checksum is an example: the file at the address does not exist.
 *
 * - The profile `program` sets up the part `program-cloud` on the host `cloud-host`: the program, its environment file and its service.
 * - The profile `base` sets up the host itself: the packages, a swap file and the user of the program.
 *
 * The layer has `program` first. The part `program-cloud` needs `cloud-host`, so the order of the setup has `base` first.
 */
export const SAMPLE_SETUP: SetupLayer = {
  schema: SETUP_SCHEMA,
  variables: [{ name: "ALERTS_TOKEN", sensitive: true, description: "The token of the push service" }],
  profiles: [
    {
      name: "program",
      part: "program-cloud",
      hosts: ["cloud-host"],
      steps: [
        {
          kind: "download",
          id: "binary",
          url: "https://example.org/alerts/1.4.0/alerts",
          sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          path: "/opt/alerts/alerts",
          mode: "755",
        },
        { kind: "file", id: "env", path: "/etc/alerts/env", text: ["ALERTS_TOKEN=", { $var: "ALERTS_TOKEN" }, "\n"], mode: "600" },
        { kind: "command", id: "data", run: ["install", "-d", "-o", "alerts", "-g", "alerts", "/var/lib/alerts"], check: ["test", "-d", "/var/lib/alerts"] },
        { kind: "service", id: "service", name: "alerts", unit: SAMPLE_UNIT },
      ],
    },
    {
      name: "base",
      part: "cloud-host",
      hosts: ["cloud-host"],
      steps: [
        { kind: "package", id: "packages", manager: "apt", names: ["ca-certificates", "curl"] },
        { kind: "swap", id: "swap", path: "/swapfile", mib: 1024 },
        { kind: "user", id: "user", name: "alerts", groups: ["systemd-journal"], shell: "/usr/sbin/nologin" },
      ],
    },
  ],
};
