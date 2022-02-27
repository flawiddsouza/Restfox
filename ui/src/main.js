import { createApp } from 'vue'
import store from './store'
import App from './App.vue'
import VueToast from 'vue-toast-notification'
import 'vue-toast-notification/dist/theme-default.css'

const app = createApp(App)

app.use(store)
app.use(VueToast)

app.mount('#app')
