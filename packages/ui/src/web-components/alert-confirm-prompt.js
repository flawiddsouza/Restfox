// Chrome alert, confirm and prompt replacements
class AlertConfirmPrompt extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
    }

    createDialog = (type, title, defaultValue = '', selectList = []) => {
        const div = document.createElement('div')

        let inputHtml = ''
        if (type === 'prompt') {
            inputHtml = `
            <div style="margin-top: 0.5rem;">
                <input type="text" value="${defaultValue ?? ''}" list="selectList" class="dialog-input" id="dialog-input" spellcheck="false">
                <datalist id="selectList">
                    ${selectList.map(item => `<option value="${item}"></option>`).join('')}
                </datalist>
            </div>
            `
        }

        div.innerHTML = `
        <div class="dialog-container">
            <div class="dialog dialog-${type}">
                <div>${title}</div>
                ${inputHtml}
                <div style="margin-top: 1rem; text-align: right; user-select: none;">
                    <button class="dialog-primary-button" id="dialog-confirm">OK</button>
                    ${type !== 'alert' ? '<button class="dialog-secondary-button" id="dialog-cancel">Cancel</button>' : ''}
                </div>
            </div>
        </div>
        `

        this.shadowRoot.querySelector('#root').appendChild(div)

        if (type === 'prompt') {
            this.shadowRoot.getElementById('dialog-input').focus()
            this.shadowRoot.getElementById('dialog-input').select()
        } else {
            this.shadowRoot.getElementById('dialog-confirm').focus()
        }

        return new Promise((resolve) => {
            const closeModal = () => {
                document.removeEventListener('click', eventHandler)
                document.removeEventListener('keyup', eventHandler)
                document.removeEventListener('keydown', eventHandler)
                this.shadowRoot.querySelector('#root').removeChild(div)
            }

            const confirm = () => {
                if (type === 'prompt') {
                    resolve(this.shadowRoot.getElementById('dialog-input').value)
                } else {
                    resolve(true)
                }
                closeModal()
            }

            const cancel = () => {
                resolve(type === 'prompt' ? null : false)
                closeModal()
            }

            const eventHandler = e => {
                if (e.type === 'keyup') {
                    if (e.key === 'Enter') {
                        confirm()
                    }

                    if (e.key === 'Escape') {
                        cancel()
                    }

                    return
                }

                // Trap focus inside dialog
                if (e.type === 'keydown') {
                    const focusableEls = div.querySelectorAll('button:not(:disabled), input[type="text"]:not(:disabled)')
                    const firstFocusableEl = focusableEls[0]
                    const lastFocusableEl = focusableEls[focusableEls.length - 1]

                    const isTabPressed = e.key === 'Tab'
                    if (!isTabPressed) {
                        return
                    }

                    if (e.shiftKey) {
                        if (this.shadowRoot.activeElement === firstFocusableEl) {
                            lastFocusableEl.focus()
                            e.preventDefault()
                        }
                    } else {
                        if (this.shadowRoot.activeElement === lastFocusableEl) {
                            firstFocusableEl.focus()
                            e.preventDefault()
                        }
                    }
                    return
                }

                const target = e.composedPath()[0]

                if (target.id === 'dialog-confirm') {
                    confirm()
                }

                if (target.id === 'dialog-cancel') {
                    cancel()
                }
            }

            document.addEventListener('click', eventHandler)
            document.addEventListener('keyup', eventHandler)
            document.addEventListener('keydown', eventHandler)
        })
    }

    createPrompt = (title, defaultValue = '', selectList = []) => {
        return this.createDialog('prompt', title, defaultValue, selectList)
    }

    createConfirm = (title) => {
        return this.createDialog('confirm', title)
    }

    createAlert = (message) => {
        return this.createDialog('alert', message)
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
            place-items: center;
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
            box-shadow: 1px 1px 42px -16px black;
            border-radius: 4px;
            border: 1px solid #c6c6c6;
        }

        .dialog-confirm, .dialog-alert {
            width: 20rem;
            padding: 1.5rem;
        }

        .dialog *::selection {
            background: #9cc3f5;
        }

        .dialog-primary-button, .dialog-secondary-button {
            padding: 8px 16px;
            border-radius: var(--border-radius);
            border: 1px solid lightgrey;
        }

        .dialog-primary-button {
            background: var(--primary-color);
            border-color: var(--primary-color);
            color: white;
            width: 75px;
        }

        .dialog-primary-button:hover {
            background: #2f7de3;
        }

        .dialog-secondary-button {
            margin-left: 0.5rem;
            color: var(--primary-color);
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
            caret-color: var(--modal-caret-color);
        }

        .dialog-input:focus, .dialog-primary-button:focus, .dialog-secondary-button:focus {
            outline: 2px solid var(--primary-color);
            border-color: white;
        }
        </style>
        `

        window.createPrompt = this.createPrompt
        window.createConfirm = this.createConfirm
        window.createAlert = this.createAlert
    }
}

customElements.define('alert-confirm-prompt', AlertConfirmPrompt)
