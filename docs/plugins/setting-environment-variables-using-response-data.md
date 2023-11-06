# Setting Environment Variables Using Response Data

You can use a plugin to parse the received response of a request and set an environment variable from it. Example, you have an access token that you get from your login api that you want to use in other requests. Here's how to do it:

<iframe width="100%" height="500" src="https://www.youtube-nocookie.com/embed/3cOQPm43Wus?si=LH2pEnkF5Hg9wbZJ" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

**Here's an example plugin for easy copy & paste :**
```javascript
function handleResponse() {
    const response = context.response.getBodyText()
    const responseData = JSON.parse(response)
    context.response.setEnvironmentVariable('MyAccessToken', responseData.accessToken)
}

if('response' in context) {
    handleResponse()
}
```
