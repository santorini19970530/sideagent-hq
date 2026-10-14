import { ApiError, OwnerOutput } from "@sideagent/protocol";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import type { z } from "zod";

/** An HQ error with its `{code, reason, fix_hint}` body. */
export class HqRequestError extends Error {
  constructor(readonly body: ApiError) {
    super(`${body.reason}. ${body.fix_hint}`);
  }
}

interface HqInit {
  method?: "POST" | "DELETE";
  body?: Record<string, unknown>;
}

/** The signed-in handler and their owner record, created by HQ on first sign-in (D28). */
export const useOwner = createGlobalState(() => {
  const { auth } = useNuxtApp().$firebase;
  const hqUrl = useRuntimeConfig().public.hqUrl;

  // One sign-in state for the whole app, fed by a single auth listener.
  const user = shallowRef<User | null>(null);
  const owner = ref<OwnerOutput | null>(null);
  const ready = ref(false);
  const error = ref<string | null>(null);

  /** Calls HQ's owner API with the signed-in user's ID token and validates the answer. */
  async function hq<S extends z.ZodType>(
    schema: S,
    path: string,
    init: HqInit = {},
  ): Promise<z.output<S>> {
    const current = user.value;
    if (!current) throw new Error("Not signed in");
    const res = await $fetch.raw(path, {
      ...init,
      baseURL: hqUrl,
      headers: { authorization: `Bearer ${await current.getIdToken()}` },
      ignoreResponseError: true,
    });
    if (!res.ok) {
      const parsed = ApiError.safeParse(res._data);
      throw parsed.success
        ? new HqRequestError(parsed.data)
        : new Error(`HQ answered ${res.status}`);
    }
    return schema.parse(res._data);
  }

  /** Creates or loads the owner for `signedIn`, unless the user changed while HQ answered. */
  async function loadOwner(signedIn: User) {
    error.value = null;
    try {
      const out = await hq(OwnerOutput, "/v1/owner", { method: "POST" });
      if (user.value === signedIn) owner.value = out;
    } catch (err) {
      if (user.value === signedIn) error.value = errorMessage(err);
    }
  }

  onAuthStateChanged(auth, async (next) => {
    user.value = next;
    owner.value = null;
    if (next) await loadOwner(next);
    if (user.value === next) ready.value = true;
  });

  return {
    user,
    owner,
    ready,
    error,
    hq,
    retry: () => user.value && loadOwner(user.value),
    signIn: () => signInWithPopup(auth, new GoogleAuthProvider()),
    signOut: () => firebaseSignOut(auth),
  };
});
