// Chrome alert, confirm and prompt replacements
class AlertConfirmPrompt extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
    }

    createPrompt = (title, defaultValue='') => {
        const div = document.createElement('div')

        div.innerHTML  = `
            <div class="dialog-container">
                <div class="dialog">
                    <div>${title}</div>
                    <div style="margin-top: 0.5rem;">
                        <input type="text" value="${defaultValue ?? ''}" class="dialog-input" id="p-input" spellcheck="false">
                    </div>
                    <div style="margin-top: 1rem; text-align: right; user-select: none;">
                        <button class="dialog-primary-button" id="p-confirm">OK</button>
                        <button class="dialog-secondary-button" id="p-cancel">Cancel</button>
                    </div>
                </div>
            </div>
        `

        this.shadowRoot.querySelector('#root').appendChild(div)

        this.shadowRoot.getElementById('p-input').focus()
        this.shadowRoot.getElementById('p-input').select()

        return new Promise((resolve) => {
            const focusableEls = div.querySelectorAll('button:not(:disabled), input[type="text"]:not(:disabled)')
            const firstFocusableEl = focusableEls[0]
            const lastFocusableEl = focusableEls[focusableEls.length - 1]

            const closeModal = () => {
                document.removeEventListener('click', eventHandler)
                document.removeEventListener('keyup', eventHandler)
                document.removeEventListener('keydown', eventHandler)
                this.shadowRoot.querySelector('#root').removeChild(div)
            }

            const confirm = () => {
                resolve(this.shadowRoot.getElementById('p-input').value)
                closeModal()
            }

            const cancel = () => {
                resolve(null)
                closeModal()
            }

            const eventHandler = e => {
                if(e.type === 'keyup') {
                    if(e.key === 'Enter') {
                        confirm()
                    }

                    if(e.key === 'Escape') {
                        cancel()
                    }

                    return
                }

                // trap focus inside dialog
                if(e.type === 'keydown') {
                    const isTabPressed = e.key === 'Tab'

                    if(!isTabPressed) {
                        return
                    }

                    if(e.shiftKey) {
                        if(this.shadowRoot.activeElement === firstFocusableEl) {
                            lastFocusableEl.focus()
                            e.preventDefault()
                        }
                    } else {
                        if(this.shadowRoot.activeElement === lastFocusableEl) {
                            firstFocusableEl.focus()
                            e.preventDefault()
                        }
                    }

                    return
                }

                const target = e.composedPath()[0]

                if(target.id === 'p-confirm') {
                    confirm()
                }

                if(target.id === 'p-cancel') {
                    cancel()
                }
            }

            document.addEventListener('click', eventHandler)
            document.addEventListener('keyup', eventHandler)
            document.addEventListener('keydown', eventHandler)
        })
    }


    connectedCallback() {
        this.shadowRoot.innerHTML = /* html */ `
            <div id="root"></div>
            <style>
            .dialog-container {
                position: fixed;
                height: 100vh;
                width: 100vw;
                display: grid;
                place-items: start center;
                top: 0;
                left: 0;
                z-index: 9999;
                --border-radius: 3px;
                --primary-color: #1a73e8;
            }

            .dialog {
                background-color: var(--modal-background-color);
                color: var(--modal-text-color);
                padding: 1rem;
                /* box-shadow: 1px 1px 3px 1px lightgrey; */
                box-shadow: 1px 1px 42px -16px black;
                border-radius: 4px;
                border: 1px solid #c6c6c6;
            }

            .dialog *::selection {
                background: #9cc3f5;
            }

            .dialog-primary-button {
                background: var(--primary-color);
                border: 1px solid var(--primary-color);
                padding: 8px 16px;
                color: white;
                border-radius: var(--border-radius);
                width: 75px;
            }

            .dialog-primary-button:hover {
                background: #2f7de3;
            }

            .dialog-secondary-button {
                margin-left: 0.5rem;
                border: 0;
                padding: 8px 16px;
                color: var(--primary-color);
                border-radius: var(--border-radius);
                border: 1px solid lightgrey;
                background: white;
            }

            .dialog-secondary-button:hover {
                background: #ebf3fd;
            }

            .dialog-input {
                padding: 7px;
                width: 25rem;
                border-radius: var(--border-radius);
                border: 1px solid lightgrey;
            }

            .dialog-input:focus, .dialog-primary-button:focus, .dialog-secondary-button:focus {
                outline: 2px solid var(--primary-color);
            }

            .dialog-input:focus, .dialog-primary-button:focus, .dialog-secondary-button:focus {
                border-color: white;
            }
            </style>
        `

        window.createPrompt = this.createPrompt
    }
}

customElements.define('alert-confirm-prompt', AlertConfirmPrompt)
