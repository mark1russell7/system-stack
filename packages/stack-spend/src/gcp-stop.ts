/**
 * The entry `@mark1russell7/stack-spend/gcp-stop`: a stop by code for a project of Google Cloud.
 *
 * A budget of the project sends a notification to a Pub/Sub topic some times each day. A function reads each notification.
 * When the cost of the month is at the amount of the budget, the function removes the billing account of the project.
 * Then Google stops the paid services of the project. This is the limit of the kind `code`, with the function as its `stop`.
 *
 * The entry has no dependencies and no clock. The caller gives the `fetch`, so a test gives a fake.
 */

/** The fields of a budget notification that the stop uses. */
export interface BudgetNotification {
  /** The name of the budget. */
  readonly budgetDisplayName: string;
  /** The cost of the period of the budget, up to the time of the notification. */
  readonly costAmount: number;
  /** The amount of the budget. */
  readonly budgetAmount: number;
  /** The currency of the two amounts, for example `USD`. */
  readonly currencyCode: string;
  /** The start of the period of the budget, as an ISO 8601 time. */
  readonly costIntervalStart: string;
}

/** The result of a read of a notification: the notification, or the reason that the read failed. */
export type NotificationRead = { readonly ok: true; readonly notification: BudgetNotification } | { readonly ok: false; readonly error: string };

/** The decision of the stop for one notification. */
export interface StopDecision {
  /** `true` when the cost is at the amount of the budget or above it. */
  readonly stop: boolean;
  /** The decision in words, with the two amounts. */
  readonly reason: string;
}

