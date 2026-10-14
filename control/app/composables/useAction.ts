export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs one user action at a time, keeping its failure message for the page to show. */
export function useAction() {
  const { isLoading, error, executeImmediate } = useAsyncState(
    (fn: () => Promise<unknown>) => fn(),
    null,
    // The page shows the failure; don't also log it.
    { immediate: false, onError: () => {} },
  );
  const failure = computed(() => (error.value == null ? null : errorMessage(error.value)));
  return { busy: isLoading, failure, run: executeImmediate };
}
