import { useEffect, useRef, useState } from 'react'
import { apiFetch, clearJwt, setJwt } from '../api'

type ExchangeResponse = {
  token: string
}

const MESSAGE_TYPE = 'atlassian-oauth'

export default function OAuthCallback() {
  const startedRef = useRef(false)
  const [exchangeError, setExchangeError] = useState('')

  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  const errorDescription = params.get('error_description')

  useEffect(() => {
    // authorization codes are single-use; guard against React StrictMode
    // running this effect twice in development.
    if (startedRef.current) return
    startedRef.current = true

    const origin = window.location.origin
    const opener = window.opener as Window | null

    function finish(message: { token?: string; error?: string }) {
      if (opener && !opener.closed) {
        opener.postMessage({ type: MESSAGE_TYPE, ...message }, origin)
        window.close()
        return
      }

      if (message.token) {
        setJwt(message.token)
        window.location.replace('/')
        return
      }

      if (message.error) {
        clearJwt()
        setExchangeError(message.error)
      }
    }

    async function run() {
      if (error) {
        finish({ error: errorDescription || error })
        return
      }
      if (!code || !state) {
        finish({ error: 'OAuth callback is missing code or state.' })
        return
      }

      try {
        const data = await apiFetch<ExchangeResponse>('/api/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        })
        finish({ token: data.token })
      } catch (err) {
        finish({
          error: err instanceof Error ? err.message : 'OAuth exchange failed.',
        })
      }
    }

    void run()
  }, [code, state, error, errorDescription])

  let message = '正在完成登录…'
  if (!window.opener) {
    if (exchangeError) {
      message = `登录失败：${exchangeError}`
    } else if (error) {
      message = `登录失败：${errorDescription || error}`
    } else if (!code || !state) {
      message = 'OAuth 回调缺少 code 或 state。'
    }
  }

  return (
    <main className="card">
      <p className="message info">{message}</p>
    </main>
  )
}
