<template>
    <div class="modal" tabindex="0" @mousedown="closeModalOnBackgroundClick">
        <div class="modal__container" :style="{ width: width }">
            <div class="modal__content">
                <header>
                    <h3>{{ title }}</h3>
                    <span @click="$emit('update:modelValue', false)"><i class="fa fa-times"></i></span>
                </header>
                <div class="modal-main" :style="{ flexBasis: height }">
                    <slot>No Modal Content</slot>
                </div>
                <footer v-if="$slots.footer">
                    <slot name="footer"></slot>
                </footer>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        modelValue: Boolean,
        title: String,
        height: {
            type: String,
            required: false
        },
        width: {
            type: String,
            required: false
        }
    },
    methods: {
        closeModalOnBackgroundClick(e) {
            // document.body.contains(e.target) is needed when the clicked element is no longer in the DOM
            // if you don't add it, the orphaned e.target element will close the modal, as its "closest" will
            // not yield the .modal__content class element or any other elements for that matter
            // because it has been removed by the user
            if(e.target.closest('.modal__content') === null && document.body.contains(e.target)) {
                this.$emit('update:modelValue', false)
            }
        }
    }
}
</script>

<style scoped>
.modal {
    --gutter: 14px;
    --soft-color: #fafafa;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2;
    position: fixed;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
}

.modal__container {
    min-width: 600px;
    max-width: 95vw;
    position: relative;
    overflow: hidden;
    border-radius: 4px;
    margin: 0 auto;
    background-color: #ffffff;
    display: flex;
    flex-direction: column;
}

.modal__container header {
    display: grid;
    padding: var(--gutter);
    align-items: center;
    grid-template-columns: auto 20px;
    border-bottom: 1px solid var(--default-border-color)
}

.modal__container header h3 {
    font-weight: normal;
    font-size: 1rem;
}

.modal__container header span {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    font-size: 16px;
    opacity: 0.8;
    cursor: pointer;
}

.modal__container header span:hover {
    opacity: 1;
}

.modal__container .modal-main {
    flex: 1;
    text-align: left;
    overflow: auto;
    padding: 1rem 1.5rem;
    max-height: 62vh;
}

.modal__container footer {
    height: auto;
    text-align: right;
    border-top: solid 1px #cccccc;
    padding: var(--gutter);
    background-color: #ffffff;
    background-color: var(--soft-color);
}

.modal__container footer button, .modal__container footer input {
    margin: 0;
}

.modal__container footer button:not(:last-child), .modal__container footer input:not(:last-child) {
    margin-right: var(--gutter);
}

.modal__content {
    height: 100%;
    display: flex;
    flex-direction: column;
}
</style>
