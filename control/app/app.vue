<script setup lang="ts">
import { accounts } from "@sideagent/protocol";

const { user, owner, ready, error, signIn, signOut, retry } = useOwner();
const signInAction = useAction();
</script>

<template>
  <div class="shell">
    <header class="top">
      <NuxtLink to="/" class="brand">
        <span class="mark" aria-hidden="true" />
        <span>Sideagent</span>
        <span class="eyebrow">Mission control</span>
      </NuxtLink>
      <nav v-if="owner" class="nav">
        <NuxtLink to="/">Mission map</NuxtLink>
        <NuxtLink to="/ledger">Ledger</NuxtLink>
        <NuxtLink to="/agents">Field agents</NuxtLink>
      </nav>
      <div v-if="user" class="who">
        <template v-if="owner">
          <span class="muted">{{ owner.display_name }}</span>
          <span class="credits"><BalanceCell :account="accounts.owner(owner.owner_id)" /></span>
        </template>
        <button @click="signOut">Sign out</button>
      </div>
    </header>

    <main class="main">
      <p v-if="!ready" class="muted">Establishing a secure line…</p>
      <section v-else-if="!user" class="gate panel">
        <p class="eyebrow">Eyes only</p>
        <h1>Mission control</h1>
        <p class="muted">
          Watch your agents' missions move from briefing to dead drop, follow every credit, and
          issue keys to your field agents.
        </p>
        <button
          class="primary"
          :disabled="signInAction.busy.value"
          @click="signInAction.run(signIn)"
        >
          Sign in with Google
        </button>
        <p v-if="signInAction.failure.value" class="error">{{ signInAction.failure.value }}</p>
      </section>
      <div v-else-if="error" class="refused">
        <p class="error">HQ refused the sign-in: {{ error }}</p>
        <button @click="retry">Retry</button>
      </div>
      <p v-else-if="!owner" class="muted">Checking clearance…</p>
      <NuxtPage v-else />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.top {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  text-decoration: none;
}

.mark {
  width: 14px;
  height: 14px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.nav {
  display: flex;
  gap: 4px;
}

.nav a {
  text-decoration: none;
  color: var(--muted);
  padding: 6px 12px;
  border-radius: 8px;
}

.nav a.router-link-exact-active {
  color: var(--text);
  background: var(--panel-raised);
}

.who {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.credits {
  color: var(--accent);
}

.main {
  flex: 1;
  padding: 24px;
  width: 100%;
}

.gate {
  max-width: 460px;
  margin: 12vh auto 0;
  padding: 32px;
  display: grid;
  gap: 14px;
  justify-items: start;
}

.gate h1 {
  margin: 0;
  font-size: 30px;
}

.gate p {
  margin: 0;
}

.refused {
  display: grid;
  gap: 12px;
  justify-items: start;
  max-width: 640px;
}

@media (max-width: 640px) {
  .top {
    gap: 12px;
    padding: 12px 16px;
  }
  .who {
    margin-left: 0;
  }
  .main {
    padding: 16px;
  }
}
</style>
