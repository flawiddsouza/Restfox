<template>
    <div></div>
</template>

<script>
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

function createState(vueInstance) {
    return EditorState.create({
        doc: vueInstance.modelValue,
        extensions: [
            EditorView.updateListener.of(v => {
                if(v.docChanged) {
                    vueInstance.$emit('update:modelValue', v.state.doc.toString())
                }
            }),
            // From: https://discuss.codemirror.net/t/codemirror-6-single-line-and-or-avoid-carriage-return/2979/2
            EditorState.transactionFilter.of(tr => tr.newDoc.lines > 1 ? [] : tr)
        ]
    })
}

export default {
    props: {
        modelValue: String
    },
    data() {
        return {
            editor: null
        }
    },
    watch: {
        modelValue() {
            this.editor.setState(createState(this))
        }
    },
    mounted() {
        this.editor = new EditorView({
            state: createState(this),
            parent: this.$el
        })
    }
}
</script>

<style>
.cm-editor.cm-focused {
    outline: 0 !important;
}

.cm-scroller {
    font-family: inherit !important;
    margin-left: 0.2rem;
    margin-right: 0.5rem;
    overflow-x: hidden !important;
}
</style>
