# ![Restfox](https://raw.github.com/flawiddsouza/Restfox/main/packages/ui/public/pwa-192x192.png "Restfox")

# Restfox

[**Website**](https://restfox.dev) **|** [**Install**](#installation) **|** [**Releases/Downloads**](https://github.com/flawiddsouza/Restfox/releases) **|** [**Screenshots**](#screenshots) **|** [**Compiling**](#compiling) **|** [**Compiling Web Standalone**](#using-web-standalone) 

Offline-first web HTTP client

## Installation

### MacOS
Package available in homebrew by using:
`brew install restfox`

### Ubuntu and other distributions supporting snap
Package available through snap can be installed using:
`sudo snap install restfox`

### RPM, DEB and NuPKG
There are precompiled binaries in the [releases](https://github.com/flawiddsouza/Restfox/releases) page.

### Windows
There are precompiled binaries in the [releases](https://github.com/flawiddsouza/Restfox/releases) page.

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

# Compiling

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

### Web Standalone distribution and development
```
npm run build-web-standalone
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

## tauri(optional)

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

## Using web-standalone
```
git clone https://github.com/flawiddsouza/Restfox
cd packages/ui
npm i
npm run build-web-standalone
cd ../web-standalone
npm i
npm start
```

By default npm start will run Restfox at port 4004. You can override the port by passing port like so `PORT=5040 npm start`.

## Built and used by Docker

First refer to [**Compiling Web Standalone**](#using-web-standalone) to build successfully locally and use it normally.  
Then in the project root directory (directory with Dockerfile), execute:  
```
docker build -t restfox:xx .
```
> Note: xx is the version number

After the build is complete, use the following command to start the service:  
```
docker run -d -p:4004:4004 restfox:xx
```
Visit after successful startup: localhost:4004