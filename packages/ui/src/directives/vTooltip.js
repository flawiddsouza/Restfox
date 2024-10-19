export const vTooltip = {
    mounted(el, binding) {
        el.addEventListener('mouseenter', () => {
            var tooltip = document.querySelector('.tooltip')
            if(tooltip) {
                tooltip.remove()
            }
            var div = document.createElement('div')
            div.classList.add('tooltip')
            div.innerText = binding.value
            var dimens = el.getBoundingClientRect()
            div.style.left = dimens.left + 'px'
            div.style.top = (dimens.bottom + 5) + 'px'
            document.body.appendChild(div)
        })

        el.addEventListener('mouseleave', () => {
            var tooltip = document.querySelector('.tooltip')
            if(tooltip) {
                tooltip.remove()
            }
        })
    }
}
