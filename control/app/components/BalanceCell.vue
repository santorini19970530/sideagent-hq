<script setup lang="ts">
import type { BalanceView } from "@sideagent/protocol";
import { doc } from "firebase/firestore";

/** One live `balances/{account}` amount. */
const props = defineProps<{ account: string }>();
const { db } = useNuxtApp().$firebase;
const balance = useLiveDoc<BalanceView>(() => doc(db, "balances", props.account));
</script>

<template>
  <UTooltip v-if="balance.error.value" :text="balance.error.value">
    <span class="font-mono text-error">—</span>
  </UTooltip>
  <span v-else class="font-mono">{{ balance.data.value?.amount ?? 0 }} cr</span>
</template>
