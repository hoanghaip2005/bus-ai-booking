export const identityRoles = ['CUSTOMER', 'STAFF', 'ADMIN'] as const;
export type IdentityRole = (typeof identityRoles)[number];

export interface IdentityUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: IdentityRole;
  active: boolean;
}

export interface PublicIdentityUser {
  id: string;
  email: string;
  displayName: string;
  role: IdentityRole;
}

export interface RefreshCredential {
  id: string;
  familyId: string;
  token: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuthSessionView {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  user: PublicIdentityUser;
}

export interface AuthenticatedActor extends PublicIdentityUser {
  tokenId: string;
  expiresAt: string;
}

export interface PassengerProfile {
  id: string;
  label: string;
  fullName: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PassengerProfileInput {
  label: string;
  fullName: string;
  phone?: string;
}
