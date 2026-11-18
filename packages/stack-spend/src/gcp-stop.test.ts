import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BILLING_URL,
  billingInfoRequest,
  decideStop,
  detachRequest,
  isProjectId,
  METADATA_URL,
  permissionRequest,
  projectRequest,
  readNotification,
  RESOURCE_MANAGER_URL,
  STOP_PERMISSION,
  stopBilling,
  type StopFetch,
  stopScript,
  stopSource,
  tokenRequest,
} from "./gcp-stop.ts";

const TOKEN = "token-value-of-the-test";
const PROJECT = "sample-project-1";

/** This function gives the data of a CloudEvent of Pub/Sub with a notification as base64 JSON. */
function event(notification: unknown): unknown {
  const text = typeof notification === "string" ? notification : JSON.stringify(notification);
  return { subscription: "projects/p/subscriptions/s", message: { messageId: "1", data: btoa(String.fromCharCode(...new TextEncoder().encode(text))) } };
}

const notice = (costAmount: number, budgetAmount = 5): Record<string, unknown> => ({
  budgetDisplayName: "billing-stop 5 USD",
  costAmount,
  budgetAmount,
  budgetAmountType: "SPECIFIED_AMOUNT",
  currencyCode: "USD",
  costIntervalStart: "2026-11-01T07:00:00Z",
  alertThresholdExceeded: 1,
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

/** A fake fetch: each key `METHOD URL` gives a status and a body. It records each request. */
function fakeFetch(routes: Readonly<Record<string, readonly [number, string] | Error>>): { fetch: StopFetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: StopFetch = (url, init) => {
    sent.push({ url, ...init });
    const route = routes[`${init.method} ${url}`];
    if (route === undefined) return Promise.resolve({ status: 404, text: () => Promise.resolve("{}") });
    if (route instanceof Error) return Promise.reject(route);
    return Promise.resolve({ status: route[0], text: () => Promise.resolve(route[1]) });
  };
  return { fetch, sent };
}

const base = {
  [`GET ${METADATA_URL}/project/project-id`]: [200, PROJECT],
  [`GET ${METADATA_URL}/instance/service-accounts/default/token`]: [200, JSON.stringify({ access_token: TOKEN, expires_in: 3599, token_type: "Bearer" })],
  [`POST ${RESOURCE_MANAGER_URL}/projects/${PROJECT}:testIamPermissions`]: [200, JSON.stringify({ permissions: [STOP_PERMISSION] })],
  [`GET ${BILLING_URL}/projects/${PROJECT}/billingInfo`]: [200, JSON.stringify({ projectId: PROJECT, billingEnabled: true })],
  [`PUT ${BILLING_URL}/projects/${PROJECT}/billingInfo`]: [200, JSON.stringify({ projectId: PROJECT, billingEnabled: false })],
} as const satisfies Record<string, readonly [number, string]>;

describe("readNotification", () => {
  it("reads a budget notification of Pub/Sub", () => {
    expect(readNotification(event(notice(1.25)))).toEqual({
      ok: true,
      notification: { budgetDisplayName: "billing-stop 5 USD", costAmount: 1.25, budgetAmount: 5, currencyCode: "USD", costIntervalStart: "2026-11-01T07:00:00Z" },
    });
  });

  it("reads a name with characters that are not ASCII", () => {
    const read = readNotification(event({ ...notice(0), budgetDisplayName: "Stopp für 5 €" }));
    expect(read.ok && read.notification.budgetDisplayName).toBe("Stopp für 5 €");
  });

  it("needs only the two amounts", () => {
    expect(readNotification(event({ costAmount: 6, budgetAmount: 5 }))).toEqual({
      ok: true,
      notification: { budgetDisplayName: "", costAmount: 6, budgetAmount: 5, currencyCode: "", costIntervalStart: "" },
    });
  });

  it("refuses an event with a fault of form", () => {
    expect(readNotification(undefined)).toEqual({ ok: false, error: "The event has no message data." });
    expect(readNotification({ message: { data: "%%%" } })).toEqual({ ok: false, error: "The message data is not base64 UTF-8 text." });
    expect(readNotification(event("not json"))).toEqual({ ok: false, error: "The message data is not JSON." });
    expect(readNotification(event([1]))).toEqual({ ok: false, error: "The notification is not an object." });
    expect(readNotification(event({ ...notice(0), costAmount: "1" }))).toMatchObject({ ok: false, error: expect.stringContaining("costAmount") as unknown });
    expect(readNotification(event({ ...notice(-1) }))).toMatchObject({ ok: false });
    expect(readNotification(event({ ...notice(1, 0) }))).toMatchObject({ ok: false, error: expect.stringContaining("budgetAmount") as unknown });
  });
});

describe("decideStop", () => {
  it("stops at the amount and above it, and not below it", () => {
    const decide = (cost: number): boolean => {
      const read = readNotification(event(notice(cost)));
      if (!read.ok) throw new Error(read.error);
      return decideStop(read.notification).stop;
    };
    expect([4.99, 5, 5.01].map(decide)).toEqual([false, true, true]);
  });

  it("stops when the cost is at the amount or above it, for each pair of amounts", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0.01, max: 1e6, noNaN: true }), (costAmount, budgetAmount) => {
        const decision = decideStop({ budgetDisplayName: "b", costAmount, budgetAmount, currencyCode: "USD", costIntervalStart: "" });
        return decision.stop === costAmount >= budgetAmount;
      }),
    );
  });

  it("gives the two amounts in the reason", () => {
    expect(decideStop({ budgetDisplayName: "b", costAmount: 2, budgetAmount: 5, currencyCode: "USD", costIntervalStart: "" }).reason).toBe(
      'The cost of the budget "b" is below its amount: 2 USD of 5 USD.',
    );
  });
});