/** One request of the stop, as data. The headers can hold a token, so do not write a request to a log. */
export interface StopRequest {
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** The answer of a request, with only the parts that the stop reads. The global `fetch` gives this form. */
export interface StopAnswer {
  readonly status: number;
  text(): Promise<string>;
}

/** The function that sends a request. The global `fetch` is such a function. */
export type StopFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<StopAnswer>;

/**
 * The result of the stop for one notification. It holds no token.
 *
 * - `refused`: the notification has a fault of form, so the stop does nothing.
 * - `kept`: the cost is below the amount. `ready` tells if the identity of the function can remove the billing account.
 * - `stopped`: the stop removed the billing account of the project.
 * - `already`: the project had no billing account.
 * - `failed`: a request failed. The next notification tries again.
 */
export type StopOutcome =
  | { readonly action: "refused"; readonly reason: string }
  | { readonly action: "kept"; readonly reason: string; readonly project: string; readonly ready: boolean }
  | { readonly action: "stopped" | "already"; readonly reason: string; readonly project: string }
  | { readonly action: "failed"; readonly reason: string };

/** The root of the metadata server of Google Cloud. A function gets its token and its project from it. */
export const METADATA_URL = "http://metadata.google.internal/computeMetadata/v1";

/** The root of the Cloud Billing API. */
export const BILLING_URL = "https://cloudbilling.googleapis.com/v1";

/** The root of the Cloud Resource Manager API. */
export const RESOURCE_MANAGER_URL = "https://cloudresourcemanager.googleapis.com/v1";

/** The permission that lets the identity of the function remove the billing account of the project. */
export const STOP_PERMISSION = "resourcemanager.projects.deleteBillingAssignment";

/** The rule of a project id of Google Cloud: 6 to 30 characters, lowercase letters, digits and hyphens, and a letter first. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** This function tells if a text is a project id of Google Cloud. A request puts the id in its path, so the stop examines it. */
export function isProjectId(value: string): boolean {
  return PROJECT_ID.test(value);
}

// The build of the package is for each platform, so its types have no DOM and no Node. Node, Deno and each browser have these two globals.
declare const atob: (data: string) => string;
declare const TextDecoder: new (label: string, options: { fatal: boolean }) => { decode(input: Uint8Array): string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** This function decodes base64 text to UTF-8 text, or gives `undefined` for text that is not base64. */
function fromBase64(text: string): string | undefined {
  try {
    const bytes = Uint8Array.from(atob(text), (character: string) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * This function reads a budget notification from the data of a CloudEvent of Pub/Sub. The data has the form
 * `{ message: { data } }`, and `data` is the notification as base64 JSON.
 */
export function readNotification(data: unknown): NotificationRead {
  const message = isRecord(data) && isRecord(data["message"]) ? data["message"] : undefined;
  const encoded = message?.["data"];
  if (typeof encoded !== "string") return { ok: false, error: "The event has no message data." };
  const text = fromBase64(encoded);
  if (text === undefined) return { ok: false, error: "The message data is not base64 UTF-8 text." };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "The message data is not JSON." };
  }
  if (!isRecord(value)) return { ok: false, error: "The notification is not an object." };
  const { costAmount, budgetAmount } = value;
  if (typeof costAmount !== "number" || !Number.isFinite(costAmount) || costAmount < 0) return { ok: false, error: "The field costAmount is not a number of 0 or more." };
  if (typeof budgetAmount !== "number" || !Number.isFinite(budgetAmount) || budgetAmount <= 0) return { ok: false, error: "The field budgetAmount is not a number above 0." };
  // The stop needs only the two amounts. A text field that is not there does not stop the stop: it becomes an empty text.
  const record = value;
  const textOf = (field: string): string => {
    const found = record[field];
    return typeof found === "string" ? found : "";
  };
  return {
    ok: true,
    notification: { budgetDisplayName: textOf("budgetDisplayName"), costAmount, budgetAmount, currencyCode: textOf("currencyCode"), costIntervalStart: textOf("costIntervalStart") },
  };
}

/** This function decides the stop: the stop acts when the cost is at the amount of the budget or above it. */
export function decideStop(notification: BudgetNotification): StopDecision {
  const { costAmount, budgetAmount, currencyCode, budgetDisplayName } = notification;
  const amounts = `${String(costAmount)} ${currencyCode} of ${String(budgetAmount)} ${currencyCode}`;
  return costAmount >= budgetAmount
    ? { stop: true, reason: `The cost of the budget "${budgetDisplayName}" is at its amount: ${amounts}.` }
    : { stop: false, reason: `The cost of the budget "${budgetDisplayName}" is below its amount: ${amounts}.` };
}

/** This function gives the request of the token of the identity of the function, to the metadata server. */
export function tokenRequest(): StopRequest {
  return { method: "GET", url: `${METADATA_URL}/instance/service-accounts/default/token`, headers: { "metadata-flavor": "Google" } };
}

/** This function gives the request of the id of the project of the function, to the metadata server. */
export function projectRequest(): StopRequest {
  return { method: "GET", url: `${METADATA_URL}/project/project-id`, headers: { "metadata-flavor": "Google" } };
}

function checkedProject(project: string): string {
  if (!isProjectId(project)) throw new Error("The project id is not a project id of Google Cloud.");
  return project;
}

/** This function gives the request that reads the billing state of a project. */
export function billingInfoRequest(project: string, token: string): StopRequest {
  return { method: "GET", url: `${BILLING_URL}/projects/${checkedProject(project)}/billingInfo`, headers: { authorization: `Bearer ${token}` } };
}

/** This function gives the request that removes the billing account of a project: a billing account name that is empty. */
export function detachRequest(project: string, token: string): StopRequest {
  return {
    method: "PUT",
    url: `${BILLING_URL}/projects/${checkedProject(project)}/billingInfo`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ billingAccountName: "" }),
  };
}

/** This function gives the request that tells if the identity of the function holds the permission of the stop. */
export function permissionRequest(project: string, token: string): StopRequest {
  return {
    method: "POST",
    url: `${RESOURCE_MANAGER_URL}/projects/${checkedProject(project)}:testIamPermissions`,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ permissions: [STOP_PERMISSION] }),
  };
}

/** A failed request, with a reason that holds no token. */
class RequestFailure extends Error {}

async function send(fetch: StopFetch, request: StopRequest, what: string): Promise<string> {
  const init = { method: request.method, headers: { ...request.headers }, ...(request.body === undefined ? {} : { body: request.body }) };
  let answer: StopAnswer;
  try {
    answer = await fetch(request.url, init);
  } catch (error) {
    throw new RequestFailure(`The request of ${what} failed: ${error instanceof Error ? error.name : "an error"}.`);
  }
  const text = await answer.text();
  if (answer.status !== 200) throw new RequestFailure(`The request of ${what} gave the status ${String(answer.status)}.`);
  return text;
}

function json(text: string, what: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value)) return value;
  } catch {
    // The text is not JSON. The next line gives the failure.
  }
  throw new RequestFailure(`The answer of ${what} is not a JSON object.`);
}

/**
 * This function is the stop. It reads the notification, and it decides. Below the amount, it examines that the identity of
 * the function holds the permission of the stop. At the amount, it removes the billing account of the project, if the
 * project has one.
 *
 * @param data - The data of the CloudEvent of Pub/Sub
 * @param fetch - The function that sends a request, for example the global `fetch`
 */
