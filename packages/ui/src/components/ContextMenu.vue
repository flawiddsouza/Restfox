<template>
    <div class="context-menu-container" :style="{ 'visibility': show ? 'visible': 'hidden' }">
        <div class="context-menu-background" @click.stop="$emit('update:show', false)"></div>
        <div class="context-menu" :style="contextMenuStyle" @click.stop>
            <div v-for="option in options" :key="option.value">
                <template v-if="option.type === 'option'">
                    <slot name="option" :option="option">
                        <button
                            type="button"
                            class="context-menu-item"
                            :class="`${option.class ? option.class : ''}`"
                            :disabled="option.disabled"
                            @click.stop="handleClick(option)"
                        >
                            <i :class="option.icon" v-if="option.icon"></i>
                            <div v-html="getOption(option)" style="display: flex;"></div>
                        </button>
                    </slot>
                </template>
                <template v-if="option.type === 'separator'">
                    <div class="context-menu-separator" @click.stop></div>
                </template>
            </div>
        </div>
    </div>
</template>

<script>
// From: https://stackoverflow.com/a/11802841/4932305
function getContextMenuPostion(x, y, contextMenuElement, yOffset = 0, width = null) {
    var mousePosition = {}
    var menuPostion = {}
    var menuDimension = {}

    menuDimension.x = width || contextMenuElement.offsetWidth
    menuDimension.y = contextMenuElement.offsetHeight
    mousePosition.x = x
    mousePosition.y = y

    if(mousePosition.x + menuDimension.x > window.innerWidth + document.body.scrollLeft) {
        menuPostion.x = mousePosition.x - menuDimension.x
    } else {
        menuPostion.x = mousePosition.x
    }

    // If the menu is going to be below the bottom of the screen, move it up
    if(mousePosition.y + menuDimension.y > window.innerHeight + document.body.scrollTop) {
        menuPostion.y = mousePosition.y - menuDimension.y - yOffset
        // minus, means the menu is going to be above the top of the screen
        if(menuPostion.y < 0) {
            menuPostion.maxHeight = menuDimension.y + menuPostion.y
            menuPostion.y = 0
        }
    } else {
        menuPostion.y = mousePosition.y
    }

    return menuPostion
}

import { nextTick } from 'vue'

export default {
    props: {
        options: {
            type: Array,
            required: true,
            default: () => []
        },
        element: {
            type: [Element, null],
            default: null
        },
        show: {
            type: Boolean,
            default: false
        },
        x: {
            type: Number,
            default: null
        },
        y: {
            type: Number,
            default: null
        },
        xOffset: {
            type: Number,
            default: 0
        },
        width: {
            type: Number,
            default: null
        },
        selectedOption: {
            type: [Object, String],
            default: undefined
        },
    },
    data() {
        return {
            contextMenuStyle: {},
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
        show(newVal) {
            if (newVal) {
                nextTick(() => {
                    this.$store.state.openContextMenuElement = this.$el
                    this.setContextMenuStyle()
                })
            } else {
                this.$store.state.openContextMenuElement = null
                this.contextMenuStyle = {}
            }
        }
    },
    methods: {
        setContextMenuStyle() {
            const xDefined = this.x !== null && this.x !== undefined
            const yDefined = this.y !== null && this.y !== undefined

            if (!xDefined && !yDefined && !this.element) {
                return {}
            }

            let x = xDefined ? this.x : this.elementRect.left + (this.xOffset || 0)
            let y = yDefined ? this.y : this.elementRect.bottom

            const contextMenuPosition = getContextMenuPostion(x, y, this.$el.querySelector('.context-menu'), yDefined ? 0 : this.elementRect.height, this.width)
            this.contextMenuStyle = {
                left: `${contextMenuPosition.x}px`,
                top: `${contextMenuPosition.y}px`,
                maxHeight: contextMenuPosition.maxHeight ? `${contextMenuPosition.maxHeight}px` : 'auto',
                width: this.width ? `${this.width}px` : 'auto',
            }
        },
        handleClick(option) {
            this.$emit('click', option.value)
            this.$emit('update:show', false)
        },
        getOption(option) {
            const tickMark = '<div class="selected-indicator" style="margin-right: 0.3rem;"><i class="fa fa-check"></i></div>'
            const noTickMark = '<div class="selected-indicator" style="margin-left: 1rem;"></div>'
            const displayedOption = `<div style="word-break: break-all;">${option.label}</div>`

            if(this.selectedOption === undefined || option.disabled) {
                return displayedOption
            }

            const { _id } = option.value || {}
            const isSelected = (_id && _id === this.selectedOption?._id) || (option.value === this.selectedOption)

            return `${isSelected ? tickMark : noTickMark}${displayedOption}`
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
    border: 1px solid var(--menu-border-color);
    box-shadow: 0 0 1rem 0 var(--box-shadow-color);
    border-radius: 0.3rem;
    min-width: 15rem;
    padding-top: 5px;
    padding-bottom: 5px;
    background: var(--background-color);
    overflow-y: auto;
    left: -9999px;
    max-height: 30rem;
    user-select: none;
}

button.context-menu-item {
    padding: 0.5rem;
    outline: none;
    background: var(--background-color);
    border: none;
    display: flex;
    width: 100%;
    text-align: left;
    color: var(--text-color);
    cursor: pointer;
}

button.context-menu-item:disabled {
    cursor: default;
    font-size: 0.7rem;
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

.selected-indicator {
    padding-right: 0.1rem;
    font-size: 0.5rem;
    color: var(--button-text-color);
}

.context-menu-header {
    font-weight: bold;
    font-size: 12px;
    text-transform: uppercase;
}

button.context-menu-item-with-left-padding {
    padding-left: 1rem;
}
</style>
