import { Base64 } from 'js-base64'
import type { ResolutionMode, ResponseTagCache } from '@/global'

export type ParsedResult = {
    functionName: string
    parameters: Record<string, string | number>
}

export const tagRegex = /{% (\S+?\([^}]*?\)) %}/g

/**
* Parses a function invocation string into a ParsedResult object.
*
* @param input - The function invocation string to parse.
* @returns The parsed result as a ParsedResult object.
*/
export function parseFunction(input: string, decodeBase64 = false): ParsedResult {
    const functionPattern = /^(\w+)\((.*)\)$/
    const paramPattern = /(\w+)=('([^']*)'|(\d+)|(true|false)\b)/g

    const functionMatch = input.match(functionPattern)
    if (!functionMatch) {
        throw new Error('Input format is not valid')
    }

    const functionName = functionMatch[1]
    const paramsPart = functionMatch[2]
    const parameters: Record<string, string | number> = {}

    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramPattern.exec(paramsPart)) !== null) {
        const paramName = paramMatch[1]

        let paramValue: string | number

        if (paramMatch[3] !== undefined) {
            paramValue = paramMatch[3]

            if (decodeBase64) {
                if (paramValue.startsWith('b64::')) {
                    paramValue = Base64.decode(paramValue.slice(5))
                }
            }
        } else if (paramMatch[5] !== undefined) {
            // as the tag editor writes a checkbox
            paramValue = paramMatch[5] === 'true' ? 1 : 0
        } else {
            paramValue = Number(paramMatch[4])
        }

        parameters[paramName] = paramValue
    }

    return {
        functionName,
        parameters,
    }
}

// a checkbox parameter, such as a prompt's mask, is on unless it is missing or turned off, so one written by hand as
// mask='1' counts too
export function isParameterChecked(value: string | number | undefined) {
    return value !== undefined && ![0, '0', '', 'false'].includes(value)
}

/**
* Converts a ParsedResult object back into a function invocation string.
*
* @param parsedResult - The ParsedResult object to convert.
* @returns The function invocation string.
*/
export function toFunctionString(parsedResult: ParsedResult): string {
    const { functionName, parameters } = parsedResult
    const paramsArray: string[] = []

    for (const [key, value] of Object.entries(parameters)) {
        if (typeof value === 'string') {
            paramsArray.push(`${key}='${value}'`)
        } else {
            paramsArray.push(`${key}=${value}`)
        }
    }

    const paramsString = paramsArray.join(', ')
    return `${functionName}(${paramsString})`
}

export async function handleTags(
    handleResponseTag: (...args: any) => Promise<string | undefined>,
    string: string,
    mode: ResolutionMode,
    responseTags: ResponseTagCache | undefined,
    noError: boolean,
    handlePromptTag?: (...args: any) => Promise<string | undefined>,
    resolvePromptTags = true,
    resolveOtherTags = true,
    resolveResponseTags = true,
    responseTagErrors?: 'placeholder'
) {
    const matches = [...string.matchAll(tagRegex)]
    const replacements: { start: number, end: number, replacement: string }[] = []

    // resolved in reading order, so prompts ask in the order they appear
    for(const match of matches) {
        const fullMatch = match[0]
        const start = match.index!
        const end = start + fullMatch.length

        // console.log(`Match: ${fullMatch}, Start: ${start}, End: ${end}`)

        let parsedTag: ParsedResult

        try {
            parsedTag = parseFunction(match[1], true)
        } catch (error) {
            // where only prompt tags resolve, text that only looks like a tag is left as written
            if (!resolveOtherTags) {
                continue
            }
            throw error
        }

        let replacement = undefined

        if (parsedTag.functionName === 'prompt' ? !resolvePromptTags : !resolveOtherTags) {
            continue
        }

        if (parsedTag.functionName === 'response') {
            if(!resolveResponseTags) {
                continue
            }
            try {
                replacement = await handleResponseTag(parsedTag, mode, responseTags)
            } catch(error: any) {
                if(mode === 'send' || responseTagErrors !== 'placeholder') {
                    throw error
                }
                if(error?.cause !== 'display-error') {
                    console.error(error)
                }
            }
        }

        if (parsedTag.functionName === 'prompt' && handlePromptTag) {
            replacement = await handlePromptTag(parsedTag, mode, responseTags)
        }

        if (replacement === undefined) {
            if (noError) {
                replacement = '<no value found>'
            } else {
                const at = `${string.slice(0, start)}━>${parsedTag.functionName}(...)<━${string.slice(end)}`

                throw new Error(`Could not resolve tag\n\n${toFunctionString(parsedTag)}\n\nat ${at}`, {
                    cause: 'display-error'
                })
            }
        }

        replacements.push({ start, end, replacement })
    }

    // replaced from the end to avoid shifting indexes when replacing text - cause of issue #311
    for(const { start, end, replacement } of replacements.reverse()) {
        string = string.slice(0, start) + replacement + string.slice(end)
    }

    return string
}
