# Day-1 experiments

Throwaway checks for the cloud-only unknowns (Phase 0). They leave nothing running. Results are recorded in [`docs/technical.md`](../../docs/technical.md#day-1-checks).

These are not workspace packages. To rerun the TypeScript ones, install `@google/genai`, `google-auth-library`, `zod` and `tsx` in a scratch folder, copy the script there and run it with a token for an account that can use the project:

```sh
GCP_PROJECT=sideagent-hq GCP_ACCESS_TOKEN=$(gcloud auth print-access-token) npx tsx gemma.ts
GCP_PROJECT=sideagent-hq GCP_ACCESS_TOKEN=$(gcloud auth print-access-token) MODEL=gemini-2.5-flash-lite npx tsx structured.ts
```

- `gemma.ts`: managed Gemma at the `global` location with function calling.
- `structured.ts`: Gemini structured output from a Zod-derived JSON Schema, with logprobs (`LOGPROBS=0` to turn them off).
- `sandbox-egress.sh`: Cloud Run Job with a bucket mount on a subnet without NAT; checks internet, Google API and metadata server reachability.
