import type { CollectionItem } from '@/global'

// More decimals than this are not used, so a sort order stays short in the item's file, as a file workspace is read in git
const MAX_DECIMALS = 3

function isSortOrder(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

// The shortest number between before and after, nearest their middle, with no more than MAX_DECIMALS decimals. A side
// that is missing is open, so the first or last place takes the next whole number. Null when no such number fits, as
// beside a number written by hand too large for one more to differ from it
export function sortOrderBetween(before: number | undefined, after: number | undefined): number | null {
    if(before === undefined && after === undefined) {
        return 0
    }
    if(before === undefined) {
        const candidate = Math.ceil(after!) - 1
        return Number.isSafeInteger(candidate) && candidate < after! ? candidate : null
    }
    if(after === undefined) {
        const candidate = Math.floor(before) + 1
        return Number.isSafeInteger(candidate) && candidate > before ? candidate : null
    }
    const middle = (before + after) / 2
    for(let decimals = 0; decimals <= MAX_DECIMALS; decimals++) {
        const scale = 10 ** decimals
        // the nearest number with these decimals to the middle is the only one that can fit, when one does
        const candidate = Number((Math.round(middle * scale) / scale).toFixed(decimals))
        if(before < candidate && candidate < after) {
            return candidate
        }
    }
    return null
}

// Gives items added after siblings, as an import adds them, the next whole numbers after the highest sibling's, so no
// sibling's file is written, or numbers them all again from 0 when a sibling has none or the highest is too large to
// count on from
export function appendInSortOrder(siblings: CollectionItem[], appended: CollectionItem[]) {
    if(siblings.every(sibling => isSortOrder(sibling.sortOrder))) {
        let next = siblings.length > 0 ? Math.floor(Math.max(...siblings.map(sibling => sibling.sortOrder!))) + 1 : 0
        if(Number.isSafeInteger(next) && Number.isSafeInteger(next + appended.length)) {
            appended.forEach(item => {
                item.sortOrder = next++
            })
            return
        }
    }
    [...siblings, ...appended].forEach((item, index) => {
        item.sortOrder = index
    })
}

// Gives the item at index in siblings, which hold it there already, a sort order from its neighbours' alone, so a
// create, duplicate or move writes no other item's file. When a sibling has none, as in a file written by hand, the
// others are not in their numbers' order, as the sidebar shows them beside an item with none, or no short number fits
// between the neighbours, the siblings are numbered again from 0 in the order they are in, as every create did before.
// Returns the items whose sort order changed, the placed one included
export function placeInSortOrder(siblings: CollectionItem[], index: number): CollectionItem[] {
    const item = siblings[index]
    const others = siblings.filter((_, otherIndex) => otherIndex !== index)
    const otherSortOrders = others.map(other => other.sortOrder)
    // each one before is a number already, as every stops at the first that is not
    const inOrder = otherSortOrders.every((sortOrder, otherIndex) => isSortOrder(sortOrder) && (otherIndex === 0 || otherSortOrders[otherIndex - 1] as number <= sortOrder))
    if(inOrder) {
        const sortOrder = sortOrderBetween(siblings[index - 1]?.sortOrder, siblings[index + 1]?.sortOrder)
        if(sortOrder !== null) {
            item.sortOrder = sortOrder
            return [item]
        }
    }
    const changed: CollectionItem[] = []
    siblings.forEach((sibling, siblingIndex) => {
        if(sibling.sortOrder !== siblingIndex || sibling === item) {
            sibling.sortOrder = siblingIndex
            changed.push(sibling)
        }
    })
    return changed
}
