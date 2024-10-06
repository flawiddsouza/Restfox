const obtainWindowContext = (element) => {
    return element.ownerDocument?.defaultView || window
}

const vResizable = {
    mounted(element, binding) {
        const window = obtainWindowContext(element)

        let topBottom = false

        topBottom = 'top-bottom' in binding.modifiers && binding.modifiers['top-bottom'] && binding.value

        let iframe = null

        const resizers = Array.from(element.querySelectorAll('[data-resizer]'))
        if(resizers.length > 0) {
            let activeResizer = null
            let leftPanelInitialRect = null

            resizers.forEach(resizer => {
                const mouseDown = e => {
                    e.preventDefault()
                    activeResizer = resizer
                    leftPanelInitialRect = activeResizer.previousElementSibling.getBoundingClientRect()
                    document.body.style.cursor = !topBottom ? 'ew-resize' : 'ns-resize'
                    activeResizer.setAttribute('data-resizing', '')

                    iframe = document.querySelector('.response-panel-tabs-context iframe')

                    if(iframe) {
                        iframe.style.pointerEvents = 'none'
                    }
                }
                resizer.addEventListener('mousedown', mouseDown)
            })

            const mouseMove = e => {
                if(!activeResizer) {
                    return
                }
                e.preventDefault()
                const leftPanel = activeResizer.previousElementSibling
                const rightPanel = activeResizer.nextElementSibling
                const leftPanelWidth = Number(getComputedStyle(leftPanel).flexGrow)
                const rightPanelWidth = Number(getComputedStyle(rightPanel).flexGrow)
                const leftPanelCurrentRect = leftPanel.getBoundingClientRect()
                const rightPanelCurrentRect = rightPanel.getBoundingClientRect()
                const totalWidthBetweenLeftAndRightPanel = leftPanelWidth + rightPanelWidth
                const clientDirection = !topBottom ? e.clientX : e.clientY
                const leftPanelInitialRectDirection = !topBottom ? leftPanelInitialRect.left : leftPanelInitialRect.top
                const x = clientDirection - leftPanelInitialRectDirection - 2
                const leftPanelCurrentRectWidth = !topBottom ? leftPanelCurrentRect.width : leftPanelCurrentRect.height
                const rightPanelCurrentRectWidth = !topBottom ? rightPanelCurrentRect.width : rightPanelCurrentRect.height

                let newLeftPanelWidth = ((leftPanelWidth !== 0 ? leftPanelWidth : 1) * x) / leftPanelCurrentRectWidth

                if(newLeftPanelWidth < leftPanelWidth && leftPanelCurrentRectWidth <= Number(leftPanel.dataset.minWidthPx)) {
                    newLeftPanelWidth = leftPanelWidth
                }

                if(newLeftPanelWidth > totalWidthBetweenLeftAndRightPanel) {
                    newLeftPanelWidth = leftPanelWidth
                }

                if(newLeftPanelWidth > leftPanelWidth && rightPanelCurrentRectWidth <= Number(rightPanel.dataset.minWidthPx)) {
                    newLeftPanelWidth = leftPanelWidth
                }

                const newRightPanelWidth = totalWidthBetweenLeftAndRightPanel - newLeftPanelWidth

                leftPanel.style.flexGrow = newLeftPanelWidth
                rightPanel.style.flexGrow = newRightPanelWidth

                element.dispatchEvent(new CustomEvent('resized', {
                    detail: {
                        leftPanel: newLeftPanelWidth,
                        rightPanel: newRightPanelWidth
                    }
                }))
            }

            window.addEventListener('mousemove', mouseMove)

            const mouseUp = e => {
                if(activeResizer) {
                    e.preventDefault()
                    activeResizer.removeAttribute('data-resizing')
                    activeResizer = null
                    document.body.style.removeProperty('cursor')

                    if(iframe) {
                        iframe.style.pointerEvents = ''
                        iframe = null
                    }
                }
            }

            window.addEventListener('mouseup', mouseUp)
        }
    }
}

export { vResizable }
