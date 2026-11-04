export interface AuthUser {
  id: string;
  email: string | null;
}

/** Resolves a bearer token to a user, or null if the token is invalid/expired. */
export type AuthVerifier = (token: string) => Promise<AuthUser | null>;

export interface CachedAuthUser {
  user: AuthUser;
  until: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Set by `requireAuth` (middleware/auth.middleware.ts) for every /api request. */
      authUser?: AuthUser;
    }
  }
}
