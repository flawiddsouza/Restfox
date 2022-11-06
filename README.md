# Restfox

Offline-first web HTTP client

## Screenshots

<img src="screenshots/1.png?raw=true">

<img src="screenshots/2.png?raw=true">

### Response History

<img src="screenshots/3.png?raw=true">

### Context Menu

<img src="screenshots/8.png?raw=true">

### Environment Variables

<img src="screenshots/4.png?raw=true">
<img src="screenshots/5.png?raw=true">

### Plugins

<img src="screenshots/6.png?raw=true">
<img src="screenshots/7.png?raw=true">

## ui

### Development
```
npm run dev
```

### Distribution
```
npm run build
```

### Desktop distribution and development
```
npm run build-desktop
```

## electron

### To upgrade electron to latest version
```bash
npm install --save-dev electron@latest @electron-forge/cli@latest @electron-forge/maker-deb@latest @electron-forge/maker-rpm@latest @electron-forge/maker-squirrel@latest @electron-forge/maker-zip@latest
```

### Development
```
npm run start
```

### Distribution
```
npm run make
```
or
```
npm run publish
```

## tauri

### fetch polyfill for tauri

After ui is built, go to the ui/assets/index.[hash].js file and add this code at the top of the file:
```js
export async function fetch(input, init) {
    const fetch = window.__TAURI__.http.fetch

    const params = {
        ...init,
        body: {
            type: 'Text',
            payload: init.body
        }
    };

    if(params.body.payload instanceof URLSearchParams) {
        params.body.payload = params.body.payload.toString()
    }

    if(init.method === 'GET' || 'body' in init === false || init.body === null) {
        delete params.body
    }

    const res = await fetch(input.toString(), params)

    return new Response(JSON.stringify(res.data), res)
}
```

### Development
```
npm run dev
```

### Distribution
```
npm run build
```
