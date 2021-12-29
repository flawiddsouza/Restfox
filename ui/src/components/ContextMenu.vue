<template>
    <div class="context-menu-container" v-if="show">
        <div class="context-menu-background" @click.stop="$emit('update:show', false)"></div>
        <div class="context-menu" :style="{
            left: x,
            top: y
        }">
            <div v-for="option in options">
                <template v-if="option.type === 'option'">
                    <button type="button" class="context-menu-item" :disabled="option.disabled"  @click.stop="$emit('click', option.value); $emit('update:show', false);">
                        <i :class="option.icon"></i> {{ option.label }}
                    </button>
                </template>
                <template v-if="option.type === 'separator'">
                    <div class="context-menu-separator"></div>
                </template>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        options: Array,
        x: String,
        y: String,
        show: {
            type: Boolean,
            default: false
        }
    }
}
</script>

<style scoped>
.context-menu-background {
  position: fixed;
  z-index: 1;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
}

.context-menu {
    position: absolute;
    z-index: 1;
    border: 1px solid #82828240;
    box-shadow: 0 0 1rem 0 rgba(0, 0, 0, 0.1);
    border-radius: calc(1rem * 0.3);
    min-width: 15rem;
    padding-top: 5px;
    padding-bottom: 5px;
    background: #ffffff;
}

button.context-menu-item {
    padding: 0.5rem;
    outline: 0;
    background: #ffffff;
    border: 0;
    display: block;
    width: 100%;
    text-align: left;
}

button.context-menu-item:hover:not(:disabled),
button.context-menu-item.active:not(:disabled) {
    background: #82828240;
}

button.context-menu-item:active:not(:disabled) {
    background: #82828259;
}

button.context-menu-item > i {
    display: inline-block;
    width: 2.2em;
    text-align: center;
}

.context-menu-separator {
    border-bottom: 1px solid var(--default-border-color);
    margin-top: 5px;
    margin-bottom: 5px;
}
</style>
