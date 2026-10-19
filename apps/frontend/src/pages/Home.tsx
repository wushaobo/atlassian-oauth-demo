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
    return params.get('logged_out') === '1' ? '已退出登录。' : ''
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
        setError('会话已失效，请重新登录。')
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
        setError(err instanceof Error ? err.message : '获取 access token 失败。')
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
        setError(`OAuth 登录失败：${event.data.error}`)
        return
      }
      if (!event.data.token) {
        setLoading(null)
        setError('OAuth 回调没有返回 JWT。')
        return
      }

      setJwt(event.data.token)
      setLoggedIn(true)
      setInfo('登录成功。')
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
      setError('登录弹窗被浏览器拦截，请允许本站弹出窗口。')
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
      setInfo('Access token 已刷新。')
    } catch (err) {
      if (handleAuthFailure(err)) return

      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        resetAuthState()
        setError('Refresh token 已失效，请重新登录。')
      } else {
        setError(
          err instanceof Error ? err.message : '刷新 access token 失败。',
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
      setInfo(`获取到 ${data.count} 个 space。`)
    } catch (err) {
      if (handleAuthFailure(err)) return

      if (err instanceof ApiError && err.code === 'ATLASSIAN_TOKEN_EXPIRED') {
        setError('Atlassian access token 已过期，请点击 Refresh 后再试。')
      } else {
        setError(err instanceof Error ? err.message : '获取 space 列表失败。')
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
          placeholder="登录成功后在这里显示 Atlassian access token"
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
          placeholder="点击 Get Spaces 获取当前用户可见的 space 标题列表"
        />
      </section>

      {error ? <p className="message error">{error}</p> : null}
      {!error && info ? <p className="message info">{info}</p> : null}
    </main>
  )
}
