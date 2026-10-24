import type { ParsedResult } from '@/parsers/tag'
import { isParameterChecked, parseFunction, tagRegex } from '@/parsers/tag'

// Values typed into a prompt tag live only in this page's memory, never in storage. A prompt is known by its whole
// text in its workspace, so one environment variable used in many requests is one prompt, while prompts with another
// title, or the same prompt in another workspace, are not
const rememberedValues = new Map<string, string>() // Ask once, until the app closes or Forget
const lastValues = new Map<string, string>() // Ask every send, pre-filled
// Ask once while its box is open, so another send waits for the same answer
const onceValuesAsked = new Map<string, Promise<string>>()
// the stop signals of the sends waiting for such a box, which opens while one of them still runs
const onceValuesWaiting = new Map<string, Set<AbortSignal | null>>()

// one box at a time, a send can reach several prompts at once
let dialogQueue: Promise<unknown> = Promise.resolve()

// plain characters, which a url keeps as they are, so a saved url shows them in every version
export const MASKED_PREVIEW = '******'

function readParameters(parsedTag: ParsedResult, workspaceId?: string) {
    const text = (name: string) => {
        const value = parsedTag.parameters[name]
        return value === undefined ? '' : String(value)
    }

    const ask = text('ask')

    return {
        promptKey: JSON.stringify(parsedTag),
        // the key of a value kept past the send, none outside a workspace
        keptKey: workspaceId === undefined ? undefined : JSON.stringify([workspaceId, parsedTag]),
        title: text('title'),
        label: text('label'),
        defaultValue: text('defaultValue'),
        mask: isParameterChecked(parsedTag.parameters.mask),
        // always when missing or unknown: asks on every send
        ask: ask === 'once' || ask === 'prefill' ? ask : 'always',
    }
}

function getRememberedValue(parsedTag: ParsedResult, workspaceId: string | undefined) {
    const { keptKey, ask } = readParameters(parsedTag, workspaceId)
    return ask === 'once' && keptKey !== undefined ? rememberedValues.get(keptKey) : undefined
}

// isWanted is asked when the box's turn comes, so a box queued for a send stopped since never opens
function askForValue(title: string, defaultValue: string, label: string, mask: boolean, isWanted: () => boolean): Promise<string | null> {
    const dialog = dialogQueue.then(() => {
        if (!isWanted()) {
            throw new Error('The send was stopped')
        }
        return window.createPrompt(title, defaultValue, [], { label: label === '' ? undefined : label, mask })
    })
    dialogQueue = dialog.catch(() => undefined)
    return dialog
}

// Outside a send, such as the URL preview and the tag editor, a prompt shows its remembered value in workspaceId, else
// the default, never opening the box
export function getPromptPreviewValue(parsedTag: ParsedResult, workspaceId: string | undefined) {
    const { defaultValue, mask } = readParameters(parsedTag)

    if (mask) {
        return MASKED_PREVIEW
    }

    return getRememberedValue(parsedTag, workspaceId) ?? defaultValue
}

// A prompt in a send of a request in workspaceId. sendValues are the values this send was given, so a prompt used twice in one send asks once.
// onMaskedPrompt tells the text being resolved that a masked value went into it. hideMasked shows a send's text once it
// is resolved: masked values as ******, the others as this send resolved them. signal aborts when the send is stopped
export async function handlePromptTag(parsedTag: ParsedResult, workspaceId: string, sendValues: Map<string, Promise<string>>, onMaskedPrompt: () => void, hideMasked: boolean, signal: AbortSignal | null = null): Promise<string> {
    const { promptKey, title, label, defaultValue, mask, ask } = readParameters(parsedTag)
    const keptKey = JSON.stringify([workspaceId, parsedTag])

    if (mask && hideMasked) {
        return MASKED_PREVIEW
    }

    if (mask) {
        onMaskedPrompt()
    }

    const rememberedValue = getRememberedValue(parsedTag, workspaceId)

    if (rememberedValue !== undefined) {
        return rememberedValue
    }

    const sendValue = sendValues.get(promptKey)

    if (sendValue !== undefined) {
        return sendValue
    }

    const onceValue = ask === 'once' ? onceValuesAsked.get(keptKey) : undefined

    if (onceValue !== undefined) {
        onceValuesWaiting.get(keptKey)?.add(signal)
        sendValues.set(promptKey, onceValue)
        return onceValue
    }

    const waiting = new Set([signal])

    const boxValue = (ask === 'prefill' ? lastValues.get(keptKey) : undefined) ?? defaultValue

    const boxTitle = title === '' ? 'Enter value' : title

    const valuePromise = askForValue(boxTitle, boxValue, label, mask, () => [...waiting].some(waitingSignal => !waitingSignal?.aborted)).then(value => {
        if (value === null) {
            throw new PromptCancelledError(`Prompt "${boxTitle}" was cancelled`, { cause: 'display-error' })
        }

        if (ask === 'once') {
            rememberedValues.set(keptKey, value)
        }

        if (ask === 'prefill') {
            lastValues.set(keptKey, value)
        }

        return value
    })

    sendValues.set(promptKey, valuePromise)

    if (ask === 'once') {
        onceValuesAsked.set(keptKey, valuePromise)
        onceValuesWaiting.set(keptKey, waiting)
        valuePromise.catch(() => undefined).finally(() => {
            onceValuesAsked.delete(keptKey)
            onceValuesWaiting.delete(keptKey)
        })
    }

    return valuePromise
}

// Cancel in a prompt box, which stops the send
export class PromptCancelledError extends Error {}

// how many prompts keep a value in every workspace, a prompt keeps at most one
export function countRememberedPromptValues() {
    return rememberedValues.size + lastValues.size
}

// forgets them in every workspace, returns how many values were forgotten
export function forgetPromptValues() {
    const forgottenCount = countRememberedPromptValues()
    rememberedValues.clear()
    lastValues.clear()
    return forgottenCount
}

// A script reads a variable synchronously and cannot open the box, so a prompt tag in it reads as the remembered
// value in workspaceId or the default. onMaskedPrompt is told when a masked one is read
export function replacePromptTagsWithKnownValues(value: string, workspaceId: string | undefined, onMaskedPrompt?: () => void) {
    return value.replace(tagRegex, (match, tag: string) => {
        let parsedTag: ParsedResult

        try {
            parsedTag = parseFunction(tag, true)
        } catch {
            // text that only looks like a tag is read as written, as it was before prompt tags
            return match
        }

        if (parsedTag.functionName !== 'prompt') {
            return match
        }

        const { defaultValue, mask } = readParameters(parsedTag)

        if (mask) {
            onMaskedPrompt?.()
        }

        return getRememberedValue(parsedTag, workspaceId) ?? defaultValue
    })
}
