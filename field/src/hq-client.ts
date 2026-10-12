import {
  ApiError,
  apiError,
  ClaimJobOutput,
  JobSummary,
  SubmitResultOutput,
  type CodeFile,
  type JobType,
} from "@sideagent/protocol";

/** An error returned by HQ as `{code, reason, fix_hint}`. */
export class HqApiError extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(`${body.code}: ${body.reason}. ${body.fix_hint}`);
    this.status = status;
    this.body = body;
  }
}

export interface HqClientOptions {
  url: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface NextJobQuery {
  types?: JobType[];
  sameOwner: boolean;
  waitSeconds: number;
}

export type HqClient = ReturnType<typeof createHqClient>;

/** Runner-side REST client. Responses are validated against the protocol schemas. */
export function createHqClient({ url, apiKey, fetch: fetchFn = fetch }: HqClientOptions) {
  async function call<T>(
    schema: { parse(data: unknown): T },
    method: string,
    path: string,
    { body, signal }: { body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const res = await fetchFn(`${url}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: handled below as an HQ error or a schema mismatch.
    }
    if (!res.ok) {
      const err = ApiError.safeParse(json);
      throw new HqApiError(
        res.status,
        err.success
          ? err.data
          : apiError("internal", `HQ returned ${res.status}`, "Check SIDEAGENT_HQ_URL and HQ logs"),
      );
    }
    return schema.parse(json);
  }

  const jobPath = (jobId: string) => `/jobs/${encodeURIComponent(jobId)}`;
  const query = (params: Record<string, string | false | undefined>) => {
    const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
    return entries.length ? `?${new URLSearchParams(entries)}` : "";
  };

  return {
    /** Long-polls for the oldest claimable job; null when none turned up in time. */
    nextJob({ types, sameOwner, waitSeconds }: NextJobQuery, signal?: AbortSignal) {
      const params = query({
        wait: String(waitSeconds),
        types: types?.join(","),
        same_owner: sameOwner && "true",
      });
      // Bounded in case HQ or a proxy holds the request past the long-poll window.
      const timeout = AbortSignal.timeout((waitSeconds + 10) * 1000);
      return call(JobSummary.nullable(), "GET", `/runner/next${params}`, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    },
    claimJob(jobId: string, { sameOwner }: { sameOwner: boolean }) {
      const params = query({ same_owner: sameOwner && "true" });
      return call(ClaimJobOutput, "POST", `${jobPath(jobId)}/claim${params}`);
    },
    submitResult(jobId: string, result: CodeFile[], idempotencyKey: string) {
      return call(SubmitResultOutput, "POST", `${jobPath(jobId)}/submissions`, {
        body: { result, idempotency_key: idempotencyKey },
      });
    },
  };
}