describe("the requests", () => {
  it("asks the metadata server with its header", () => {
    expect(tokenRequest()).toEqual({ method: "GET", url: `${METADATA_URL}/instance/service-accounts/default/token`, headers: { "metadata-flavor": "Google" } });
    expect(projectRequest().url).toBe(`${METADATA_URL}/project/project-id`);
  });

  it("removes the billing account with an empty name", () => {
    const request = detachRequest(PROJECT, TOKEN);
    expect(request).toMatchObject({ method: "PUT", url: `${BILLING_URL}/projects/${PROJECT}/billingInfo`, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(JSON.parse(request.body ?? "")).toEqual({ billingAccountName: "" });
    expect(billingInfoRequest(PROJECT, TOKEN)).toMatchObject({ method: "GET", url: `${BILLING_URL}/projects/${PROJECT}/billingInfo` });
    expect(JSON.parse(permissionRequest(PROJECT, TOKEN).body ?? "")).toEqual({ permissions: [STOP_PERMISSION] });
  });

  it("refuses a project id that is not a project id", () => {
    for (const bad of ["", "Upper-case1", "a/../b-project", "1starts-with-digit", "short", "ends-with-hyphen-"]) {
      expect(isProjectId(bad)).toBe(false);
      expect(() => detachRequest(bad, TOKEN)).toThrow("not a project id");
    }
    expect(isProjectId(PROJECT)).toBe(true);
  });
});

describe("stopBilling", () => {
  it("keeps the project below the amount, and tells that the stop is ready", async () => {
    const { fetch, sent } = fakeFetch(base);
    expect(await stopBilling(event(notice(1)), fetch)).toEqual({
      action: "kept",
      project: PROJECT,
      ready: true,
      reason: 'The cost of the budget "billing-stop 5 USD" is below its amount: 1 USD of 5 USD.',
    });
    expect(sent.some((request) => request.method === "PUT")).toBe(false);
  });

  it("tells that the stop is not ready when the identity does not hold the permission", async () => {
    const { fetch } = fakeFetch({ ...base, [`POST ${RESOURCE_MANAGER_URL}/projects/${PROJECT}:testIamPermissions`]: [200, "{}"] });
    expect(await stopBilling(event(notice(1)), fetch)).toMatchObject({ action: "kept", ready: false });
  });

  it("removes the billing account at the amount", async () => {
    const { fetch, sent } = fakeFetch(base);
    expect(await stopBilling(event(notice(5)), fetch)).toEqual({
      action: "stopped",
      project: PROJECT,
      reason: 'The cost of the budget "billing-stop 5 USD" is at its amount: 5 USD of 5 USD. The stop removed the billing account of the project.',
    });
    const put = sent.find((request) => request.method === "PUT");
    expect(put?.body).toBe(JSON.stringify({ billingAccountName: "" }));
    expect(put?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("does nothing more when the project has no billing account", async () => {
    const { fetch, sent } = fakeFetch({ ...base, [`GET ${BILLING_URL}/projects/${PROJECT}/billingInfo`]: [200, JSON.stringify({ billingEnabled: false })] });
    expect(await stopBilling(event(notice(7)), fetch)).toMatchObject({ action: "already", project: PROJECT });
    expect(sent.some((request) => request.method === "PUT")).toBe(false);
  });

  it("refuses a notification with a fault of form, and sends no request", async () => {
    const { fetch, sent } = fakeFetch(base);
    expect(await stopBilling(event("x"), fetch)).toEqual({ action: "refused", reason: "The message data is not JSON." });
    expect(sent).toEqual([]);
  });

  it("gives a failure with no token when a request fails", async () => {
    const cases = [
      { ...base, [`PUT ${BILLING_URL}/projects/${PROJECT}/billingInfo`]: [403, JSON.stringify({ error: { message: `no ${TOKEN}` } })] as const },
      { ...base, [`GET ${METADATA_URL}/instance/service-accounts/default/token`]: [200, "{}"] as const },
      { ...base, [`GET ${METADATA_URL}/instance/service-accounts/default/token`]: [200, "not json"] as const },
      { ...base, [`GET ${METADATA_URL}/project/project-id`]: [200, "Not/A/Project"] as const },
      { ...base, [`GET ${BILLING_URL}/projects/${PROJECT}/billingInfo`]: new TypeError(`fetch failed ${TOKEN}`) },
    ];
    const outcomes = [];
    for (const routes of cases) outcomes.push(await stopBilling(event(notice(9)), fakeFetch(routes).fetch));
    expect(outcomes.map((outcome) => outcome.action)).toEqual(["failed", "failed", "failed", "failed", "failed"]);
    expect(outcomes.map((outcome) => outcome.reason)).toEqual([
      "The request of the removal of the billing account gave the status 403.",
      "The answer of the token has no access_token.",
      "The answer of the token is not a JSON object.",
      "The metadata server gave a text that is not a project id.",
      "The request of the billing state failed: TypeError.",
    ]);
    expect(JSON.stringify(outcomes)).not.toContain(TOKEN);
  });
});

describe("the script of the stop", () => {
  const options = { project: PROJECT, amount: 5, currency: "USD", version: "^0.1.8" };

  it("gives the source of the function", () => {
    const source = stopSource("^0.1.8");
    expect(JSON.parse(source.packageJson)).toMatchObject({
      type: "module",
      main: "index.js",
      dependencies: { "@mark1russell7/stack-spend": "^0.1.8" },
    });
    expect(source.indexJs).toContain('import { stopBilling } from "@mark1russell7/stack-spend/gcp-stop";');
    expect(() => stopSource("latest")).toThrow("version range");
  });

  it("makes each part with the names of the options, and reads the billing account when it runs", () => {
    const script = stopScript(options);
    expect(script).toContain(`PROJECT="${PROJECT}"`);
    expect(script).toContain('NAME="billing-stop"');
    expect(script).toContain('DISPLAY="$NAME $AMOUNT $CURRENCY"');
    expect(script).toContain('--role="roles/billing.projectManager"');
    expect(script).toContain("--trigger-topic=\"$NAME\"");
    expect(script).toContain("--threshold-rule=percent=1.0");
    expect(script).toContain('ACCOUNT="${ACCOUNT#billingAccounts/}"');
    expect(script).toContain("How to undo a stop:");
    expect(script).not.toMatch(/billingAccounts\/[0-9A-F]{6}-/);
  });

  it("refuses options with a fault", () => {
    expect(() => stopScript({ ...options, project: "Bad" })).toThrow("project id");
    expect(() => stopScript({ ...options, amount: 0 })).toThrow("amount");
    expect(() => stopScript({ ...options, currency: "usd" })).toThrow("currency");
    expect(() => stopScript({ ...options, region: "us central1" })).toThrow("region");
    expect(() => stopScript({ ...options, name: "Billing Stop" })).toThrow("name");
  });

  // A check that cannot run gives no read: with no bash, this test is skipped, not passed.
  const bash = spawnSync("bash", ["--version"], { encoding: "utf8" }).status === 0;
  it.skipIf(!bash)("gives a script with no fault of syntax", () => {
    const check = spawnSync("bash", ["-n"], { input: stopScript(options), encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });

  it("gives a function source with no fault of syntax", () => {
    const folder = mkdtempSync(join(tmpdir(), "gcp-stop-"));
    try {
      const file = join(folder, "index.mjs");
      writeFileSync(file, stopSource("^0.1.8").indexJs);
      const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      expect(check.stderr).toBe("");
      expect(check.status).toBe(0);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
