<template>
    <div class="code-mirror-editor"></div>
</template>

<script>
import { EditorView, highlightActiveLine, keymap, highlightSpecialChars } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { lineNumbers, highlightActiveLineGutter } from '@codemirror/gutter'
import { foldGutter } from '@codemirror/fold'
import { defaultHighlightStyle } from '@codemirror/highlight'
import { closeBrackets } from '@codemirror/closebrackets'
import { bracketMatching } from '@codemirror/matchbrackets'
import { indentOnInput, indentUnit } from '@codemirror/language'
import { history, historyKeymap } from '@codemirror/history'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { commentKeymap } from '@codemirror/comment'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'

function createState(language, documentText, vueInstance) {
    let languageFunc = null

    if(language === 'json') {
        languageFunc = json()
    }

    if(language === 'javascript') {
        languageFunc = javascript()
    }

    return EditorState.create({
        doc: documentText,
        extensions: [
            languageFunc,
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
            highlightSelectionMatches(),
            indentUnit.of('    '), // 4 spaces
            EditorView.lineWrapping,
            EditorView.updateListener.of(v => {
                if(v.docChanged) {
                    vueInstance.emitted = true
                    vueInstance.$emit('update:modelValue', v.state.doc.toString())
                }
            }),
            keymap.of([
                ...defaultKeymap,
                ...historyKeymap,
                ...commentKeymap,
                indentWithTab,
                ...searchKeymap,
            ])
        ]
    })
}

export default {
    props: {
        modelValue: String,
        lang: String
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
                this.editor.setState(createState(this.lang, this.modelValue, this))
            } else {
                this.emitted = false
            }
        }
    },
    mounted() {
        this.editor = new EditorView({
            state: createState(this.lang, this.modelValue, this),
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
    overflow: auto;
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

.code-mirror-editor .cm-editor {
    height: 100%;
}
</style>
