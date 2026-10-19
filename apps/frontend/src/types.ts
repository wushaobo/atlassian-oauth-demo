export interface TokenResponse {
  access_token: string
  expires_at: string
  site_name: string
  site_url: string
}

export interface Space {
  id: string
  key: string
  name: string
}

export interface SpacesResponse {
  spaces: Space[]
  count: number
}
