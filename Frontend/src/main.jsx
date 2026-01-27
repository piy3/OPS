import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SocketProvider } from './context/SocketContext'
import { SoundProvider } from './context/SoundContext'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <SoundProvider>
      <SocketProvider>
        <App />
      </SocketProvider>
    </SoundProvider>
  </BrowserRouter>,
)
