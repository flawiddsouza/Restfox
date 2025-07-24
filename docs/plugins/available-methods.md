# Available Methods

| Method | Description |
|--------|-------------|
| `console.log(...)` | Logs information to the console. |
| `alert(message)` | Shows an alert dialog with the specified message. |
| `rf.getEnvVar(name)` | Retrieves the value of the specified environment variable. |
| `rf.setEnvVar(name, value)` | Sets the specified environment variable to the given value in the workspace. |
| `rf.setParentEnvVar(name, value)` | Sets the specified environment variable to the given value in the parent folder scope. |
| `rf.arrayBuffer.toString(buffer)` | Converts an `ArrayBuffer` to a `string`. |
| `rf.arrayBuffer.fromString(string)` | Converts a `string` to an `ArrayBuffer`. |
| `rf.base64.toUint8Array(base64)` | Converts a base64 encoded `string` to a `Uint8Array`. |
| `rf.base64.fromUint8Array(uint8Array)` | Converts a `Uint8Array` to a base64 encoded `string`. |
| `fetchSync('<URL>', <FetchOptions>)` | See: [Making HTTP Requests](../plugins/making-http-requests). |

### Desktop Only
| Method | Description |
|--------|-------------|
| `await readFile(path)` | Reads the contents of a file at the provided file path and returns it as a string. |

### Pre Request
| Method | Description |
|--------|-------------|
| `rf.request.getMethod()` | Returns the HTTP method of the request. |
| `rf.request.getURL()` | Retrieves the URL of the request. |
| `rf.request.getHeader(name)` | Gets a specific header's value by name from the request. |
| `rf.request.setHeader(name, value)` | Sets a specific header's value for the request. |
| `rf.request.getHeaders()` | Gets all the headers from the request. |
| `rf.request.setHeaders(headers)` | Replaces all headers with the provided array. |
| `rf.request.getBody()` | Gets the request body. |
| `rf.request.setBody(body)` | Sets the request body with the provided object. |
| `rf.request.getQueryParams()` | Retrieves query parameters from the request. |
| `rf.request.setQueryParams(queryParams)` | Sets or replaces query parameters with the provided array. |
| `rf.request.getPathParams()` | Retrieves path parameters from the request. |
| `rf.request.setPathParams(pathParams)` | Sets or replaces path parameters with the provided array. |

### Post Request
| Method | Description |
|--------|-------------|
| `rf.response.getURL()` | Retrieves the URL from the response. |
| `rf.response.getHeader(name)` | Gets a specific header's value by name from the response. |
| `rf.response.getHeaders()` | Gets all the headers from the response. |
| `rf.response.setHeader(name, value)` | Sets a specific header's value for the response. |
| `rf.response.getBody()` | Retrieves the response body as an ArrayBuffer. |
| `rf.response.setBody(body)` | Sets the response body with the provided ArrayBuffer. |
| `rf.response.getBodyText()` | Returns the response body as text. |
| `rf.response.setBodyText(bodyText)` | Sets the given text as the response body. |
| `rf.response.getBodyJSON()` | Returns the response body as a parsed JSON object. |
