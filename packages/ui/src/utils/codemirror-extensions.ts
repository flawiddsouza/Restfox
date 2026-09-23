import { ViewPlugin, Decoration, EditorView, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import getObjectPathValue from 'lodash.get'
import { getObjectPaths } from '@/helpers'

// {{name}} or {{ name }}, the name may contain spaces but not start or end with one, and no braces, so one match cannot
// run on into the next variable
export const variableMatchingRegex = /{{ ([^\s{}](?:[^{}\n]*?[^\s{}])?) }}|{{([^\s{}](?:[^{}\n]*?[^\s{}])?)}}/g

// the names substituteEnvironmentVariables replaces with a value: every nested path of the environment, and each path
// behind "_." when the environment has no "_" of its own
function getEnvironmentVariableValues(envVariables: any): Map<string, unknown> {
    const values = new Map<string, unknown>()

    for(const objectPath of getObjectPaths(envVariables ?? {})) {
        const value = getObjectPathValue(envVariables, objectPath)
        values.set(objectPath, value)

        if(!envVariables['_']) {
            values.set(`_.${objectPath}`, value)
        }
    }

    return values
}

export function envVarDecoration(envVariables: any) {
    // the editors rebuild this extension when the environment changes, so the names are collected once for it
    const envVariableValues = getEnvironmentVariableValues(envVariables)

    return ViewPlugin.fromClass(class {
        decorations

        constructor(view: EditorView) {
            this.decorations = this.highlightEnvVariables(view)
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged || update.selectionSet) {
                this.decorations = this.highlightEnvVariables(update.view)
            }
        }

        highlightEnvVariables(view: EditorView) {
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
                    const isInEnv = envVariableValues.has(varName)
                    const value = envVariableValues.get(varName)
                    const className = isSelected ? '' : (isInEnv ? 'valid-env-var' : 'invalid-env-var')
                    // an object is substituted as JSON, so it shows as JSON
                    const titleText = isInEnv ? (typeof value === 'object' ? JSON.stringify(value) : String(value)) : 'Environment variable not found'
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