export async function stopBilling(data: unknown, fetch: StopFetch): Promise<StopOutcome> {
  const read = readNotification(data);
  if (!read.ok) return { action: "refused", reason: read.error };
  const decision = decideStop(read.notification);
  try {
    const project = (await send(fetch, projectRequest(), "the project id")).trim();
    if (!isProjectId(project)) return { action: "failed", reason: "The metadata server gave a text that is not a project id." };
    const tokenText = await send(fetch, tokenRequest(), "the token");
    const token = json(tokenText, "the token")["access_token"];
    if (typeof token !== "string" || token === "") return { action: "failed", reason: "The answer of the token has no access_token." };
    if (!decision.stop) {
      const held = json(await send(fetch, permissionRequest(project, token), "the permissions"), "the permissions")["permissions"];
      const ready = Array.isArray(held) && held.includes(STOP_PERMISSION);
      return { action: "kept", reason: decision.reason, project, ready };
    }
    const info = json(await send(fetch, billingInfoRequest(project, token), "the billing state"), "the billing state");
    if (info["billingEnabled"] !== true) return { action: "already", reason: `${decision.reason} The project has no billing account.`, project };
    await send(fetch, detachRequest(project, token), "the removal of the billing account");
    return { action: "stopped", reason: `${decision.reason} The stop removed the billing account of the project.`, project };
  } catch (error) {
    if (error instanceof RequestFailure) return { action: "failed", reason: error.message };
    throw error;
  }
}

/** The options of the script that makes the stop of a project. */
export interface StopScriptOptions {
  /** The id of the project. */
  readonly project: string;
  /** The amount of the budget for each month. */
  readonly amount: number;
  /** The currency of the billing account, for example `USD`. */
  readonly currency: string;
  /** The version range of this package in the source of the function, for example `^0.1.8`. */
  readonly version: string;
  /** The region of the function. The default is `us-central1`. */
  readonly region?: string;
  /** The name of the topic, of the function and of its identity. The default is `billing-stop`. */
  readonly name?: string;
}

/** The version range of the Functions Framework in the source of the function. */
export const FRAMEWORK_RANGE = "^5.0.5";

/** The runtime of the function. */
export const STOP_RUNTIME = "nodejs22";

/** The name of the entry point of the function. */
export const STOP_ENTRY_POINT = "billingStop";

/** This function gives the source of the function: its `package.json` and its `index.js`. */
export function stopSource(version: string): { readonly packageJson: string; readonly indexJs: string } {
  if (!/^[\^~]?\d+\.\d+\.\d+$/.test(version)) throw new Error("The version is not a version range of the form ^1.2.3.");
  const packageJson = JSON.stringify(
    {
      name: "billing-stop",
      private: true,
      type: "module",
      main: "index.js",
      dependencies: { "@google-cloud/functions-framework": FRAMEWORK_RANGE, "@mark1russell7/stack-spend": version },
    },
    null,
    2,
  );
  const indexJs = [
    'import functions from "@google-cloud/functions-framework";',
    'import { stopBilling } from "@mark1russell7/stack-spend/gcp-stop";',
    "",
    "// The function gets each budget notification. A failure or an identity with no permission gives an error in the log.",
    `functions.cloudEvent("${STOP_ENTRY_POINT}", async (event) => {`,
    "  const outcome = await stopBilling(event.data, fetch);",
    "  console.log(JSON.stringify(outcome));",
    '  if (outcome.action === "failed") throw new Error(outcome.reason);',
    '  if (outcome.action === "kept" && !outcome.ready) throw new Error("The identity of the function cannot remove the billing account.");',
    "});",
  ].join("\n");
  return { packageJson, indexJs };
}

/**
 * This function gives a Bash script for Cloud Shell. The script makes the stop of a project: a budget for each month, a
 * Pub/Sub topic, the identity of the function, and the function. Then it tests the function with a cost of 0.
 *
 * The script has no key and makes no key. It reads the billing account of the project when it starts, so the text does not
 * hold the account id. A second run changes nothing that is already made.
 */
