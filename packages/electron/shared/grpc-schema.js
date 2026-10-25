import fs from 'fs'

export function createGrpcSchema(protobuf, descriptor, require, createExample) {
    // well-known types protobufjs ships as files only, not among the ones it has built in
    const SHIPPED_PROTOS = new Set(['google/protobuf/api.proto', 'google/protobuf/type.proto', 'google/protobuf/source_context.proto'])

    // google/rpc protos for the error details a server sends in grpc-status-details-bin, which proto files import without
    // shipping them
    const RPC_PROTOS = {
        'google/rpc/status.proto': `
syntax = "proto3";
package google.rpc;
import "google/protobuf/any.proto";
message Status {
    int32 code = 1;
    string message = 2;
    repeated google.protobuf.Any details = 3;
}
`,
        'google/rpc/error_details.proto': `
syntax = "proto3";
package google.rpc;
import "google/protobuf/duration.proto";
message ErrorInfo {
    string reason = 1;
    string domain = 2;
    map<string, string> metadata = 3;
}
message RetryInfo {
    google.protobuf.Duration retry_delay = 1;
}
message DebugInfo {
    repeated string stack_entries = 1;
    string detail = 2;
}
message QuotaFailure {
    message Violation {
        string subject = 1;
        string description = 2;
        string api_service = 3;
        string quota_metric = 4;
        string quota_id = 5;
        map<string, string> quota_dimensions = 6;
        int64 quota_value = 7;
        optional int64 future_quota_value = 8;
    }
    repeated Violation violations = 1;
}
message PreconditionFailure {
    message Violation {
        string type = 1;
        string subject = 2;
        string description = 3;
    }
    repeated Violation violations = 1;
}
message BadRequest {
    message FieldViolation {
        string field = 1;
        string description = 2;
        string reason = 3;
        LocalizedMessage localized_message = 4;
    }
    repeated FieldViolation field_violations = 1;
}
message RequestInfo {
    string request_id = 1;
    string serving_data = 2;
}
message ResourceInfo {
    string resource_type = 1;
    string resource_name = 2;
    string owner = 3;
    string description = 4;
}
message Help {
    message Link {
        string description = 1;
        string url = 2;
    }
    repeated Link links = 1;
}
message LocalizedMessage {
    string locale = 1;
    string message = 2;
}
`,
    }

    function parseProtoText(root, path, text) {
        protobuf.parse.filename = path
        try {
            return protobuf.parse(text, root, { keepCase: true })
        } catch(e) {
            // a syntax error names the file and line itself, other errors, such as a name defined twice, do not
            throw new Error(e.message.includes(path) ? e.message : `${path}: ${e.message}`, { cause: e })
        } finally {
            protobuf.parse.filename = null
        }
    }

    // the file an import means: the same path, else one whose path ends with it or that it ends with, so a folder picked
    // above or below the import root still resolves
    function findProtoFile(protoFiles, importPath) {
        return protoFiles.find(file => file.path === importPath)
            ?? protoFiles.find(file => file.path.endsWith(`/${importPath}`))
            ?? protoFiles.find(file => importPath.endsWith(`/${file.path}`))
            ?? null
    }

    // parses the files into one root. Imports resolve against the files first, then the well-known types protobufjs
    // carries or ships, then the google/rpc protos above
    function loadProtoFiles(protoFiles) {
        const root = new protobuf.Root()
        const loaded = new Set()

        const load = (path, importedBy) => {
            const file = findProtoFile(protoFiles, path)
            const key = file ? file.path : path
            if(loaded.has(key)) {
                return
            }
            loaded.add(key)

            if(file) {
                const parsed = parseProtoText(root, file.path, file.text)
                for(const importPath of [...(parsed.imports ?? []), ...(parsed.weakImports ?? [])]) {
                    load(importPath, file.path)
                }
                return
            }

            if(protobuf.common.get(path)) {
                root.addJSON(protobuf.common.get(path).nested)
                return
            }

            if(path === 'google/protobuf/descriptor.proto') {
                root.addJSON(require('protobufjs/google/protobuf/descriptor.json').nested)
                return
            }

            const text = RPC_PROTOS[path] ?? (SHIPPED_PROTOS.has(path) ? fs.readFileSync(require.resolve(`protobufjs/${path}`), 'utf8') : null)
            if(text !== null) {
                const parsed = parseProtoText(root, path, text)
                for(const importPath of parsed.imports ?? []) {
                    load(importPath, path)
                }
                return
            }

            throw new Error(`${importedBy} imports ${path}, which is not among the proto files`)
        }

        for(const file of protoFiles) {
            load(file.path, null)
        }

        try {
            root.resolveAll()
        } catch(e) {
            throw new Error(`The proto files do not resolve: ${e.message}`, { cause: e })
        }

        return root
    }

    let rpcRoot = null

    // google.rpc.Status and its details, for decoding grpc-status-details-bin whatever the schema holds
    function getRpcRoot() {
        if(rpcRoot === null) {
            rpcRoot = loadProtoFiles(Object.entries(RPC_PROTOS).map(([path, text]) => ({ path, text })))
        }
        return rpcRoot
    }

    // file descriptors in an order where each file comes after the ones it imports
    function sortFileDescriptors(files) {
        const byName = new Map(files.map(file => [file.name, file]))
        const sorted = []
        const visited = new Set()

        const visit = file => {
            if(visited.has(file.name)) {
                return
            }
            visited.add(file.name)
            for(const dependency of file.dependency ?? []) {
                if(byName.has(dependency)) {
                    visit(byName.get(dependency))
                }
            }
            sorted.push(file)
        }

        files.forEach(visit)
        return sorted
    }

    // buffers holding encoded google.protobuf.FileDescriptorProto, as server reflection gives them
    function decodeFileDescriptor(buffer) {
        return descriptor.FileDescriptorProto.decode(buffer)
    }

    function loadFileDescriptors(files) {
        const set = descriptor.FileDescriptorSet.create({ file: sortFileDescriptors(files) })
        const root = protobuf.Root.fromDescriptor(set, { keepCase: true })
        try {
            root.resolveAll()
        } catch(e) {
            throw new Error(`The schema from server reflection does not resolve: ${e.message}`, { cause: e })
        }
        return root
    }

    function isReflectionService(service) {
        return service.fullName.startsWith('.grpc.reflection.')
    }

    function getServices(root) {
        const services = []
        const walk = namespace => {
            for(const nested of namespace.nestedArray) {
                if(nested instanceof protobuf.Service) {
                    if(!isReflectionService(nested)) {
                        services.push(nested)
                    }
                } else if(nested instanceof protobuf.Namespace) {
                    walk(nested)
                }
            }
        }
        walk(root)
        return services
    }

    // serviceNames, for server reflection, are the services the server listed: a file it gave may also define services it
    // does not serve, such as one in a file the API imports. Those it listed but could not describe are named
    function describeSchema(root, source, serviceNames = null) {
        const services = getServices(root).filter(service => serviceNames === null || serviceNames.includes(service.fullName.slice(1)))
        const schema = {
            source,
            services: services.map(service => ({
                name: service.fullName.slice(1),
                methods: service.methodsArray.map(method => {
                    method.resolve()
                    return {
                        name: method.name,
                        path: `/${service.fullName.slice(1)}/${method.name}`,
                        requestStream: Boolean(method.requestStream),
                        responseStream: Boolean(method.responseStream),
                        inputType: method.resolvedRequestType.fullName.slice(1),
                        outputType: method.resolvedResponseType.fullName.slice(1),
                        example: JSON.stringify(createExample(method.resolvedRequestType), null, 2),
                    }
                }),
            })),
        }

        if(serviceNames !== null) {
            const describedNames = new Set(services.map(service => service.fullName.slice(1)))
            const missingServices = serviceNames.filter(name => !describedNames.has(name))
            if(missingServices.length > 0) {
                schema.missingServices = missingServices
            }
        }

        return schema
    }

    // the method of a fully qualified service, or an error saying which part is missing
    function findMethod(root, serviceName, methodName) {
        let service
        try {
            service = root.lookupService(serviceName)
        } catch {
            service = null
        }

        if(!service || isReflectionService(service)) {
            throw new Error(`The schema has no service ${serviceName}`)
        }

        const method = service.methods[methodName]
        if(!method) {
            throw new Error(`${serviceName} has no method ${methodName}`)
        }

        method.resolve()
        return { service, method }
    }

    return {
        loadProtoFiles,
        getRpcRoot,
        decodeFileDescriptor,
        loadFileDescriptors,
        describeSchema,
        findMethod,
    }
}
