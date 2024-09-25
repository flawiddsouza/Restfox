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
