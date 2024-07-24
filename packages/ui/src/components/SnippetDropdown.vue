<template>
    <div @contextmenu="openContextMenu">
        <button type="button" class="button" @click="handleContextMenuOpen" style="cursor: pointer;">Snippets</button>
        <ContextMenu
            :options="contextMenuOptions"
            :element="contextMenuElement"
            v-model:show="showContextMenu"
            @click="handleContextMenuClick"
            :x="contextMenuX"
            :y="contextMenuY"
            :x-offset="2000"
        />
    </div>
</template>

<script lang="ts">
import { defineComponent, Ref, ref, watch } from 'vue'
import ContextMenu from '@/components/ContextMenu.vue'

const makeHttpRequestSnippet = `const timestamp = new Date().getTime()

console.log({ timestamp }) // { timestamp: 1713605897068 }

const response = fetchSync(\`https://httpbin.org/post?param=\${timestamp}\`, {
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
//     "data": "{\\"username\\":\\"test\\",\\"password\\":\\"test123\\"}",
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
// }`

export default defineComponent ({
    name: 'SnippetContextMenu',

    components: {
        ContextMenu
    },

    props: {
        type: {
            type: String,
            required: true
        }
    },

    setup(props, {emit}) {
        const contextMenuVisible = ref (false)
        const contextMenuX = ref (0)
        const contextMenuY = ref (0)
        const contextMenuElement = ref (null)
        const showContextMenu = ref (false)
        const contextMenuOptions: Ref<{
            type: string,
            label: string,
            value?: string,
            icon?: string,
            class?: string,
            disabled?: boolean,
        }[]> = ref ([])

        const availableMethods = [
            {
                type: 'option',
                label: 'Available Methods',
                icon: 'fa fa-code',
                disabled: true,
                class: 'text-with-line'
            },
            {
                type: 'option',
                label: 'Log info to the console',
                value: 'console.log(...)',
            },
            {
                type: 'option',
                label: 'Alert message',
                value: 'alert(message)',
            },
            {
                type: 'option',
                label: 'Get an environment variable',
                value: 'rf.getEnvVar(name)',
            },
            {
                type: 'option',
                label: 'Set an environment variable',
                value: 'rf.setEnvVar(name, value)',
            },
            {
                type: 'option',
                label: 'Converts an ArrayBuffer to a string',
                value: 'rf.arrayBuffer.toString(buffer)',
            },
            {
                type: 'option',
                label: 'Converts a string to an ArrayBuffer',
                value: 'rf.arrayBuffer.fromString(string)',
            },
            {
                type: 'option',
                label: 'Converts a base64 encoded string to a Uint8Array',
                value: 'rf.base64.toUint8Array(base64)',
            },
            {
                type: 'option',
                label: 'Converts a Uint8Array to a base64 encoded string',
                value: 'rf.base64.fromUint8Array(uint8Array)',
            },
            {
                type: 'option',
                label: 'Make HTTP Request',
                value: makeHttpRequestSnippet,
            }
        ]


        const preScripts = [
            {
                type: 'option',
                label: 'Pre Request',
                icon: 'fa fa-file-import',
                disabled: true,
                class: 'text-with-line'
            },
            {
                type: 'option',
                label: 'Returns the HTTP method of the request',
                value: 'rf.request.getMethod()'},
            {
                type: 'option',
                label: 'Retrieves the URL of the request',
                value: 'rf.request.getURL()'},
            {
                type: 'option',
                label: 'Gets a specific header\'s value by name from the request',
                value: 'rf.request.getHeader(name)'
            },
            {
                type: 'option',
                label: 'Sets a specific header\'s value for the request',
                value: 'rf.request.setHeader(name, value)'
            },
            {
                type: 'option',
                label: 'Gets all the headers from the request',
                value: 'rf.request.getHeaders()'},
            {
                type: 'option',
                label: 'Replaces all headers with the provided array',
                value: 'rf.request.setHeaders(headers)'
            },
            {
                type: 'option',
                label: 'Gets the request body',
                value: 'rf.request.getBody()'},
            {
                type: 'option',
                label: 'Sets the request body with the provided object',
                value: 'rf.request.setBody(body)'
            },
            {
                type: 'option',
                label: 'Retrieves query parameters from the request',
                value: 'rf.request.getQueryParams()'
            },
            {
                type: 'option',
                label: 'Sets or replaces query parameters with the provided array',
                value: 'rf.request.setQueryParams(queryParams)'
            }
        ]

        const postScripts = [
            {
                type: 'option',
                label: 'Post Request',
                icon: 'fa fa-file-export',
                disabled: true,
                class: 'text-with-line'
            },
            {
                type: 'option',
                label: 'Retrieves the URL from the response',
                value: 'rf.response.getURL()'},
            {
                type: 'option',
                label: 'Gets a specific header\'s value by name from the response',
                value: 'rf.response.getHeader(name)'
            },
            {
                type: 'option',
                label: 'Gets all the headers from the response',
                value: 'rf.response.getHeaders()'
            },
            {
                type: 'option',
                label: 'Retrieves the response body as an ArrayBuffer',
                value: 'rf.response.getBody()'},
            {
                type: 'option',
                label: 'Sets the response body with the provided ArrayBuffer',
                value: 'rf.response.setBody(body)'
            },
            {
                type: 'option',
                label: 'Returns the response body as text',
                value: 'rf.response.getBodyText()'},
            {
                type: 'option',
                label: 'Sets the given text as the response body',
                value: 'rf.response.setBodyText(bodyText)'
            },
            {
                type: 'option',
                label: 'Returns the response body as a parsed JSON object',
                value: 'rf.response.getBodyJSON()'
            }
        ]

        availableMethods.forEach ((method) => {
            contextMenuOptions.value.push (method)
        })

        watch (
            () => props.type,
            (newType) => {
                switch (newType) {
                    case 'preScripts':
                        preScripts.forEach ((method) => {
                            contextMenuOptions.value.push (method)
                        })
                        break
                    case 'postScripts':
                        postScripts.forEach ((method) => {
                            contextMenuOptions.value.push (method)
                        })
                        break
                    default:
                        preScripts.forEach ((method) => {
                            contextMenuOptions.value.push (method)
                        })
                        postScripts.forEach ((method) => {
                            contextMenuOptions.value.push (method)
                        })
                        break
                }
            },
            { immediate: true }
        )

        const openContextMenu = (event: MouseEvent) => {
            event.preventDefault ()
            contextMenuX.value = event.clientX
            contextMenuY.value = event.clientY
            contextMenuVisible.value = true
        }

        const handleContextMenuClick = (value: string) => {
            emit ('optionSelected', value)
            contextMenuVisible.value = false
        }

        const handleContextMenuOpen = (event: any) => {
            contextMenuX.value = event.target.getBoundingClientRect ().left
            contextMenuY.value = event.target.getBoundingClientRect ().top + event.target.getBoundingClientRect ().height
            contextMenuElement.value = event.target
            showContextMenu.value = true
        }

        return {
            contextMenuVisible,
            contextMenuX,
            contextMenuY,
            showContextMenu,
            openContextMenu,
            handleContextMenuClick,
            handleContextMenuOpen,
            contextMenuElement,
            contextMenuOptions
        }
    }
})
</script>
