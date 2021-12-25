<template>
    <div class="code-mirror-response-panel-preview"></div>
</template>

<script>
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { lineNumbers } from '@codemirror/gutter'
import { foldGutter } from '@codemirror/fold'
import { defaultHighlightStyle } from "@codemirror/highlight"

function createState(vueInstance) {
    return EditorState.create({
        doc: vueInstance.modelValue,
        extensions: [
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
            lineNumbers(),
            foldGutter(),
            defaultHighlightStyle.fallback,
            json()
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
.code-mirror-response-panel-preview .cm-editor.cm-focused {
    outline: 0 !important;
}
</style>
