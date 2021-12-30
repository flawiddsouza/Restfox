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

const extensions = [
    json(),
    defaultHighlightStyle,
    lineNumbers(),
    foldGutter(),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true)
]

function createState(documentText) {
    return EditorState.create({
        doc: documentText,
        extensions: extensions
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
            this.editor.dispatch({
                changes: { from: 0, to: this.editor.state.doc.length, insert: this.modelValue }
            })
        }
    },
    mounted() {
        this.editor = new EditorView({
            state: createState(this.modelValue),
            parent: this.$el
        })
    }
}
</script>

<style>
.code-mirror-response-panel-preview .cm-editor.cm-focused {
    outline: 0 !important;
}

.code-mirror-response-panel-preview .cm-gutters {
    user-select: none;
}

.code-mirror-response-panel-preview .cm-scroller {
    font-family: var(--font-monospace);
}
</style>
