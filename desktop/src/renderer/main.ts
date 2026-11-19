import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { initTerminalBackground, initTheme } from './design/theme'
import '@xterm/xterm/css/xterm.css'
import '@fontsource/victor-mono/latin-600-italic.css' // wordmark only (OFL license)

initTheme()
initTerminalBackground()
createApp(App).mount('#app')
