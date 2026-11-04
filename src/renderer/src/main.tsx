import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import './styles.css'
import './theme.css'

// Load the bundled outline emoji font before any chat text can use the system color font.
await Promise.all([
  document.fonts.load('400 14px "WeTrace Emoji"', '😀❤️👍'),
  document.fonts.load('400 14px "WeTrace Emoji Sequences"', '1️⃣🇨🇳👩‍💻'),
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{
      token: {
        colorPrimary: '#3979e8', colorInfo: '#3979e8', colorSuccess: '#10b981',
        colorText: '#30343b', colorTextSecondary: '#7b818b', colorBorder: '#e5e7eb',
        borderRadius: 12, controlHeight: 36, fontSize: 13,
        fontFamily: '"WeTrace Emoji", "PingFang SC", -apple-system, BlinkMacSystemFont, sans-serif',
      },
      components: { Button: { primaryShadow: '0 4px 12px #3979e81a' }, Input: { activeShadow: '0 0 0 3px #3979e814' } },
    }}>
      <App />
    </ConfigProvider>
  </StrictMode>,
)
