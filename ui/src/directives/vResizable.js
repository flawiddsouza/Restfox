const vResizable = {
    mounted(element, binding) {
        let topBottom = false

        topBottom = 'top-bottom' in binding.modifiers && binding.modifiers['top-bottom'] && binding.value

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

                if(newLeftPanelWidth < leftPanelWidth && leftPanelCurrentRectWidth <= Number(leftPanel.dataset.minWidthPx.replace('px', ''))) {
                    newLeftPanelWidth = leftPanelWidth
                }

                if(newLeftPanelWidth > totalWidthBetweenLeftAndRightPanel) {
                    newLeftPanelWidth = leftPanelWidth
                }

                if(newLeftPanelWidth > leftPanelWidth && rightPanelCurrentRectWidth <= Number(rightPanel.dataset.minWidthPx.replace('px', ''))) {
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
                    activeResizer = null
                    document.body.style.removeProperty('cursor')
                }
            }

            window.addEventListener('mouseup', mouseUp)
        }
    }
}

export { vResizable }
