const grpc = require('@grpc/grpc-js')
const protobuf = require('protobufjs')
const grpcSchema = require('./grpc-schema')
const grpcJson = require('./grpc-json')
const { createGrpc } = require('../shared/grpc.js')

module.exports = createGrpc(grpc, protobuf, grpcSchema, grpcJson)
