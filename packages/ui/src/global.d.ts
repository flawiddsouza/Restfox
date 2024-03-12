export {}

declare global {
    interface Window {
        electronIPC: any
    }

    interface ImportMeta {
        env: {
            MODE: string
        }
    }
}
