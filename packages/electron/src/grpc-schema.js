const protobuf = require('protobufjs')
const descriptor = require('protobufjs/ext/descriptor')
const { createExample } = require('./grpc-json')
const { createGrpcSchema } = require('../shared/grpc-schema.js')

module.exports = createGrpcSchema(protobuf, descriptor, require, createExample)
