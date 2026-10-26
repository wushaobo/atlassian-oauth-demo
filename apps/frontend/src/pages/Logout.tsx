import { useEffect } from 'react'
import { apiFetch, clearJwt } from '../api'

export default function Logout() {
  useEffect(() => {
    let cancelled = false

    async function logout() {
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' })
      } catch {
        // Local state must be cleared even if the server call fails.
      } finally {
        clearJwt()
        if (!cancelled) {
          window.location.replace('/?logged_out=1')
        }
      }
    }

    void logout()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="card">
      <p className="message info">Logging out…</p>
    </main>
  )
}
