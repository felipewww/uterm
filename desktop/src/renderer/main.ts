import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { initTerminalBackground, initTheme } from './design/theme'
import '@xterm/xterm/css/xterm.css'

initTheme()
initTerminalBackground()
createApp(App).mount('#app')
