<template>
    <ContextMenu :options="options" x="303.422px" y="140.672px" v-model:show="showContextMenu" @click="handleClickedItem" />
</template>

<script>
import ContextMenu from './ContextMenu.vue'

export default {
    components: {
        ContextMenu
    },
    data() {
        return {
            showContextMenu: true,
            options: [
                {
                    type: 'option',
                    label: 'Option 1',
                    value: 'Option 1',
                    icon: 'fa fa-bars'
                },
                {
                    type: 'option',
                    label: 'Disabled Option',
                    value: 'Disabled Option',
                    icon: 'fa fa-bars',
                    disabled: true
                },
                {
                    type: 'option',
                    label: 'Option 2',
                    value: 'Option 2',
                    icon: 'fa fa-bars',
                },
                {
                    type: 'separator'
                },
                {
                    type: 'option',
                    label: 'Option After Separator - 1',
                    value: 'Option After Separator - 1',
                    icon: 'fa fa-ellipsis-h'
                },
                {
                    type: 'option',
                    label: 'Option After Separator - 2',
                    value: 'Option After Separator - 2',
                    icon: 'fa fa-ellipsis-h'
                }
            ]
        }
    },
    methods: {
        handleClickedItem(clickedItem) {
            alert(clickedItem)
        }
    }
}
</script>
