import type { JobView } from "@sideagent/protocol";
import { collection, query, where, type Timestamp } from "firebase/firestore";

export type Job = JobView<Timestamp> & { id: string };

/**
 * Jobs the signed-in owner posted or holds a claim on, newest first. Two queries because the
 * rules allow each side separately (infra/firestore.rules). Unbounded: a limit needs composite
 * indexes on `createdAt`, which come with the Phase 7 deploy.
 */
export function useJobs() {
  const { db } = useNuxtApp().$firebase;
  const { owner } = useOwner();
  const byField = (field: string) => () => {
    const uid = owner.value?.owner_id;
    return uid ? query(collection(db, "jobs"), where(field, "==", uid)) : null;
  };
  const posted = useLiveQuery<JobView<Timestamp>>(byField("posterOwnerId"));
  const claimed = useLiveQuery<JobView<Timestamp>>(byField("claim.runnerOwnerId"));
  const jobs = computed<Job[]>(() => {
    const byId = new Map<string, Job>();
    for (const job of [...posted.data.value, ...claimed.data.value]) byId.set(job.id, job);
    return [...byId.values()].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  });
  const error = computed(() => posted.error.value ?? claimed.error.value);
  return { jobs, error };
}
