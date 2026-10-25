import { createGrpcSchema } from '../../electron/shared/grpc-schema.js'
import { createRequire } from 'module'
import protobuf from 'protobufjs'
import descriptor from 'protobufjs/ext/descriptor.js'
import { createExample } from './grpc-json.js'

const require = createRequire(import.meta.url)

export const {
    loadProtoFiles,
    getRpcRoot,
    decodeFileDescriptor,
    loadFileDescriptors,
    describeSchema,
    findMethod,
} = createGrpcSchema(protobuf, descriptor, require, createExample)
