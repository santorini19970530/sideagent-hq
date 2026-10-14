<script setup lang="ts">
import type { BalanceView } from "@sideagent/protocol";
import { doc } from "firebase/firestore";

/** One live `balances/{account}` amount. */
const props = defineProps<{ account: string }>();
const { db } = useNuxtApp().$firebase;
const balance = useLiveDoc<BalanceView>(() => doc(db, "balances", props.account));
</script>

<template>
  <span v-if="balance.error.value" class="mono tone-bad" :title="balance.error.value">—</span>
  <span v-else class="mono">{{ balance.data.value?.amount ?? 0 }} cr</span>
</template>
