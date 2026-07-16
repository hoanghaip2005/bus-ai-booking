import { authenticatedHeaders } from './auth-session';

export interface PassengerProfile {
  id: string;
  label: string;
  fullName: string;
  phone?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PassengerProfileInput {
  label: string;
  fullName: string;
  phone?: string;
}

export class PassengerProfileClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PassengerProfileClientError';
  }
}

export function listPassengerProfiles(): Promise<PassengerProfile[]> {
  return graphql(
    `
      query PassengerProfiles {
        passengerProfiles {
          id
          label
          fullName
          phone
          createdAt
          updatedAt
        }
      }
    `,
    {},
    'passengerProfiles',
  );
}

export function createPassengerProfile(input: PassengerProfileInput): Promise<PassengerProfile> {
  return graphql(
    `
      mutation CreatePassengerProfile($input: PassengerProfileInput!) {
        createPassengerProfile(input: $input) {
          id
          label
          fullName
          phone
          createdAt
          updatedAt
        }
      }
    `,
    { input },
    'createPassengerProfile',
  );
}

export function updatePassengerProfile(
  id: string,
  input: PassengerProfileInput,
): Promise<PassengerProfile> {
  return graphql(
    `
      mutation UpdatePassengerProfile($id: ID!, $input: PassengerProfileInput!) {
        updatePassengerProfile(id: $id, input: $input) {
          id
          label
          fullName
          phone
          createdAt
          updatedAt
        }
      }
    `,
    { id, input },
    'updatePassengerProfile',
  );
}

export function deletePassengerProfile(id: string): Promise<{ id: string; deleted: boolean }> {
  return graphql(
    `
      mutation DeletePassengerProfile($id: ID!) {
        deletePassengerProfile(id: $id) {
          id
          deleted
        }
      }
    `,
    { id },
    'deletePassengerProfile',
  );
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  field: string,
): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: Record<string, T>;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  const data = body.data?.[field];
  if (!response.ok || error || data === undefined) {
    throw new PassengerProfileClientError(
      error?.message ?? 'Không thể cập nhật hành khách thường dùng.',
      error?.extensions?.code,
    );
  }
  return data;
}
