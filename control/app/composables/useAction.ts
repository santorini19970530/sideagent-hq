export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs one user action at a time, keeping its failure message for the page to show. */
export function useAction() {
  const busy = ref(false);
  const failure = ref<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    busy.value = true;
    failure.value = null;
    try {
      await fn();
    } catch (err) {
      failure.value = errorMessage(err);
    } finally {
      busy.value = false;
    }
  }
  return { busy, failure, run };
}
