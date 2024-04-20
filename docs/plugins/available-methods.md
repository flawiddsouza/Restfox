# Available Methods

| Method | Description |
|--------|-------------|
| `console.log(...)` | Logs information to the console. |
| `alert(message)` | Shows an alert dialog with the specified message. |
| `rf.getEnvVar('<ENVIRONMENT_VARIABLE_NAME>')` | Retrieves the value of the specified environment variable. |
| `rf.setEnvVar('<ENVIRONMENT_VARIABLE_NAME>', '<ENVIRONMENT_VARIABLE_VALUE>')` | Sets the specified environment variable to the given value. |
| `fetchSync('<URL>', <FetchOptions>)` | See: [Making HTTP Requests](../plugins/making-http-requests). |

### Desktop Only
| Method | Description |
|--------|-------------|
| `await readFile('<FILE_PATH>')` | Reads the contents of a file at the provided filepath and returns it as a string. |

### Pre Request
| Method | Description |
|--------|-------------|
| `rf.request.getMethod()` | Returns the HTTP method of the request. |
| `rf.request.getURL()` | Retrieves the URL of the request. |
| `rf.request.getHeader('<HEADER_NAME>')` | Gets a specific header's value by name from the request. |
| `rf.request.setHeader('<HEADER_NAME>', '<HEADER_VALUE>')` | Sets a specific header's value for the request. |
| `rf.request.getHeaders()` | Gets all the headers from the request. |
| `rf.request.setHeaders(<HEADER_ARRAY>)` | Replaces all headers with the provided array. |
| `rf.request.getBody()` | Gets the request body. |
| `rf.request.setBody(<REQUEST_BODY_OBJECT>)` | Sets the request body with the provided object. |
| `rf.request.getQueryParams()` | Retrieves query parameters from the request. |
| `rf.request.setQueryParams(<REQUEST_QUERY_PARAMS_ARRAY>)` | Sets or replaces query parameters with the provided array. |

### Post Request
| Method | Description |
|--------|-------------|
| `rf.response.getURL()` | Retrieves the URL from the response. |
| `rf.response.getHeader('<HEADER_NAME>')` | Gets a specific header's value by name from the response. |
| `rf.response.getHeaders()` | Gets all the headers from the response. |
| `rf.response.getBody()` | Retrieves the response body as an ArrayBuffer. |
| `rf.response.setBody(<RESPONSE_BODY_ARRAY_BUFFER>)` | Sets the response body with the provided ArrayBuffer. |
| `rf.response.getBodyText()` | Returns the response body as text. |
| `rf.response.setBodyText(<RESPONSE_BODY_TEXT>)` | Sets the given text as the response body. |
| `rf.response.getBodyJSON()` | Returns the response body as a parsed JSON object. |
