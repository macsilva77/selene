export const BCRYPT_SALT_ROUNDS = 12;

export const COOKIE_NAMES = {
  ACCESS: 'selene_token',
  REFRESH: 'refresh_token',
} as const;

/** Validade do cookie de access token (8 h) */
export const ACCESS_COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/** Validade do cookie de refresh token (7 d) */
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** TTL do token de redefinição de senha enviado por e-mail (24 h) */
export const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** TTL do cache em memória de certificados PEM descriptografados (10 min) */
export const CERT_CACHE_TTL_MS = 10 * 60 * 1000;
