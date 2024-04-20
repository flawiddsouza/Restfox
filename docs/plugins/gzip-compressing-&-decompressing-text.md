# GZIP Compressing & Decompressing text

You can gzip compress or decompress text in a Restfox plugin or script using this code:

```javascript
import pako from 'https://unpkg.com/pako@2.1.0/dist/pako.esm.mjs?module'

// compressing a string to a base64 gzipped string
const buffer = rf.arrayBuffer.fromString('My Gzipped Text')
const compressedBuffer = pako.deflate(buffer)
const compressedText = rf.base64.fromUint8Array(compressedBuffer)
console.log(compressedText) // output: eJzzrVQISa0oAQAJewKM

// decompressing a base64 gzipped string
const buffer2 = rf.base64.toUint8Array(compressedText)
const decompressedGzip = pako.inflate(buffer2)
const uncompressedText = rf.arrayBuffer.toString(decompressedGzip)
console.log(uncompressedText) // output: My Gzipped Text
```
