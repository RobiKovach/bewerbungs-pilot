/**
 * Desktop OAuth client: Google does not treat its secret as confidential (installed apps).
 * Tests never use these values.
 */
export const GOOGLE_CLIENT = {
  id: '953353525919-nf2jmhpv1ve2s53oqe0l5kbcl68eh848.apps.googleusercontent.com',
  secret: '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',
} as const;

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'] as const;
