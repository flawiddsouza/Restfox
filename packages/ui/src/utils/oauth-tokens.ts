import type { RequestAuthentication } from '@/global'

// What a Get Token or Refresh Token reply brought. A refreshToken of null is one the reply did not bring, which is
// removed, left out it stays as it is
export interface OAuthTokens {
    token: string
    refreshToken?: string | null
}

// The same merge as a file workspace's in electron/shared/db.js
export function setOAuthTokens(authentication: RequestAuthentication, tokens: OAuthTokens) {
    authentication.token = tokens.token
    if(tokens.refreshToken === null) {
        delete authentication.refreshToken
    } else if(tokens.refreshToken !== undefined) {
        authentication.refreshToken = tokens.refreshToken
    }
}