export function stopScript(options: StopScriptOptions): string {
  const { project, amount, currency, version } = options;
  const region = options.region ?? "us-central1";
  const name = options.name ?? "billing-stop";
  if (!isProjectId(project)) throw new Error("The project id is not a project id of Google Cloud.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("The amount is not a number above 0.");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("The currency is not a code of three letters.");
  if (!/^[a-z]+-[a-z]+\d+$/.test(region)) throw new Error("The region is not a region of Google Cloud.");
  if (!isProjectId(name)) throw new Error("The name is not 6 to 30 lowercase letters, digits and hyphens.");
  const source = stopSource(version);
  const money = `${String(amount)} ${currency}`;
  return `#!/usr/bin/env bash
# The stop of the cost of the project ${project}: a budget of ${money} for each month, a Pub/Sub topic and a function.
# When the cost of a month gets to ${money}, the function removes the billing account of the project.
#
# What a stop does:
# - Google stops the paid services of the project. A server stops, also a server in the free tier.
# - Google keeps the disks and the data for a time. It can delete the resources of a project with no billing account.
# - The cost data of Google comes some hours late. Thus the cost can go a little above ${money} before the stop.
#
# How to undo a stop:
# 1. Raise the amount of the budget, or wait for the next month. Else the next notification stops the project again.
# 2. Link the billing account again: gcloud billing projects link ${project} --billing-account=<the account id>
# 3. Start each server again: gcloud compute instances start <the server> --zone=<its zone>
#
# Run this script in Cloud Shell, as the owner of the project and of its billing account.
set -euo pipefail

PROJECT="${project}"
NAME="${name}"
REGION="${region}"
AMOUNT="${String(amount)}"
CURRENCY="${currency}"
SA="$NAME@$PROJECT.iam.gserviceaccount.com"
DISPLAY="$NAME $AMOUNT $CURRENCY"

gcloud config set project "$PROJECT"
ACCOUNT="$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)')"
ACCOUNT="\${ACCOUNT#billingAccounts/}"
if [ -z "$ACCOUNT" ]; then
  echo "The project $PROJECT has no billing account. Link it, then run this script again."
  exit 1
fi

echo "1/6 Turn on the APIs."
gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com cloudresourcemanager.googleapis.com

echo "2/6 Make the identity of the function."
gcloud iam service-accounts describe "$SA" > /dev/null 2>&1 || gcloud iam service-accounts create "$NAME" --display-name="The stop of the cost"
# The role Project Billing Manager lets the function remove the billing account of this project only.
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/billing.projectManager" --condition=None > /dev/null
# The trigger calls the function with the same identity.
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="roles/run.invoker" --condition=None > /dev/null

echo "3/6 Make the topic."
gcloud pubsub topics describe "$NAME" > /dev/null 2>&1 || gcloud pubsub topics create "$NAME"

echo "4/6 Deploy the function."
SOURCE="$(mktemp -d)"
cat > "$SOURCE/package.json" <<'JSON'
${source.packageJson}
JSON
cat > "$SOURCE/index.js" <<'JS'
${source.indexJs}
JS
gcloud functions deploy "$NAME" --gen2 --runtime=${STOP_RUNTIME} --region="$REGION" --source="$SOURCE" --entry-point=${STOP_ENTRY_POINT} --trigger-topic="$NAME" --service-account="$SA" --trigger-service-account="$SA" --max-instances=1 --memory=256Mi --quiet

echo "5/6 Make the budget."
if [ -z "$(gcloud billing budgets list --billing-account="$ACCOUNT" --filter="displayName='$DISPLAY'" --format='value(name)')" ]; then
  gcloud billing budgets create --billing-account="$ACCOUNT" --display-name="$DISPLAY" --budget-amount="$AMOUNT$CURRENCY" --calendar-period=month --filter-projects="projects/$PROJECT" --threshold-rule=percent=0.5 --threshold-rule=percent=0.8 --threshold-rule=percent=1.0 --notifications-rule-pubsub-topic="projects/$PROJECT/topics/$NAME"
fi

echo "6/6 Test the function with a cost of 0. This test does not stop the project."
gcloud pubsub topics publish "$NAME" --message="{\\"budgetDisplayName\\":\\"$DISPLAY test\\",\\"costAmount\\":0,\\"budgetAmount\\":$AMOUNT,\\"currencyCode\\":\\"$CURRENCY\\",\\"costIntervalStart\\":\\"$(date -u +%Y-%m-01T00:00:00Z)\\"}"
sleep 90
gcloud functions logs read "$NAME" --gen2 --region="$REGION" --limit=10
echo "The stop is live when a line of the log has \\"action\\":\\"kept\\" and \\"ready\\":true."
`;
}
