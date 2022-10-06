<script setup>
import NavBar from '@/components/NavBar.vue'
import Workspaces from '@/components/Workspaces.vue'
</script>

<template>
    <div class="container">
        <header>
            <NavBar nav="workspaces" />
        </header>

        <section class="workspaces">
            <Workspaces />
        </section>
    </div>
</template>

<style scoped>
.container {
    display: grid;

    grid-template-areas:
      "header header header"
      "workspaces workspaces workspaces";

    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;

    height: 100%;
}

header {
    grid-area: header;
    border-bottom: 1px solid var(--default-border-color);
}

.workspaces {
    grid-area: workspaces;
    overflow: auto;
    position: relative;
    display: grid;
    grid-template-rows: 1fr;
}
</style>
