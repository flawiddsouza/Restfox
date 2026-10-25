
export function createGrpcJson(protobuf, protojson) {
    // types whose ProtoJSON is not an object of their fields, such as a Timestamp's RFC 3339 text
    const WELL_KNOWN_JSON_TYPES = new Set([
        'Any', 'Timestamp', 'Duration', 'Struct', 'Value', 'ListValue', 'FieldMask', 'Empty', 'NullValue',
        'DoubleValue', 'FloatValue', 'Int64Value', 'UInt64Value', 'Int32Value', 'UInt32Value', 'BoolValue', 'StringValue', 'BytesValue',
    ].map(name => `.google.protobuf.${name}`))

    const LONG_TYPES = new Set(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64'])

    // a JSON number kept as typed until the field it goes into is known
    class JsonNumber {
        constructor(text) {
            this.text = text
        }
    }

    // JSON.parse, but numbers with a decimal point or exponent, and unsafe integers, are kept as typed so a 64-bit field
    // can take their exact digits or refuse a fraction, even one JavaScript would round to an integer
    function parseJson(text) {
        return JSON.parse(text, (_key, value, context) => {
            if(typeof value === 'number' && context?.source && (/[.eE]/.test(context.source) || !Number.isSafeInteger(value))) {
                return new JsonNumber(context.source)
            }
            return value
        })
    }

    // A number's text, such as 9.007199254740993e15, as the digits of the integer it is, worked out on the text, as
    // ProtoJSON's own reading goes through a JavaScript number and loses digits past 2^53, and rounds a fraction away. A
    // fraction is refused in ProtoJSON's words, name being the field's full name, json the value as written in the message.
    // Any other text as it is, for ProtoJSON to read or refuse
    function toIntegerDigits(text, name, json) {
        const match = text.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/)
        if(!match || (match[2] === '' && !match[3])) {
            return text
        }
        const [, sign, whole, fraction = '', exponentText = '0'] = match
        const digits = whole + fraction
        const exponent = Number(exponentText) - fraction.length
        if(exponent >= 0) {
            // past 20 zeros, any digit but 0 makes it too large for 64 bits, which ProtoJSON reports
            return sign + digits + '0'.repeat(Math.min(exponent, 20))
        }
        if(!/^0*$/.test(digits.slice(exponent))) {
            throw new Error(`${name}: not an integer: ${json}`)
        }
        return sign + (digits.slice(0, exponent) || '0')
    }

    function findField(type, key) {
        return type.fieldsArray.find(field => field.jsonName === key || field.name === key) ?? null
    }

    function lookupAnyType(anyType, typeUrl) {
        try {
            // an empty name, as in an empty Any, finds the root, which is no type
            return typeof typeUrl === 'string' && typeUrl !== '' ? anyType.root.lookupType(typeUrl.slice(typeUrl.lastIndexOf('/') + 1)) : null
        } catch {
            // ProtoJSON names the type it cannot find
            return null
        }
    }

    // The parsed value with each kept number as the field it goes into reads it: its digits as text for a 64-bit field,
    // which ProtoJSON reads as such, a number anywhere else, such as in a Struct. A text in a 64-bit field becomes its
    // digits too. fieldType is a protobufjs Type, a scalar type name, or null where the schema says nothing, such as for an
    // unknown field, which ProtoJSON then names. name is the full name ProtoJSON's errors give the value
    function placeJsonNumbers(value, fieldType, name = null) {
        const isLong = typeof fieldType === 'string'
            ? LONG_TYPES.has(fieldType)
            : fieldType?.fullName === '.google.protobuf.Int64Value' || fieldType?.fullName === '.google.protobuf.UInt64Value'

        if(value instanceof JsonNumber) {
            return isLong ? toIntegerDigits(value.text, name, value.text) : Number(value.text)
        }

        if(isLong && typeof value === 'string') {
            return toIntegerDigits(value, name, JSON.stringify(value))
        }

        if(value === null || typeof value !== 'object') {
            return value
        }

        const isType = fieldType instanceof protobuf.Type

        if(Array.isArray(value)) {
            // a list's items are of the field's type, a ListValue's are Values
            return value.map(item => placeJsonNumbers(item, isType && fieldType.fullName === '.google.protobuf.ListValue' ? null : fieldType, name))
        }

        const placeEach = typeOfKey => Object.fromEntries(Object.entries(value).map(([key, item]) => {
            const itemType = typeOfKey(key)
            return [key, placeJsonNumbers(item, itemType, itemType instanceof protobuf.Type ? itemType.fullName : null)]
        }))

        if(!isType) {
            return placeEach(() => null)
        }

        if(fieldType.fullName === '.google.protobuf.Int64Value' || fieldType.fullName === '.google.protobuf.UInt64Value') {
            return placeJsonNumbers(value, 'int64', fieldType.fullName)
        }

        if(fieldType.fullName === '.google.protobuf.Any') {
            if(Object.keys(value).length > 0 && typeof value['@type'] !== 'string') {
                throw new Error(`${name ?? fieldType.fullName}: a google.protobuf.Any needs "@type", naming the message it holds`)
            }
            const packedType = lookupAnyType(fieldType, value['@type'])
            if(packedType === null) {
                return placeEach(() => null)
            }
            if(WELL_KNOWN_JSON_TYPES.has(packedType.fullName)) {
                return placeEach(key => key === 'value' ? packedType : null)
            }
            // the packed message's fields sit beside @type, which no field takes
            return placeFields(value, packedType)
        }

        if(WELL_KNOWN_JSON_TYPES.has(fieldType.fullName)) {
            return placeEach(() => null)
        }

        return placeFields(value, fieldType)
    }

    // placeJsonNumbers for each field of a message's JSON object
    function placeFields(value, fieldType) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            const field = findField(fieldType, key)
            if(field === null) {
                return [key, placeJsonNumbers(item, null)]
            }
            field.resolve()
            const itemType = field.resolvedType ?? field.type
            if(field.map && item !== null && typeof item === 'object' && !Array.isArray(item)) {
                return [key, Object.fromEntries(Object.entries(item).map(([mapKey, mapValue]) => [mapKey, placeJsonNumbers(mapValue, itemType, field.fullName)]))]
            }
            return [key, placeJsonNumbers(item, itemType, field.fullName)]
        }))
    }

    // protobufjs's text for a value that does not fit, "<name>: <problem>: <the value as JSON>", such as
    // demo.v1.HelloRequest.name: expected string: {"token":"a"}
    const QUOTED_VALUE_ERROR_REGEX = /^([\w.]+): ([^:"]+): (?=["{[\-\dtfn])/

    // protobufjs's texts that quote nothing from the message
    const VALUE_FREE_ERROR_REGEXES = [
        /^[\w.]+: multiple values for oneof \w+$/,
        /^[\w.]+: out of range for \w+$/,
        /^[\w.]+: a google\.protobuf\.Any needs "@type", naming the message it holds$/,
        /^google\.protobuf\.\w+ (?:out of range|nanos invalid|nanos out of range|@type must be a string|cannot hold a non-finite number)$/,
        /^max depth exceeded$/,
        /^invalid encoding$/,
    ]

    // An error for a message that cannot be encoded. Its messageWithoutValues is the text without any part of what the user
    // wrote, which the text may quote, such as a value or the JSON around a typo, and is what history saves once the send
    // took a masked prompt value
    function createEncodeError(message, messageWithoutValues, cause) {
        return Object.assign(new Error(message, { cause }), { messageWithoutValues })
    }

    // a message's JSON text, an empty text meaning {}, as the bytes to send and its canonical ProtoJSON text
    function encodeMessage(type, text) {
        let parsed
        try {
            parsed = String(text ?? '').trim() === '' ? {} : parseJson(text)
        } catch(e) {
            // JSON.parse quotes the text around the token it could not read, its position says where it is. The position
            // ends the error, so a position written in the quoted text is not taken for it
            const position = e.message.match(/ at position \d+(?: \(line \d+ column \d+\))?$/)
            throw createEncodeError(`The message is not valid JSON: ${e.message}`, `The message is not valid JSON${position?.[0] ?? ''}`, e)
        }

        try {
            const message = protojson.fromJson(type, placeJsonNumbers(parsed, type))
            return {
                buffer: Buffer.from(type.encode(message).finish()),
                // every field with its value, as a received message shows, so a field left at zero shows it went out as zero
                json: JSON.stringify(fillDefaults(type, protojson.toJson(type, message)), null, 2),
            }
        } catch(e) {
            const objectForm = describeObjectForm(type, parsed)
            if(objectForm !== null) {
                throw createEncodeError(objectForm, objectForm, e)
            }
            // protobufjs writes full names with a leading dot, such as .demo.v1.HelloRequest
            const message = e.message.replace(/^\./, '')
            // a text not known to quote nothing is replaced whole, so no part of a value is kept by mistake
            const quotedValueMatch = message.match(QUOTED_VALUE_ERROR_REGEX)
            const messageWithoutValues = quotedValueMatch
                ? `${quotedValueMatch[1]}: ${quotedValueMatch[2]}`
                : VALUE_FREE_ERROR_REGEXES.some(regex => regex.test(message)) ? message : `The message does not fit ${type.fullName.slice(1)}`
            throw createEncodeError(message, messageWithoutValues, e)
        }
    }

    // a template tag, which a send replaces, so a value holding one is kept as written
    const TEMPLATE_TAG_REGEX = /{{|{%/

    const WRAPPER_TYPES = new Set([
        'DoubleValue', 'FloatValue', 'Int64Value', 'UInt64Value', 'Int32Value', 'UInt32Value', 'BoolValue', 'StringValue', 'BytesValue',
    ].map(name => `.google.protobuf.${name}`))

    const unchanged = value => ({ value, changed: false })

    // the parsed value as protobufjs's fromObject takes it, a kept number as its text
    function toObjectInput(value) {
        if(value instanceof JsonNumber) {
            return value.text
        }
        if(value === null || typeof value !== 'object') {
            return value
        }
        return Array.isArray(value) ? value.map(toObjectInput) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toObjectInput(item)]))
    }

    function readsAsProtoJson(type, value) {
        try {
            protojson.fromJson(type, placeJsonNumbers(value, type))
            return true
        } catch {
            return false
        }
    }

    // rewriteWellKnownTypes for each item of a list or each value of a map
    function rewriteItems(items, type, onRewritten, field) {
        if(items === null || typeof items !== 'object' || items instanceof JsonNumber) {
            return unchanged(items)
        }
        const results = Object.entries(items).map(([key, item]) => [key, rewriteWellKnownTypes(item, type, onRewritten, field)])
        if(!results.some(([, result]) => result.changed)) {
            return unchanged(items)
        }
        return {
            value: Array.isArray(items) ? results.map(([, result]) => result.value) : Object.fromEntries(results.map(([key, result]) => [key, result.value])),
            changed: true,
        }
    }

    // A parsed message of type with each well-known type's value ProtoJSON cannot read in ProtoJSON, see
    // convertObjectJsonToProtoJson. onRewritten, when given, is told each well-known type rewritten and the field holding
    // it, null for the message itself
    function rewriteWellKnownTypes(value, type, onRewritten = null, field = null) {
        if(value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof JsonNumber || !(type instanceof protobuf.Type)) {
            return unchanged(value)
        }

        if(type.fullName === '.google.protobuf.Any' && typeof value['@type'] === 'string') {
            const packedType = lookupAnyType(type, value['@type'])
            // the packed message's fields sit beside @type
            if(packedType !== null && !WELL_KNOWN_JSON_TYPES.has(packedType.fullName)) {
                const { '@type': typeUrl, ...fields } = value
                const result = rewriteWellKnownTypes(fields, packedType, onRewritten)
                return result.changed ? { value: { '@type': typeUrl, ...result.value }, changed: true } : unchanged(value)
            }
        }

        if(WELL_KNOWN_JSON_TYPES.has(type.fullName)) {
            if(readsAsProtoJson(type, value)) {
                return unchanged(value)
            }
            // the wrapped value as written, a template tag in it included
            if(WRAPPER_TYPES.has(type.fullName) && Object.keys(value).length === 1 && Object.hasOwn(value, 'value')) {
                onRewritten?.(type, field)
                return { value: value.value, changed: true }
            }
            // fromObject drops a key that is no field, so such an object is some other mistake, kept for ProtoJSON to name
            if(TEMPLATE_TAG_REGEX.test(JSON.stringify(toObjectInput(value))) || !Object.keys(value).every(key => findField(type, key) !== null)) {
                return unchanged(value)
            }
            try {
                const rewritten = protojson.toJson(type, type.fromObject(toObjectInput(value)))
                onRewritten?.(type, field)
                return { value: rewritten, changed: true }
            } catch {
                // one the source could not send either
                return unchanged(value)
            }
        }

        let changed = false
        const rewritten = Object.fromEntries(Object.entries(value).map(([key, item]) => {
            const field = findField(type, key)
            if(field === null) {
                return [key, item]
            }
            field.resolve()
            if(!(field.resolvedType instanceof protobuf.Type)) {
                return [key, item]
            }
            const result = field.map || field.repeated ? rewriteItems(item, field.resolvedType, onRewritten, field) : rewriteWellKnownTypes(item, field.resolvedType, onRewritten, field)
            changed ||= result.changed
            return [key, result.value]
        }))
        return changed ? { value: rewritten, changed } : unchanged(value)
    }

    // how ProtoJSON writes a well-known type, for a message that writes it as protobufjs's fromObject reads it
    const PROTO_JSON_FORMS = {
        '.google.protobuf.Timestamp': 'written as text, such as "2026-10-23T10:00:00Z", not as {"seconds": ...}',
        '.google.protobuf.Duration': 'written as text, such as "1.5s", not as {"seconds": ...}',
        '.google.protobuf.FieldMask': 'written as text, such as "title,dueDate", not as {"paths": [...]}',
        '.google.protobuf.Any': 'written as its "@type" and the fields of the message it holds, not as {"type_url": ..., "value": ...}',
    }
    const WRAPPED_VALUE_EXAMPLES = { '.google.protobuf.BoolValue': 'true', '.google.protobuf.StringValue': '"text"', '.google.protobuf.BytesValue': '"aGVsbG8="' }

    // A message that writes a well-known type as protobufjs's fromObject reads it, as Insomnia's messages do, gets how to
    // write it instead, as ProtoJSON's own text, such as "google.protobuf.BoolValue.value: expected boolean", names a field
    // the user never wrote. null for any other message. It quotes nothing the user wrote
    function describeObjectForm(type, parsed) {
        let first = null
        rewriteWellKnownTypes(parsed, type, (rewrittenType, field) => {
            first ??= { rewrittenType, field }
        })
        if(first === null) {
            return null
        }
        const { rewrittenType, field } = first
        const form = WRAPPER_TYPES.has(rewrittenType.fullName)
            ? `written as its value, such as ${WRAPPED_VALUE_EXAMPLES[rewrittenType.fullName] ?? '2'}, not as {"value": ...}`
            : PROTO_JSON_FORMS[rewrittenType.fullName] ?? 'written in the protobuf JSON format'
        return `${(field ?? type).fullName.slice(1)}: a ${rewrittenType.fullName.slice(1)} is ${form}`
    }

    // A message as Insomnia writes it, which protobufjs's fromObject reads, in ProtoJSON, which a call reads. They differ in
    // the well-known types: a wrapper such as BoolValue is {"value": true} there and true here, a Timestamp {"seconds": 1}
    // there and "1970-01-01T00:00:01Z" here. A well-known type's value is rewritten only where ProtoJSON cannot read it as
    // written, and the rest of the message is kept as written, template tags included, so a value holding a tag stays as
    // written unless it is a wrapper's. The text is laid out again with its own indent only when something changed. A text
    // that is not JSON comes back as it is
    function convertObjectJsonToProtoJson(type, text) {
        let parsed
        try {
            parsed = parseJson(text)
        } catch {
            return text
        }
        const result = rewriteWellKnownTypes(parsed, type)
        if(!result.changed) {
            return text
        }
        const indent = String(text).match(/\n([ \t]+)\S/)?.[1] ?? '    '
        return JSON.stringify(result.value, (_key, item) => item instanceof JsonNumber ? JSON.rawJSON(item.text) : item, indent)
    }

    function getZeroValue(field) {
        if(field.map) {
            return {}
        }
        if(field.repeated) {
            return []
        }
        if(field.resolvedType instanceof protobuf.Enum) {
            if(field.resolvedType.fullName === '.google.protobuf.NullValue') {
                return null
            }
            const values = field.resolvedType.values
            return Object.keys(values).find(name => values[name] === 0) ?? 0
        }
        if(field.type === 'string' || field.type === 'bytes') {
            return ''
        }
        if(field.type === 'bool') {
            return false
        }
        return LONG_TYPES.has(field.type) ? '0' : 0
    }

    // ProtoJSON leaves out fields holding their default value, these put them back so every field shows: scalars and enums
    // as their zero value, repeated as [] and maps as {}. Fields that can be absent stay absent: message fields, oneof
    // members and proto3 optional ones
    function fillDefaults(type, json) {
        if(WELL_KNOWN_JSON_TYPES.has(type.fullName) || json === null || typeof json !== 'object' || Array.isArray(json)) {
            return json
        }

        // no prototype, so a field whose JSON name is __proto__ is kept as a field
        const filled = Object.create(null)

        for(const field of type.fieldsArray) {
            field.resolve()
            const key = field.jsonName
            const isMessage = field.resolvedType instanceof protobuf.Type

            if(Object.hasOwn(json, key)) {
                const value = json[key]
                if(!isMessage) {
                    filled[key] = value
                } else if(field.map) {
                    filled[key] = Object.fromEntries(Object.entries(value).map(([mapKey, mapValue]) => [mapKey, fillDefaults(field.resolvedType, mapValue)]))
                } else if(field.repeated) {
                    filled[key] = value.map(item => fillDefaults(field.resolvedType, item))
                } else {
                    filled[key] = fillDefaults(field.resolvedType, value)
                }
            } else if(field.map || field.repeated || (!isMessage && !field.partOf && !field.hasPresence)) {
                filled[key] = getZeroValue(field)
            }
        }

        // extensions and anything else ProtoJSON wrote
        for(const [key, value] of Object.entries(json)) {
            if(!Object.hasOwn(filled, key)) {
                filled[key] = value
            }
        }

        return filled
    }

    // Takes each Any of a type the schema lacks out of a decoded message, since ProtoJSON cannot write one, and leaves an
    // empty Any in its place. Server reflection gives the files a service uses, and an Any's type is often in none of them.
    // Each one taken is kept with the keys leading to it, to be put back as its type and base64 bytes
    function takeUnknownAnys(type, message, path, taken) {
        for(const field of type.fieldsArray) {
            field.resolve()
            const fieldType = field.resolvedType
            const value = message[field.name]
            if(!(fieldType instanceof protobuf.Type) || value === null || value === undefined) {
                continue
            }

            const visit = (item, itemPath) => {
                if(item === null || typeof item !== 'object') {
                    return
                }
                if(fieldType.fullName === '.google.protobuf.Any') {
                    const typeUrlName = fieldType.fieldsById[1].name
                    const valueName = fieldType.fieldsById[2].name
                    const typeUrl = item[typeUrlName]
                    if(typeUrl && lookupAnyType(fieldType, typeUrl) === null) {
                        taken.push({ path: itemPath, json: { '@type': typeUrl, value: Buffer.from(item[valueName] ?? []).toString('base64') } })
                        item[typeUrlName] = ''
                        item[valueName] = Buffer.alloc(0)
                    }
                    return
                }
                if(!WELL_KNOWN_JSON_TYPES.has(fieldType.fullName)) {
                    takeUnknownAnys(fieldType, item, itemPath, taken)
                }
            }

            if(field.map) {
                for(const [mapKey, item] of Object.entries(value)) {
                    // a 64-bit key is held as 8 bytes, ProtoJSON writes its digits
                    const jsonKey = LONG_TYPES.has(field.keyType) ? protobuf.util.longFromKey(mapKey, field.keyType === 'uint64' || field.keyType === 'fixed64').toString() : mapKey
                    visit(item, [...path, field.jsonName, jsonKey])
                }
            } else if(field.repeated) {
                value.forEach((item, index) => visit(item, [...path, field.jsonName, index]))
            } else {
                visit(value, [...path, field.jsonName])
            }
        }
    }

    function putBack(json, path, value) {
        let parent = json
        for(const key of path.slice(0, -1)) {
            parent = parent?.[key]
        }
        if(parent !== null && typeof parent === 'object') {
            parent[path[path.length - 1]] = value
        }
    }

    // a received message as ProtoJSON text with default values filled in. A message ProtoJSON still cannot write, such as
    // one with an Any of an unknown type inside another Any, is written field by field instead
    function decodeMessage(type, buffer, message = type.decode(buffer)) {
        let json
        try {
            const taken = []
            takeUnknownAnys(type, message, [], taken)
            json = fillDefaults(type, protojson.toJson(type, message))
            for(const { path, json: anyJson } of taken) {
                putBack(json, path, anyJson)
            }
        } catch {
            json = type.toObject(type.decode(buffer), { longs: String, enums: String, bytes: String, defaults: true, arrays: true, objects: true, json: true })
        }
        return JSON.stringify(json, null, 2)
    }

    class ReceivedReader extends protobuf.BufferReader {
        constructor(buffer, type, path = '', unknownFields = new Map()) {
            super(buffer)
            this.discardUnknown = false
            this.contexts = [{ type, path, end: buffer.length }]
            this.unknownFields = unknownFields
        }

        tag() {
            if(this.skipping) {
                return super.tag()
            }
            while(this.contexts.length > 1 && this.pos >= this.contexts[this.contexts.length - 1].end) {
                this.contexts.pop()
            }
            const context = this.contexts[this.contexts.length - 1]
            this.fieldStart = this.pos
            const tag = super.tag()
            this.fieldNumber = tag >>> 3
            this.field = context.map ? (this.fieldNumber === 2 ? context.field : null) : context.type.fieldsById[this.fieldNumber]
            this.fieldMap = !context.map && this.field?.map
            if((tag & 7) === 3 && this.field?.delimited && this.field.resolvedType instanceof protobuf.Type) {
                this.contexts.push({ type: this.field.resolvedType, path: context.path + this.field.name + '.', end: this.len })
            } else if((tag & 7) === 4 && this.contexts.length > 1) {
                this.contexts.pop()
            }
            return tag
        }

        size() {
            const length = super.size()
            if(!this.skipping && (this.fieldMap || this.field?.resolvedType instanceof protobuf.Type)) {
                const context = this.contexts[this.contexts.length - 1]
                this.contexts.push({
                    type: this.field.resolvedType, path: context.path + (context.map ? 'value' : this.field.name) + '.', end: this.pos + length,
                    map: this.fieldMap, field: this.field, start: this.fieldStart,
                })
            }
            return length
        }

        recordUnknown(path, start) {
            // Any payloads are slices of the received buffer too, so their offsets keep the original wire order.
            const position = this.buf.byteOffset + start
            if(!this.unknownFields.has(path) || position < this.unknownFields.get(path)) {
                this.unknownFields.set(path, position)
            }
        }

        skipType(...args) {
            if(this.skipping) {
                return super.skipType(...args)
            }
            this.recordUnknown(this.contexts[this.contexts.length - 1].path + this.fieldNumber, this.fieldStart)
            // A skipped group belongs to its unknown field, not to the surrounding schema.
            this.skipping = true
            try {
                return super.skipType(...args)
            } finally {
                this.skipping = false
            }
        }

        raw(start, end) {
            // Closed enum values are preserved without skipType, including packed values and whole map entries.
            // The bytes reader also calls raw, starting after its field's tag and length.
            if(this.field?.type !== 'bytes' || start === this.fieldStart) {
                const context = this.contexts[this.contexts.length - 1]
                const map = context.map && context.start === start
                this.recordUnknown(map ? this.contexts[this.contexts.length - 2].path + context.field.id : context.path + this.fieldNumber, start)
            }
            return super.raw(start, end)
        }
    }

    // Repeated elements share the field's path; map value messages use "labels.value.4", without an index or key.
    // An Any payload stays under the Any field's name, without adding its "value" bytes field to the path.
    function collectAnyUnknownFields(message, path, unknownFields) {
        if(message.$type?.fullName === '.google.protobuf.Any') {
            const typeUrl = message[message.$type.fieldsById[1].name]
            if(!typeUrl && message[message.$type.fieldsById[2].name]?.length) {
                throw new Error('an Any with a payload needs a type URL')
            }
            const type = lookupAnyType(message.$type, typeUrl)
            if(type) {
                const reader = new ReceivedReader(message[message.$type.fieldsById[2].name] ?? Buffer.alloc(0), type, path, unknownFields)
                collectAnyUnknownFields(type.decode(reader), path, unknownFields)
            }
            return
        }
        for(const [name, value] of Object.entries(message)) {
            if(!value || typeof value !== 'object' || ArrayBuffer.isView(value)) {
                continue
            }
            const field = message.$type.fields[name]
            const fieldPath = path + name + '.'
            if(field.map || field.repeated) {
                for(const item of Object.values(value)) {
                    if(item?.$type) {
                        collectAnyUnknownFields(item, fieldPath + (field.map ? 'value.' : ''), unknownFields)
                    }
                }
            } else {
                collectAnyUnknownFields(value, fieldPath, unknownFields)
            }
        }
    }

    // Follow the decoder's tags and lengths rather than scanning the bytes again. Only Any payloads need another reader.
    function decodeReceivedMessage(type, buffer) {
        try {
            const reader = new ReceivedReader(buffer, type)
            const message = type.decode(reader)
            collectAnyUnknownFields(message, '', reader.unknownFields)
            const json = decodeMessage(type, buffer, message)
            if(reader.unknownFields.size) {
                const unknownFields = [...reader.unknownFields].sort((a, b) => a[1] - b[1]).map(([path]) => path)
                return { json, bytes: buffer.toString('base64'), unknownFields }
            }
            return { json }
        } catch(error) {
            return { bytes: buffer.toString('base64'), decodeError: `Not a ${type.fullName.slice(1)}: ${error.message}` }
        }
    }

    function getScalarExample(type) {
        if(type === 'string' || type === 'bytes') {
            return ''
        }
        if(type === 'bool') {
            return false
        }
        return LONG_TYPES.has(type) ? '0' : 0
    }

    function getMapKeyExample(keyType) {
        if(keyType === 'string') {
            return 'key'
        }
        return keyType === 'bool' ? 'true' : '0'
    }

    // How many fields an example fills in before it leaves the messages it has not reached as {}. Two fields of one type,
    // level after level, would double the example at each level, so a schema of under 1 KB could give one of millions of
    // characters. Fields nearer the top come first
    const EXAMPLE_FIELD_LIMIT = 1000

    // an example of the type, a message as an object whose fields fillExample fills in, once queue gives it its turn
    function getTypeExample(type, path, queue) {
        switch(type.fullName) {
            case '.google.protobuf.Timestamp':
                return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
            case '.google.protobuf.Duration':
                return '1s'
            case '.google.protobuf.Struct':
            case '.google.protobuf.Any':
            case '.google.protobuf.Empty':
                return {}
            case '.google.protobuf.Value':
                return null
            case '.google.protobuf.ListValue':
                return []
            case '.google.protobuf.FieldMask':
                return ''
        }

        if(WELL_KNOWN_JSON_TYPES.has(type.fullName)) {
            // wrappers
            return getScalarExample(type.fields.value.type)
        }

        // a type that holds itself stops at its second appearance
        if(path.includes(type)) {
            return {}
        }

        const example = {}
        queue.push({ type, path: [...path, type], example })
        return example
    }

    // fills in a message's example, path being the types it is in, itself included
    function fillExample(type, path, example, queue) {
        const oneofsSeen = new Set()

        for(const field of type.fieldsArray) {
            field.resolve()
            if(field.partOf && !field.partOf.isProto3Optional) {
                if(oneofsSeen.has(field.partOf)) {
                    continue
                }
                oneofsSeen.add(field.partOf)
            }

            let value
            if(field.resolvedType instanceof protobuf.Type) {
                value = getTypeExample(field.resolvedType, path, queue)
            } else if(field.resolvedType instanceof protobuf.Enum) {
                value = field.resolvedType.fullName === '.google.protobuf.NullValue' ? null : Object.keys(field.resolvedType.values)[0]
            } else {
                value = getScalarExample(field.type)
            }

            if(field.map) {
                example[field.jsonName] = { [getMapKeyExample(field.keyType)]: value }
            } else if(field.repeated) {
                example[field.jsonName] = [value]
            } else {
                example[field.jsonName] = value
            }
        }
    }

    // a message of the type with an example value in every field, for the user to fill in
    function createExample(type) {
        const queue = []
        const example = getTypeExample(type, [], queue)
        let fieldCount = 0
        // level by level, so the fields nearest the top are filled in before the limit
        for(let index = 0; index < queue.length && fieldCount < EXAMPLE_FIELD_LIMIT; index++) {
            const message = queue[index]
            fillExample(message.type, message.path, message.example, queue)
            fieldCount += Object.keys(message.example).length
        }
        return example
    }

    function lookupTypeIn(roots, name) {
        for(const root of roots) {
            try {
                return root.lookupType(name)
            } catch {
                // not in this one
            }
        }
        return null
    }

    // grpc-status-details-bin, a google.rpc.Status, as JSON text, each detail decoded through the schema or the
    // google/rpc error details, or left as base64 when neither has its type
    function decodeStatusDetails(buffer, schemaRoot, rpcRoot) {
        const Status = rpcRoot.lookupType('google.rpc.Status')
        const status = Status.decode(buffer)

        const details = status.details.map(any => {
            const typeUrl = any.type_url
            const type = lookupTypeIn([schemaRoot, rpcRoot].filter(Boolean), typeUrl.slice(typeUrl.lastIndexOf('/') + 1))
            if(type) {
                try {
                    const json = fillDefaults(type, protojson.toJson(type, type.decode(any.value)))
                    return json !== null && typeof json === 'object' && !Array.isArray(json) ? { '@type': typeUrl, ...json } : { '@type': typeUrl, value: json }
                } catch {
                    // shown as bytes below
                }
            }
            return { '@type': typeUrl, value: Buffer.from(any.value).toString('base64') }
        })

        return JSON.stringify({ code: status.code, message: status.message, details }, null, 2)
    }

    return {
        encodeMessage,
        convertObjectJsonToProtoJson,
        decodeMessage,
        decodeReceivedMessage,
        createExample,
        decodeStatusDetails,
    }
}
