// for text put into HTML, such as names from collection data, which may have been imported, so it shows as typed. A value
// that is not text shows as a template string would show it
export function escapeHtml(text: unknown) {
    return String(text).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

// the text a piece of HTML shows, with character references such as &ndash; decoded, read by the browser's parser, which
// runs no script and loads nothing
export function htmlToText(html: string) {
    return new DOMParser().parseFromString(html, 'text/html').documentElement.textContent ?? ''
}
