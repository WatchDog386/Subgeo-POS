import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { seedIfEmpty } from './db/seed'
import { seedAdminDocs } from './medapp/data'
import { SessionProvider } from './session'
import { ToastProvider } from './components/ui'
import { initAutoFullscreen } from './lib/fullscreen'

initAutoFullscreen()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

seedIfEmpty()
  .finally(seedAdminDocs)
  .finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <ToastProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ToastProvider>
      </BrowserRouter>
    </StrictMode>,
  )
})
