import { createGrpcJson } from '../../electron/shared/grpc-json.js'
import protobuf from 'protobufjs'
import protojson from 'protobufjs/ext/protojson.js'

export const {
    encodeMessage,
    convertObjectJsonToProtoJson,
    decodeMessage,
    decodeReceivedMessage,
    createExample,
    decodeStatusDetails,
} = createGrpcJson(protobuf, protojson)
