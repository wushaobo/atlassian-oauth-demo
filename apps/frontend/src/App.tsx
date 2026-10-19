import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Logout from './pages/Logout'
import OAuthCallback from './pages/OAuthCallback'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/oauth2/callback" element={<OAuthCallback />} />
        <Route path="/logout" element={<Logout />} />
      </Routes>
    </BrowserRouter>
  )
}
