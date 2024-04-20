# Using crypto-js

You can use crypto-js in a Restfox plugin or script using this code:

```javascript
import CryptoJS from 'https://esm.sh/crypto-js@latest?target=es2020'

var data = 'my string'
const secretKey = 'secret key 123'

// Encrypt
var ciphertext = CryptoJS.AES.encrypt(JSON.stringify(data), secretKey).toString()

// Decrypt
var bytes  = CryptoJS.AES.decrypt(ciphertext, secretKey)
var decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8))

console.log(decryptedData) // output: my string
```
