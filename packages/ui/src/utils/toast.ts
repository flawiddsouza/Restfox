import { useToast as useToastShowingHtml, type ActiveToast, type ToastPluginApi, type ToastPropsWithMessage } from 'vue-toast-notification'
import { escapeHtml } from '@/utils/escape-html'

// vue-toast-notification shows a message as HTML, and messages quote names, errors and server replies, so each shows as
// typed. Every toast, success and error included, goes through open
export function useToast(): ToastPluginApi {
    const toast = useToastShowingHtml()
    const open = toast.open.bind(toast) as (options: string | ToastPropsWithMessage) => ActiveToast
    toast.open = ((options: string | ToastPropsWithMessage) => {
        if(typeof options === 'object' && options !== null) {
            return open({ ...options, message: options.message == null ? options.message : escapeHtml(options.message) })
        }
        return open(options == null ? options : escapeHtml(options))
    }) as ToastPluginApi['open']
    return toast
}
