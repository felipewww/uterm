import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { initTheme } from './design/theme'
import '@xterm/xterm/css/xterm.css'

initTheme()
createApp(App).mount('#app')
