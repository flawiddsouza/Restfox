<template>
    <div class="code-mirror-single-line"></div>
</template>

<script>
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { history, historyKeymap } from '@codemirror/history'

function createState(vueInstance) {
    return EditorState.create({
        doc: vueInstance.modelValue,
        extensions: [
            history(),
            EditorView.updateListener.of(v => {
                if(v.docChanged) {
                    vueInstance.emitted = true
                    vueInstance.$emit('update:modelValue', v.state.doc.toString())
                }
            }),
            // From: https://discuss.codemirror.net/t/codemirror-6-single-line-and-or-avoid-carriage-return/2979/2
            EditorState.transactionFilter.of(tr => tr.newDoc.lines > 1 ? [] : tr),
            keymap.of([
                ...historyKeymap
            ])
        ]
    })
}

export default {
    props: {
        modelValue: String
    },
    data() {
        return {
            editor: null,
            emitted: false
        }
    },
    watch: {
        modelValue() {
            if(!this.emitted) {
                this.editor.setState(createState(this))
            } else {
                this.emitted = false
            }
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
.code-mirror-single-line .cm-editor.cm-focused {
    outline: 0 !important;
}

.code-mirror-single-line .cm-scroller {
    font-family: inherit !important;
    margin-left: 0.2rem;
    margin-right: 0.5rem;
    overflow-x: hidden !important;
}
</style>
