import { ViewPlugin, Decoration, EditorView, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

export const variableMatchingRegex = /{{ ([.|\w]*?) }}|{{([.|\w]*?)}}/g

export function envVarDecoration(envVariables: any) {
    return ViewPlugin.fromClass(class {
        decorations

        constructor(view: EditorView) {
            this.decorations = this.highlightEnvVariables(view, envVariables)
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.highlightEnvVariables(update.view, envVariables)
            }
        }

        highlightEnvVariables(view: EditorView, envVariables: any) {
            const builder = new RangeSetBuilder()
            for (const { from, to } of view.visibleRanges) {
                const range = view.state.doc.sliceString(from, to)
                let match
                while ((match = variableMatchingRegex.exec(range))) {
                    const start = from + match.index
                    const end = start + match[0].length
                    const varName = match[1] || match[2]
                    const isInEnv = varName in envVariables
                    const className = isInEnv ? 'valid-env-var' : 'invalid-env-var'
                    const titleText = isInEnv ? envVariables[varName] : 'Environment variable not found'
                    const decoration = Decoration.mark({
                        class: className,
                        attributes: {title: titleText}
                    })
                    builder.add(start, end, decoration)
                }
            }
            return builder.finish()
        }
    }, {
        decorations: (v: any) => v.decorations
    })
}
