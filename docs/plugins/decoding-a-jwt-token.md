# Decoding a JWT Token

You can decode a JWT token in a Restfox plugin or script using this code:

```javascript
import jsonwebtoken from 'https://esm.sh/jsonwebtoken@9.0.2'

const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

const secretKey = 'your-256-bit-secret'

console.log(jsonwebtoken.decode(jwtToken, secretKey))
```
