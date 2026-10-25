const protobuf = require('protobufjs')
const protojson = require('protobufjs/ext/protojson')
const { createGrpcJson } = require('../shared/grpc-json.js')

module.exports = createGrpcJson(protobuf, protojson)
