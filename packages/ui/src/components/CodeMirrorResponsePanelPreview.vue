<template>
    <div class="code-mirror-response-panel-preview"></div>
</template>

<script>
import { EditorView, lineNumbers, keymap, drawSelection } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { foldGutter, syntaxHighlighting } from '@codemirror/language'
import { codeMirrorSyntaxHighlighting } from '@/helpers'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { defaultKeymap } from '@codemirror/commands'
import { codeMirrorStyleOverrides } from '@/utils/code-mirror-style-overrides'

const lineWrapping = new Compartment()

function createState(documentText, vueInstance) {
    const extensions = [
        json(),
        syntaxHighlighting(codeMirrorSyntaxHighlighting(), { fallback: true }),
        lineNumbers(),
        foldGutter({ openText: '▾', closedText: '▸' }),
        highlightSelectionMatches(),
        drawSelection(),
        lineWrapping.of(vueInstance.$store.state.flags.responseLineWrapping ? EditorView.lineWrapping : []),
        EditorView.editable.of(true),
        EditorState.readOnly.of(true),
        codeMirrorStyleOverrides,
        keymap.of([
            ...defaultKeymap,
            ...searchKeymap,
        ]),
        EditorView.updateListener.of(v => {
            if(v.selectionSet) {
                const { main } = v.state.selection
                const selectedText = main.empty ? '' : v.state.doc.sliceString(main.from, main.to)
                vueInstance.$emit('selection-changed', selectedText)
            }
        }),
    ]

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
        },
        '$store.state.flags.responseLineWrapping'(responseLineWrapping) {
            this.editor.dispatch({
                effects: lineWrapping.reconfigure(responseLineWrapping ? EditorView.lineWrapping : [])
            })
        }
    },
    mounted() {
        this.editor = new EditorView({
            state: createState(this.modelValue, this),
            parent: this.$el
        })
    }
}
</script>

<style>
/* the editor fills the panel and scrolls itself, so the sideways scrollbar of unwrapped lines sits at the bottom of the panel */
.code-mirror-response-panel-preview, .code-mirror-response-panel-preview .cm-editor {
    height: 100%;
}

.code-mirror-response-panel-preview .cm-editor.cm-focused {
    outline: 0 !important;
}

/* the line numbers stay in place while unwrapped text scrolls under them */
.code-mirror-response-panel-preview .cm-gutters {
    user-select: none;
    background-color: var(--background-color);
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
