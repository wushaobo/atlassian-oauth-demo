import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  apiFetch,
  clearJwt,
  getJwt,
  getLoginUrl,
  setJwt,
} from '../api'
import type { SpacesResponse, TokenResponse } from '../types'

type OAuthMessage = {
  type?: string
  token?: string
  error?: string
}

type LoadingState = null | 'login' | 'token' | 'refresh' | 'spaces'

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(() => Boolean(getJwt()))
  const [accessToken, setAccessToken] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [siteName, setSiteName] = useState('')
  const [spaces, setSpaces] = useState<string[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('logged_out') === '1' ? 'Logged out.' : ''
  })
  const [loading, setLoading] = useState<LoadingState>(null)
  const [loginTick, setLoginTick] = useState(0)
  const popupRef = useRef<Window | null>(null)

  const resetAuthState = useCallback(() => {
    clearJwt()
    setLoggedIn(false)
    setAccessToken('')
    setExpiresAt('')
    setSiteName('')
    setSpaces([])
  }, [])

  const handleAuthFailure = useCallback(
    (err: unknown): boolean => {
      if (err instanceof ApiError && err.code === 'AUTH_REQUIRED') {
        resetAuthState()
        setError('Session expired. Please log in again.')
        return true
      }
      return false
    },
    [resetAuthState],
  )

  const loadToken = useCallback(async () => {
    setLoading('token')
    setError('')
    try {
      const data = await apiFetch<TokenResponse>('/api/atlassian/token')
      setAccessToken(data.access_token)
      setExpiresAt(data.expires_at)
      setSiteName(data.site_name)
      setLoggedIn(true)
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to fetch the access token.',
        )
      }
    } finally {
      setLoading(null)
    }
  }, [handleAuthFailure])

  useEffect(() => {
    if (getJwt()) {
      // Restoring an existing session intentionally shows a loading state.
      // oxlint-disable-next-line react/set-state-in-effect
      void loadToken()
    }
  }, [loadToken])

  useEffect(() => {
    function onMessage(event: MessageEvent<OAuthMessage>) {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'atlassian-oauth') return

      if (event.data.error) {
        setLoading(null)
        setError(`OAuth login failed: ${event.data.error}`)
        return
      }
      if (!event.data.token) {
        setLoading(null)
        setError('OAuth callback did not return a JWT.')
        return
      }

      setJwt(event.data.token)
      setLoggedIn(true)
      setInfo('Logged in successfully.')
      void loadToken()
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [loadToken])

  useEffect(() => {
    const popup = popupRef.current
    if (!popup) return

    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer)
        popupRef.current = null
        setLoading((current) => (current === 'login' ? null : current))
      }
    }, 500)

    return () => window.clearInterval(timer)
  }, [loginTick])

  function login() {
    setError('')
    setInfo('')
    const popup = window.open(
      getLoginUrl(),
      'atlassian-oauth',
      'popup,width=640,height=760',
    )
    if (!popup) {
      setError(
        'The login popup was blocked. Please allow popups for this site.',
      )
      return
    }

    popupRef.current = popup
    setLoading('login')
    setLoginTick((tick) => tick + 1)
  }

  async function refreshToken() {
    setLoading('refresh')
    setError('')
    setInfo('')
    try {
      const data = await apiFetch<TokenResponse>('/api/atlassian/refresh', {
        method: 'POST',
      })
      setAccessToken(data.access_token)
      setExpiresAt(data.expires_at)
      setSiteName(data.site_name)
      setInfo('Access token refreshed.')
    } catch (err) {
      if (handleAuthFailure(err)) return

      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        resetAuthState()
        setError('Refresh token expired. Please log in again.')
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to refresh the access token.',
        )
      }
    } finally {
      setLoading(null)
    }
  }

  async function loadSpaces() {
    setLoading('spaces')
    setError('')
    setInfo('')
    try {
      const data = await apiFetch<SpacesResponse>('/api/atlassian/spaces')
      setSpaces(data.spaces.map((space) => space.name))
      setInfo(`Fetched ${data.count} space(s).`)
    } catch (err) {
      if (handleAuthFailure(err)) return

      if (err instanceof ApiError && err.code === 'ATLASSIAN_TOKEN_EXPIRED') {
        setError(
          'The Atlassian access token has expired. Click Refresh and try again.',
        )
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to fetch the space list.',
        )
      }
    } finally {
      setLoading(null)
    }
  }

  return (
    <main className="card">
      <header className="header">
        <div>
          <h1>Confluence OAuth Demo</h1>
          <p className="subtitle">
            Atlassian OAuth 2.0 (3LO) + Confluence REST API v2
          </p>
        </div>
        <Link className="logout-link" to="/logout">
          Logout
        </Link>
      </header>

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={login}
          disabled={loading !== null}
        >
          {loading === 'login' ? 'Waiting for login…' : 'OAuth Login'}
        </button>
        {siteName && loggedIn ? (
          <span className="status">Connected: {siteName}</span>
        ) : null}
      </div>

      <section className="field">
        <div className="label-row">
          <label htmlFor="access-token">
            Access Token
            {expiresAt
              ? ` (expires ${new Date(expiresAt).toLocaleString()})`
              : ''}
          </label>
          <button
            type="button"
            onClick={refreshToken}
            disabled={!loggedIn || loading !== null}
          >
            {loading === 'refresh' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <textarea
          id="access-token"
          className="token-box"
          readOnly
          rows={6}
          value={accessToken}
          placeholder="The Atlassian access token will appear here after login"
        />
      </section>

      <section className="field">
        <div className="label-row">
          <label htmlFor="spaces">Spaces</label>
          <button
            type="button"
            onClick={loadSpaces}
            disabled={!loggedIn || loading !== null}
          >
            {loading === 'spaces' ? 'Loading…' : 'Get Spaces'}
          </button>
        </div>
        <textarea
          id="spaces"
          readOnly
          rows={10}
          value={spaces.join('\n')}
          placeholder="Click Get Spaces to load the space titles visible to the current user"
        />
      </section>

      {error ? <p className="message error">{error}</p> : null}
      {!error && info ? <p className="message info">{info}</p> : null}
    </main>
  )
}
