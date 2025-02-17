import { Base64 } from 'js-base64'

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
    const paramPattern = /(\w+)=('([^']*)'|(\d+))/g

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

export async function handleTags(handleResponseTag: (...args: any) => Promise<string | undefined>, string: string, tagTrigger: boolean, cacheId: string | undefined, noError: boolean) {
    const regex = tagRegex
    let matches = [...string.matchAll(regex)]
    // Reverse matches to avoid shifting indexes when replacing text - cause of issue #311
    matches = matches.reverse()

    for(const match of matches) {
        const fullMatch = match[0]
        const start = match.index!
        const end = start + fullMatch.length

        // console.log(`Match: ${fullMatch}, Start: ${start}, End: ${end}`)

        const parsedTag = parseFunction(match[1], true)

        let replacement = undefined

        if (parsedTag.functionName === 'response') {
            replacement = await handleResponseTag(parsedTag, tagTrigger, cacheId)
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

        string = string.slice(0, start) + replacement + string.slice(end)
    }

    return string
}
