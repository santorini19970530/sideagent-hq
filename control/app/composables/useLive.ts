import {
  onSnapshot,
  queryEqual,
  refEqual,
  type DocumentReference,
  type FirestoreError,
  type Query,
} from "firebase/firestore";

/**
 * Live Firestore reads through `onSnapshot`. The source is re-evaluated when its reactive inputs
 * change (null pauses it); an equal query keeps its listener, so a source that reads a prop
 * replaced on every snapshot doesn't resubscribe. The listener is removed with the scope.
 */
function live<S, T>(
  source: () => S | null,
  equal: (a: S, b: S) => boolean,
  subscribe: (s: S, set: (v: T) => void, fail: (e: FirestoreError) => void) => () => void,
  initial: T,
) {
  const data = shallowRef<T>(initial);
  const error = ref<string | null>(null);
  let current: S | null = null;
  let stop: (() => void) | null = null;
  watch(
    source,
    (s) => {
      if (s !== null && current !== null && equal(s, current)) return;
      stop?.();
      stop = null;
      current = s;
      data.value = initial;
      error.value = null;
      if (s === null) return;
      stop = subscribe(
        s,
        (v) => {
          data.value = v;
          error.value = null;
        },
        (e) => (error.value = e.message),
      );
    },
    { immediate: true },
  );
  onScopeDispose(() => stop?.());
  return { data, error };
}

/** Documents of a query, with their IDs. */
export function useLiveQuery<T>(source: () => Query | null) {
  return live<Query, (T & { id: string })[]>(
    source,
    queryEqual,
    (q, set, fail) =>
      onSnapshot(q, (snap) => set(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))), fail),
    [],
  );
}

/** One document, or null while it doesn't exist. */
export function useLiveDoc<T>(source: () => DocumentReference | null) {
  return live<DocumentReference, T | null>(
    source,
    refEqual,
    (ref, set, fail) =>
      onSnapshot(ref, (snap) => set(snap.exists() ? (snap.data() as T) : null), fail),
    null,
  );
}
