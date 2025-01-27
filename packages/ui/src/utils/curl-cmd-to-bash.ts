export function convertCurlCmdToBash(curlCommand: string) {
    let convertedCommand = curlCommand

    const handleReplace = (match: string) => {
        let replaceValue = match
        replaceValue = replaceValue.replaceAll('^%', '%')
        replaceValue = replaceValue.replaceAll('^[', '[')
        replaceValue = replaceValue.replaceAll('^]', ']')
        replaceValue = replaceValue.replaceAll('^{', '{')
        replaceValue = replaceValue.replaceAll('^}', '}')
        replaceValue = replaceValue.replaceAll('^\\', '')
        replaceValue = replaceValue.replaceAll('^"', '"')
        replaceValue = replaceValue.replaceAll('^', '')
        return replaceValue
    }

    for (const match of convertedCommand.matchAll(/-H "(.*?)" /gm)) {
        const replaceValue = handleReplace(match[1])
        convertedCommand = convertedCommand.replace(match[0], `-H '${replaceValue}' `)
    }

    for (const match of convertedCommand.matchAll(/-H \^"(.*?)\^" /gm)) {
        const replaceValue = handleReplace(match[1])
        convertedCommand = convertedCommand.replace(match[0], `-H '${replaceValue}' `)
    }

    for (const match of convertedCommand.matchAll(/--data-raw "(.*?)}"/gm)) {
        const replaceValue = handleReplace(match[1]).replaceAll('""', '"')
        convertedCommand = convertedCommand.replace(match[0], `--data-raw '${replaceValue}}'`)
    }

    for (const match of convertedCommand.matchAll(/--data-raw \^"(.*)}\^"/gms)) {
        const replaceValue = handleReplace(match[1])
        convertedCommand = convertedCommand.replace(match[0], `--data-raw '${replaceValue}}'`)
    }

    // Remove ^ from the end of the line in every line
    convertedCommand = convertedCommand.replace(/\^$/gm, '\\')

    return convertedCommand
}
