<template>
    <div class="context-menu-container" :style="{ 'visibility': show ? 'visible': 'hidden' }">
        <div class="context-menu-background" @click.stop="$emit('update:show', false)"></div>
        <div class="context-menu" :style="contextMenuStyle">
            <div v-for="option in options">
                <template v-if="option.type === 'option'">
                    <button type="button" class="context-menu-item" :disabled="option.disabled" @click.stop="$emit('click', option.value); $emit('update:show', false);">
                        <i :class="option.icon" v-if="option.icon"></i> {{ option.label }}
                    </button>
                </template>
                <template v-if="option.type === 'separator'">
                    <div class="context-menu-separator"></div>
                </template>
            </div>
        </div>
    </div>
</template>

<script>
// From: https://stackoverflow.com/a/11802841/4932305
function getContextMenuPostion(x, y, contextMenuElement, yOffset=0) {
    var mousePosition = {}
    var menuPostion = {}
    var menuDimension = {}

    menuDimension.x = contextMenuElement.offsetWidth
    menuDimension.y = contextMenuElement.offsetHeight
    mousePosition.x = x
    mousePosition.y = y

    if(mousePosition.x + menuDimension.x > window.innerWidth + document.body.scrollLeft) {
        menuPostion.x = mousePosition.x - menuDimension.x
    } else {
        menuPostion.x = mousePosition.x
    }

    if(mousePosition.y + menuDimension.y > window.innerHeight + document.body.scrollTop) {
        menuPostion.y = mousePosition.y - menuDimension.y - yOffset
    } else {
        menuPostion.y = mousePosition.y
    }

    return menuPostion
}

import { nextTick } from 'vue'

export default {
    props: {
        options: Array,
        element: Element,
        show: {
            type: Boolean,
            default: false
        },
        x: {
            type: Number,
            required: false
        },
        y: {
            type: Number,
            required: false
        },
        xOffset: {
            type: Number,
            required: false
        }
    },
    data() {
        return {
            contextMenuStyle: {}
        }
    },
    computed: {
        elementRect() {
            if(this.element) {
                return this.element.getBoundingClientRect()
            }

            return null
        }
    },
    watch: {
        show() {
            if(this.show) {
                nextTick(() => {
                    this.$store.state.openContextMenuElement = this.$el
                    this.setContextMenuStyle()
                })
            } else {
                this.$store.state.openContextMenuElement = null
            }
        }
    },
    methods: {
        setContextMenuStyle() {
            const xDefined = this.x !== null && this.x !== undefined
            const yDefined = this.y !== null && this.y !== undefined

            if((!xDefined && !xDefined) && !this.element) {
                return {}
            }

            let x = xDefined ? this.x : this.elementRect.left + (this.xOffset ? this.xOffset : 0)
            let y = yDefined ? this.y : this.elementRect.bottom

            const contextMenuPosition = getContextMenuPostion(x, y, this.$el.querySelector('.context-menu'), yDefined ? 0 : this.elementRect.height)
            x = contextMenuPosition.x
            y = contextMenuPosition.y

            this.contextMenuStyle = {
                left: x + 'px',
                top: y + 'px'
            }
        }
    }
}
</script>

<style scoped>
.context-menu-background {
  position: fixed;
  z-index: 1;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
}

.context-menu {
    position: fixed;
    z-index: 1;
    border: 1px solid #82828240;
    box-shadow: 0 0 1rem 0 rgba(0, 0, 0, 0.1);
    border-radius: calc(1rem * 0.3);
    min-width: 15rem;
    padding-top: 5px;
    padding-bottom: 5px;
    background: #ffffff;
    overflow-y: auto;
    left: -9999px;
}

button.context-menu-item {
    padding: 0.5rem;
    outline: 0;
    background: #ffffff;
    border: 0;
    display: block;
    width: 100%;
    text-align: left;
}

button.context-menu-item:not(:active):focus {
    outline: 1px solid black;
    background: #82828240;
}

button.context-menu-item:hover:not(:disabled),
button.context-menu-item.active:not(:disabled) {
    background: #82828240;
}

button.context-menu-item:active:not(:disabled) {
    background: #82828259;
}

button.context-menu-item > i {
    display: inline-block;
    width: 2.2em;
    text-align: center;
}

.context-menu-separator {
    border-bottom: 1px solid var(--modal-border-color);
    margin-top: 5px;
    margin-bottom: 5px;
}
</style>
