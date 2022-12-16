<template>
    <div class="code-mirror-response-panel-preview"></div>
</template>

<script>
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { foldGutter, syntaxHighlighting } from '@codemirror/language'
import { codeMirrorSyntaxHighlighting } from '@/helpers'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'

const styleOverrides = EditorView.theme({
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
        fontSize: '1em !important'
    }
})

const extensions = [
    json(),
    syntaxHighlighting(codeMirrorSyntaxHighlighting(), { fallback: true }),
    lineNumbers(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    EditorView.editable.of(true),
    EditorState.readOnly.of(true),
    styleOverrides,
    keymap.of([
        ...searchKeymap,
    ])
]

function createState(documentText) {
    return EditorState.create({
        doc: documentText,
        extensions: extensions
    })
}

export default {
    props: {
        modelValue: {
            type: String,
            required: true
        }
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
    background-color: inherit;
    border-right: 0;
}

.code-mirror-response-panel-preview .cm-scroller {
    font-family: var(--font-monospace);
}

.code-mirror-response-panel-preview .cm-foldGutter span {
    font-size: 1.1rem;
    line-height: 1.1rem;
    color: rgb(130, 130, 130, 0.5);
}

.code-mirror-response-panel-preview .cm-foldGutter span:hover {
    color: #999999;
}

.code-mirror-response-panel-preview .cm-lineNumbers .cm-gutterElement {
    padding-left: 0.6rem;
}
</style>
