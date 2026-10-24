<template>
    <form @submit.prevent="createGrpcRequest" v-if="showModalComp">
        <modal title="New gRPC Request" v-model="showModalComp">
            <label>
                <div style="font-weight: 500; margin-bottom: var(--label-margin-bottom)">Name</div>
                <input type="text" class="full-width-input" v-model="grpcRequestName" placeholder="New gRPC Request" required spellcheck="false" v-focus>
            </label>

            <template #footer>
                <button class="button">Create</button>
            </template>
        </modal>
    </form>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Directive } from 'vue'
import { Store, useStore } from 'vuex'
import Modal from '@/components/Modal.vue'
import constants from '@/constants'
import { State } from '@/global'

const props = withDefaults(defineProps<{
    showModal: boolean
    parentId?: string | null
}>(), {
    parentId: null,
})

const emit = defineEmits<{
    (event: 'update:showModal', value: boolean): void
}>()

const store: Store<State> = useStore()

const vFocus: Directive<HTMLInputElement> = {
    mounted(element) {
        element.focus()
        element.select()
    }
}

const grpcRequestName = ref(constants.GRPC_REQUEST_DEFAULT_NAME)

const showModalComp = computed({
    get() {
        return props.showModal
    },
    set(value: boolean) {
        emit('update:showModal', value)
    }
})

watch(() => props.showModal, () => {
    if(props.showModal) {
        grpcRequestName.value = constants.GRPC_REQUEST_DEFAULT_NAME
    }
})

async function createGrpcRequest() {
    const result = await store.dispatch('createCollectionItem', {
        type: 'grpc',
        name: grpcRequestName.value,
        parentId: props.parentId
    })

    if(!result.error) {
        showModalComp.value = false
    }
}
</script>
