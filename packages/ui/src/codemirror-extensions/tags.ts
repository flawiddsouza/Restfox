import { ViewPlugin, Decoration, EditorView, ViewUpdate, MatchDecorator, WidgetType, DecorationSet } from '@codemirror/view'
import { parseFunction } from '@/parsers/tag'
import type { ParsedResult } from '@/parsers/tag'

type OnClickType = (parsedFunc: ParsedResult, updateFunc: (updatedTag: string) => void) => void

class PlaceholderWidget extends WidgetType {
    readonly #onClick: () => void
    #parsed: ParsedResult
    readonly #view: EditorView
    readonly #pos: number

    constructor(readonly placeholder: string, readonly onClick: OnClickType, readonly view: EditorView, readonly pos: number) {
        super()
        this.#parsed = parseFunction(placeholder)
        this.#onClick = () => {
            onClick(this.#parsed, this.updateTag)
        }
        this.#view = view
        this.#pos = pos
    }

    eq(other: PlaceholderWidget) {
        return this.placeholder === other.placeholder
    }

    toDOM() {
        const span = document.createElement('span')
        span.className = 'tag'
        span.textContent = `${this.#parsed.functionName}(...)`
        span.title = this.placeholder
        span.addEventListener('click', this.#onClick)
        return span
    }

    ignoreEvent(): boolean {
        return false
    }

    destroy(dom: HTMLElement): void {
        dom.removeEventListener('click', this.#onClick)
    }

    updateTag = (updatedTag: string) => {
        this.#parsed = parseFunction(updatedTag)
        this.#view.dispatch({
            changes: { from: this.#pos + 3, to: this.#pos + this.placeholder.length + 3, insert: updatedTag }
        })
    }
}

export function tags(onClick: OnClickType) {
    const placeholderMatcher = new MatchDecorator({
        regexp: /{% (.+?) %}/g,
        decoration: (match, view, pos) => Decoration.replace({
            widget: new PlaceholderWidget(match[1], onClick, view, pos),
        })
    })

    const tags = ViewPlugin.fromClass(
        class {
            placeholders: DecorationSet
            constructor(view: EditorView) {
                this.placeholders = placeholderMatcher.createDeco(view)
            }
            update(update: ViewUpdate) {
                this.placeholders = placeholderMatcher.updateDeco(update, this.placeholders)
            }
        },
        {
            decorations: instance => instance.placeholders,
            provide: plugin => EditorView.atomicRanges.of(view => {
                return view.plugin(plugin)?.placeholders || Decoration.none
            })
        }
    )

    return tags
}
