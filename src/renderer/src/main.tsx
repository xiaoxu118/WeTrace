import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Load the bundled outline emoji font before any chat text can use the system color font.
await Promise.all([
  document.fonts.load('400 14px "WeTrace Emoji"', '😀❤️👍'),
  document.fonts.load('400 14px "WeTrace Emoji Sequences"', '1️⃣🇨🇳👩‍💻'),
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
