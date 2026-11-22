import { errorMessage } from "@mark1russell7/text";
import { ApiError, send, type Pace, type Reply, type Transport } from "polite-crawler/api";

// The requests of the fit job. Each request goes through `send` of polite-crawler, at the pace of its host.
// The host scheduler of polite-crawler waits the backoff after a failure. `withTries` only counts the tries.

/** The parts of a fit: the pace, the transport, the bytes of a range request and the log. */
export interface FitContext {
  readonly pace: Pace;
  readonly transport: Transport;
  readonly chunkBytes: number;
  readonly log: (line: string) => void;
}

/** The tries of one request. The scheduler of the host waits its backoff before each new try. */
export const RANGE_TRIES = 4;

/** A fault of one try that a new try can correct: a status 429 or 5xx, or a part that is too short. */
export class TryFault extends Error {}

/** This function tells if a new try can correct a status. */
export const passing = (status: number): boolean => status === 429 || status >= 500;

// A signed URL of the storage is a short credential, so no message holds a query.
const noQuery = (text: string): string => text.replace(/\?\S*/g, "?<query>");

/** This function sends one GET request to a source at the pace of its host. It gives the answer with each status. */
export async function get(context: FitContext, source: string, url: string, what: string, headers: Readonly<Record<string, string>> = {}, read?: "bytes"): Promise<Reply> {
  const exchange = { method: "GET", url, headers: { "accept-encoding": "identity", ...headers }, body: null, read };
  const answer = await send(context.pace, context.transport, { source, host: new URL(url).host, what, exchange, redact: noQuery });
  return answer.reply;
}

/**
 * This function does a try up to `RANGE_TRIES` times. A try with no answer or with a `TryFault` comes again.
 * After the last try, its fault stops the run. Each other fault stops the run at once.
 */
export async function withTries<T>(context: FitContext, what: string, attempt: () => Promise<T>): Promise<T> {
  for (let count = 1; ; count += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (count >= RANGE_TRIES || !(error instanceof TryFault || error instanceof ApiError)) throw error;
      context.log(`${what}: try ${String(count)} failed (${errorMessage(error)}). It comes again.`);
    }
  }
}
