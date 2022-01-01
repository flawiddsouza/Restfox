<template>
    <div class="code-mirror-editor"></div>
</template>

<script>
import { EditorView, highlightActiveLine, keymap, highlightSpecialChars } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { lineNumbers, highlightActiveLineGutter } from '@codemirror/gutter'
import { foldGutter } from '@codemirror/fold'
import { defaultHighlightStyle } from '@codemirror/highlight'
import { closeBrackets } from '@codemirror/closebrackets'
import { bracketMatching } from '@codemirror/matchbrackets'
import { indentOnInput } from '@codemirror/language'
import { history, historyKeymap } from '@codemirror/history'

function createState(documentText, vueInstance) {
    return EditorState.create({
        doc: documentText,
        extensions: [
            json(),
            defaultHighlightStyle,
            lineNumbers(),
            highlightActiveLineGutter(),
            foldGutter({ openText: '▾', closedText: '▸' }),
            closeBrackets(),
            bracketMatching(),
            indentOnInput(),
            highlightActiveLine(),
            history(),
            highlightSpecialChars(),
            EditorView.lineWrapping,
            EditorView.updateListener.of(v => {
                if(v.docChanged) {
                    vueInstance.emitted = true
                    vueInstance.$emit('update:modelValue', v.state.doc.toString())
                }
            }),
            keymap.of([
                ...historyKeymap,
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
                this.editor.setState(createState(this.modelValue, this))
            } else {
                this.emitted = false
            }
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
.code-mirror-editor .cm-editor.cm-focused {
    outline: 0 !important;
}

.code-mirror-editor .cm-gutters {
    user-select: none;
    background-color: inherit;
    border-right: 0;
}

.code-mirror-editor .cm-scroller {
    font-family: var(--font-monospace);
}

.code-mirror-editor .cm-activeLine, .code-mirror-editor .cm-activeLineGutter {
    background-color: rgb(130, 130, 130, 0.1);
}

.code-mirror-editor .cm-foldGutter span {
    font-size: 1.1rem;
    line-height: 1.1rem;
    color: rgb(130, 130, 130, 0.5);
}

.code-mirror-editor .cm-foldGutter span:hover {
    color: #999999;
}
</style>
