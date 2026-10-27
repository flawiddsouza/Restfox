# gRPC Requests

A gRPC request calls one method of a gRPC service and shows the messages it sends and receives. Create one from the sidebar's create menu with **gRPC Request**.

## Where it works

gRPC calls need the Restfox desktop app or a self-hosted Restfox ([web-standalone](https://github.com/flawiddsouza/Restfox#using-web-standalone) or the [Docker image](https://hub.docker.com/r/flawiddsouza/restfox)), which make the call from your computer or the server. A browser cannot make gRPC calls, so in the web app and the browser extension gRPC requests can be created, edited, imported and exported, but not sent.

gRPC calls follow Settings > Disable SSL Verification, CA Certificates and Proxy. In the desktop app they do so whichever transport is chosen for HTTP requests.

## Server address

The address is the server alone, without a path. Environment variables and tags work in it as in an HTTP url.

| address | connects with |
|---|---|
| `grpcs://api.example.com` or `https://api.example.com` | TLS, port 443 |
| `grpc://10.0.0.5:9000` or `http://10.0.0.5:9000` | plaintext |
| `localhost:50051`, `127.0.0.1:50051`, `[::1]:50051` | plaintext, as the host is this computer |
| `api.example.com:8443` | TLS, as the host is another computer |

Without a port, TLS uses 443 and plaintext 80. The tag next to the address says which one Restfox will use.

## Methods: server reflection or .proto files

Restfox needs the service's schema to list its methods and to write and read its messages. It gets it one of two ways, chosen in the **Proto** tab:

- **Server reflection** (the default): Restfox asks the server for its schema. The server has to offer the gRPC server reflection service, which many servers turn on only in development.
- **.proto files**: add the service's `.proto` files with **Add files**, or a whole folder with **Add folder**. Imports between the files are resolved by their paths inside the folder you picked, so add the folder your `protoc` or `buf` import paths start from. The well-known types (`google/protobuf/*.proto`), `google/rpc/status.proto` and `google/rpc/error_details.proto` are built in.

The files are saved with the request, and travel with it in exports. **Reload** fetches the schema again, such as after the server changed.

Pick the method from the method picker in the address bar. A new message is filled with an example of every field, and **Generate example** does it again later.

## The four kinds of call

| kind | what you do |
|---|---|
| unary | **Send** sends the message and shows the reply. |
| server stream | **Send** sends the message and shows each reply as it arrives, until the server ends the call or you press **Stop**. |
| client stream | **Start** opens the call, **Send message** sends the message in the editor, as often as you like, and **End stream** tells the server you sent your last message. |
| bidi stream | as a client stream, with each reply shown as it arrives. |

The response panel lists the messages in the order they went out and came in, with the status the server ended the call with, its sent and received metadata and its trailers. Each finished call is kept in the response history, including its sent metadata. The response panel's **Metadata** tab shows sent metadata above received metadata.

A unary reply is shown as JSON. Pick a streamed message to open its detail below the list. JSON follows Settings > Editor Indent Size, including replies in history, and changes when the setting changes. Select reply text and use **Set selected text as environment variable** to keep it in the workspace's environment. A large reply or opened message asks you to **Load Response** before showing its content; it is still received and saved in full.

If a reply cannot be decoded, the panel says **Could not be decoded**, shows the reason and keeps the received bytes as selectable base64. A reply with fields missing from the schema names them, such as **Has fields the .proto files do not describe: 2, point.5**, and shows both its JSON and its bytes. Paths use field names followed by the unknown field's number. Repeated elements share a path such as `items.3`, map value messages use `labels.value.4`, and an `Any` payload stays under its field's name. These bytes and paths are also kept in history. An undecodable message does not stop the call; Restfox keeps reading until the server ends it or you stop it.

Settings > Request Timeout applies to unary and server stream calls. Client and bidi streams stay open until you or the server end them.

## Metadata and auth

The **Metadata** tab works like an HTTP request's headers, and the **Auth** tab like its auth, including inheriting from the folder. A folder's headers and auth apply to the gRPC requests in it too. Metadata whose name ends in `-bin` takes a base64 value. Two rows with the same name go out as one value joined with a comma, which gRPC reads as the same. For a `-bin` name, each row's value is sent on its own.

Scripts, a folder's included, do not run for gRPC requests, and the Collection Runner skips them.

## Response tags

A response tag can read a unary gRPC request. **Body** reads the reply's JSON with JSONPath, **Raw** reads that JSON as text, and **Header** reads received metadata by name, without regard to case. The trigger behaviors work as for HTTP requests. A triggered call uses the same metadata, inherited auth, prompts and connection settings as **Send**, and the tag waits for the call to end and be saved.

Tags read the latest completed call with status OK and exactly one decoded reply. They skip failed, cancelled and undecodable calls, and can read the known fields of a reply whose bytes also contain unknown fields. A tag that makes its own call reads that call, and stops the send when the call does not end that way. A stream or a request without a chosen unary method cannot be read by a response tag.

## Messages

Messages are written as JSON, using the field names from the `.proto` files or their camelCase JSON names. 64-bit numbers are written as strings, such as `"12345678901234567890"`, so they keep every digit. Environment variables and tags work in messages, and each streamed message is resolved when it is sent.

## Copy as grpcurl

The request's menu in the sidebar has **Copy as grpcurl**, which copies a [grpcurl](https://github.com/fullstorydev/grpcurl) command that makes the same call. With `.proto` files, the command names them by the paths their imports use, so run it in a folder that holds your own copy of the files laid out as those paths say.

## Import

gRPC requests come along in Restfox exports, and are imported from Insomnia exports with their metadata and message. An Insomnia v4 export carries the request's `.proto` files and an Insomnia v5 export leaves them out, so a request imported from v5 uses server reflection until you add the files. Insomnia writes some values of a message in another form than the protobuf JSON format Restfox sends, such as a `google.protobuf.BoolValue` as `{"value": true}` rather than `true`, or a `Timestamp` as `{"seconds": 1}`. Restfox rewrites them while importing, from the export's `.proto` files, in the desktop app and a self-hosted Restfox. A message imported without them keeps Insomnia's form, which you change by hand. Insomnia sends a gRPC request with only its own metadata, while Restfox also sends the headers of the folders it is in, so check the folders of an imported request for headers meant only for HTTP requests.
