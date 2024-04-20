# Making HTTP Requests

You can make http requests in a Restfox plugin or script using this code:

```javascript
const timestamp = new Date().getTime()

console.log({ timestamp }) // { timestamp: 1713605897068 }

const response = fetchSync(`https://httpbin.org/post?param=${timestamp}`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        username: 'test',
        password: 'test123'
    })
})

console.log(response.status) // 200
console.log([...response.headers.entries()])
// [
//     [
//         "content-length",
//         "1088"
//     ],
//     [
//         "content-type",
//         "application/json"
//     ]
// ]
console.log(response.headers.get('content-length')) // 1088
console.log(response.text()) // response as text
console.log(response.json()) // response as parsed json
// {
//     "args": {
//         "param": "1713605897068"
//     },
//     "data": "{\"username\":\"test\",\"password\":\"test123\"}",
//     "files": {},
//     "form": {},
//     "headers": {
//         "Accept": "*/*",
//         "Accept-Encoding": "gzip, deflate, br, zstd",
//         "Accept-Language": "en-US,en;q=0.9",
//         "Content-Length": "40",
//         "Content-Type": "application/json",
//         "Host": "httpbin.org",
//     },
//     "json": {
//         "password": "test123",
//         "username": "test"
//     },
//     "url": "https://httpbin.org/post?param=1713605897068"
// }
```
