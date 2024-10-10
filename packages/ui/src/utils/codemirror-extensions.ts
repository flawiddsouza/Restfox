import { ViewPlugin, Decoration, EditorView, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

export const variableMatchingRegex = /{{ ([^\s]*?) }}|{{([^\s]*?)}}/g

export function envVarDecoration(envVariables: any) {
    return ViewPlugin.fromClass(class {
        decorations

        constructor(view: EditorView) {
            this.decorations = this.highlightEnvVariables(view, envVariables)
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged || update.selectionSet) {
                this.decorations = this.highlightEnvVariables(update.view, envVariables)
            }
        }

        highlightEnvVariables(view: EditorView, envVariables: any) {
            const builder = new RangeSetBuilder<Decoration>()
            for (const { from, to } of view.visibleRanges) {
                const range = view.state.doc.sliceString(from, to)
                let match
                while ((match = variableMatchingRegex.exec(range))) {
                    const start = from + match.index
                    const end = start + match[0].length
                    // we don't want the highlighting to apply if variable is selected / within a selection,
                    // as our class's background color overrides selectionBackground color
                    // this causes the selected variables to not appear as selected
                    const isSelected = this.isWithinSelectionAndNotEmpty(view, start, end)

                    const varName = match[1] || match[2]
                    const isInEnv = varName in envVariables
                    const className = isSelected ? '' : (isInEnv ? 'valid-env-var' : 'invalid-env-var')
                    const titleText = isInEnv ? envVariables[varName] : 'Environment variable not found'
                    const decoration = Decoration.mark({
                        class: className,
                        attributes: { title: titleText }
                    })
                    builder.add(start, end, decoration)
                }
            }
            return builder.finish()
        }

        isWithinSelectionAndNotEmpty(view: EditorView, start: number, end: number): boolean {
            for (const range of view.state.selection.ranges) {
                if (range.empty) {
                    continue
                } // Skip cursor positions (empty selections)
                if (range.from < end && range.to > start) {
                    return true // Text is genuinely selected
                }
            }
            return false // No genuine text selection within decoration
        }
    }, {
        decorations: v => v.decorations
    })
}
