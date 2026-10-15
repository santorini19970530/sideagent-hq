<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";
import { accounts } from "@sideagent/protocol";

const { user, owner, ready, error, signIn, signOut, retry } = useOwner();
const signInAction = useAction();

const nav: NavigationMenuItem[] = [
  { label: "Mission map", to: "/", icon: "i-lucide-workflow" },
  { label: "Checkpoint log", to: "/feed", icon: "i-lucide-shield-alert" },
  { label: "Ledger", to: "/ledger", icon: "i-lucide-landmark" },
  { label: "Keys", to: "/agents", icon: "i-lucide-key-round" },
  { label: "About", to: "/about", icon: "i-lucide-file-text" },
];
</script>

<template>
  <UApp>
    <UHeader :toggle="!!owner" :ui="{ container: 'max-w-none' }">
      <template #title>
        <span class="flex items-center gap-2.5 font-bold">
          <span
            class="size-3.5 rounded-full border-2 border-primary ring-3 ring-primary/20"
            aria-hidden="true"
          />
          Sideagent
          <span class="eyebrow hidden sm:inline">Mission control</span>
        </span>
      </template>

      <UNavigationMenu v-if="owner" :items="nav" />

      <template #right>
        <template v-if="user">
          <template v-if="owner">
            <span class="hidden text-sm text-muted sm:inline">{{ owner.display_name }}</span>
            <span class="text-sm text-primary">
              <BalanceCell :account="accounts.owner(owner.owner_id)" />
            </span>
          </template>
          <UButton color="neutral" variant="outline" icon="i-lucide-log-out" @click="signOut">
            Sign out
          </UButton>
        </template>
      </template>

      <template #body>
        <UNavigationMenu v-if="owner" :items="nav" orientation="vertical" class="-mx-2.5" />
      </template>
    </UHeader>

    <UMain class="p-4 sm:p-6">
      <p v-if="!ready" class="text-muted">Establishing a secure line…</p>
      <AboutBriefing v-else-if="!user">
        <template #action>
          <UButton
            icon="i-simple-icons-google"
            :loading="signInAction.busy.value"
            @click="signInAction.run(signIn)"
          >
            Sign in with Google
          </UButton>
          <UAlert v-if="signInAction.failure.value" :description="signInAction.failure.value" />
        </template>
      </AboutBriefing>
      <div v-else-if="error" class="grid max-w-2xl justify-items-start gap-3">
        <UAlert :description="`HQ refused the sign-in: ${error}`" />
        <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" @click="retry">
          Retry
        </UButton>
      </div>
      <p v-else-if="!owner" class="text-muted">Checking clearance…</p>
      <NuxtPage v-else />
    </UMain>
  </UApp>
</template>
