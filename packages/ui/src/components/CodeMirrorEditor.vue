<template>
    <div class="code-mirror-editor"></div>
</template>

<script lang="ts">
import { EditorView, highlightActiveLine, keymap, highlightSpecialChars, lineNumbers, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { EditorState, StateEffect } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import { graphqlLanguage } from 'altair-codemirror-graphql'
import { closeBrackets, completeFromList, autocompletion } from '@codemirror/autocomplete'
import { indentOnInput, indentUnit, bracketMatching, foldGutter, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { defaultKeymap, indentWithTab, history, historyKeymap, selectLine, selectLineBoundaryForward } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { codeMirrorSyntaxHighlighting } from '@/helpers'
import { envVarDecoration } from '@/utils/codemirror-extensions'
import { codeMirrorStyleOverrides } from '@/utils/code-mirror-style-overrides'

/**
 * "Mod-Enter" is "Ctrl-Enter" inside codemirror
 * "Ctrl-Enter" hotkey is used to send the request
 * but codemirror has the same hotkey to add a new line, therefore disable codemirror hotkey
 */
defaultKeymap.find(keyObj => keyObj.key == 'Mod-Enter').run = false

// to mimic VS-Code hotkey, works only if codemirror editor has focus
// Known issue: doesn't work when cursor is at extreme right end of the text
const selectLineKeyMap = { key: 'Ctrl-l', run: _ => selectLineBoundaryForward(_) && selectLine(_) }

// to prevent default behavior of browser on certain hotkeys
document.onkeydown = function(evt) {
    evt = evt || window.event
    if ((evt.ctrlKey) && ('lL'.includes(evt.key))) {
        evt.preventDefault()
    }
}

function getLanguageFuncAndHighlightStyle(language) {
    let languageFunc = null
    let languageData = null
    let highlightStyle = defaultHighlightStyle

    if(language === 'json') {
        languageFunc = json()
        highlightStyle = codeMirrorSyntaxHighlighting()
    }

    if(language === 'javascript') {
        languageFunc = javascript()
        languageData = javascriptLanguage
        highlightStyle = codeMirrorSyntaxHighlighting()
    }

    if(language === 'graphql') {
        languageFunc = graphqlLanguage
        highlightStyle = codeMirrorSyntaxHighlighting()
    }

    return { languageFunc, languageData, highlightStyle }
}

function getExtensions(vueInstance, language) {
    const { languageFunc, languageData, highlightStyle } = getLanguageFuncAndHighlightStyle(language)

    // languageFunc will be null for plain text & unsupported languages,
    // so we filter it out, to prevent errors
    const languageArray = [
        languageFunc
    ].filter(Boolean)


    const autocompletionsArray = [
        vueInstance.autocompletions.length > 0 ? languageData?.data.of({
            autocomplete: completeFromList(vueInstance.autocompletions)
        }) : null,
    ].filter(Boolean)

    return [
        ...languageArray,
        ...autocompletionsArray,
        autocompletion(),
        syntaxHighlighting(highlightStyle, { fallback: true }),
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
        drawSelection(),
        indentUnit.of('    '), // 4 spaces
        EditorView.lineWrapping,
        EditorView.updateListener.of(v => {
            if(v.docChanged) {
                vueInstance.emitted = true
                vueInstance.$emit('update:modelValue', v.state.doc.toString())
            }
        }),
        codeMirrorStyleOverrides,
        keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
            ...searchKeymap,
            selectLineKeyMap
        ]),
        vueInstance.readonly ? EditorState.readOnly.of(true) : EditorState.readOnly.of(false),
        envVarDecoration(vueInstance.envVariables),
    ]
}

function createState(language, documentText, vueInstance) {
    return EditorState.create({
        doc: documentText,
        extensions: getExtensions(vueInstance, language)
    })
}

export default {
    props: {
        modelValue: {
            type: String,
            required: true
        },
        lang: {
            type: String,
            required: true
        },
        readonly: {
            type: Boolean,
            default: false
        },
        envVariables: {
            type: Object,
            default: () => ({})
        },
        autocompletions: {
            type: Array,
            default: () => []
        },
    },
    data() {
        return {
            emitted: false
        }
    },
    editor: null,
    watch: {
        modelValue() {
            if(!this.emitted) {
                this.editor.setState(createState(this.lang, this.modelValue, this))
            } else {
                this.emitted = false
            }
        },
        envVariables: {
            deep: true,
            handler() {
                if (this.editor) {
                    this.editor.dispatch({
                        effects: StateEffect.reconfigure.of(getExtensions(this, this.lang))
                    })
                }
            }
        },
    },
    methods: {
        setValue(value) {
            this.editor.dispatch({
                changes: { from: 0, to: this.editor.state.doc.length, insert: value }
            })
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
