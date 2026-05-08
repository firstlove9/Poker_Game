import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { useSocketStore, loadSavedRoom, clearSavedRoom } from './stores/socketStore'
import ToastContainer from './components/ToastContainer'
import HomePage from './pages/HomePage'
import LobbyPage from './pages/LobbyPage'
import RoomPage from './pages/RoomPage'
import GamePage from './pages/GamePage'
import SinglePlayerPage from './pages/SinglePlayerPage'

function App() {
  const { connect, disconnect, isConnected } = useSocketStore()
  const navigate = useNavigate()
  const location = useLocation()
  const prevConnected = useRef(false)

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  useEffect(() => {
    if (!isConnected) {
      prevConnected.current = false
      return
    }
    if (prevConnected.current) return
    prevConnected.current = true

    const isInRoom = location.pathname.startsWith('/room/') || location.pathname.startsWith('/game/')
    if (isInRoom) return

    const saved = loadSavedRoom()
    if (!saved) return

    fetch(`/api/rooms/${saved.roomId}`)
      .then(res => {
        if (!res.ok) {
          clearSavedRoom()
          return null
        }
        return res.json()
      })
      .then(data => {
        if (!data?.success) {
          clearSavedRoom()
          return
        }
        const targetPath = saved.status === 'playing'
          ? `/game/${saved.roomId}`
          : `/room/${saved.roomId}`
        navigate(targetPath, { replace: true })
      })
      .catch(() => {
        clearSavedRoom()
      })
  }, [isConnected])

  return (
    <div className="min-h-screen bg-poker-green-dark">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/game/:roomId" element={<GamePage />} />
        <Route path="/single-player" element={<SinglePlayerPage />} />
      </Routes>
      <ToastContainer />
    </div>
  )
}

export default App
