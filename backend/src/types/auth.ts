export interface AuthUser {
  id: string;
  email: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface ApiKeyPrincipal {
  id: string;
  userId: string;
}
