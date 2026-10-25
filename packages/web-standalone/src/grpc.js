import { createGrpc } from '../../electron/shared/grpc.js'
import grpc from '@grpc/grpc-js'
import protobuf from 'protobufjs'
import * as grpcSchema from './grpc-schema.js'
import * as grpcJson from './grpc-json.js'

export const {
    convertInsomniaMessage,
    describeConnectionFailure,
    getStatusName,
    limits,
    loadSchema,
    startCall,
} = createGrpc(grpc, protobuf, grpcSchema, grpcJson)
