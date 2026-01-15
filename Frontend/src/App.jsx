import { Routes, Route } from 'react-router-dom'
import HomePage from './components/homepage'
import StartGame from './components/StartGame'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/startgame" element={<StartGame />} />
    </Routes>
  )
}

export default App
