import { SignInPage, type IdentityProviders } from '@backstage/core-components';
import { githubAuthApiRef } from '@backstage/core-plugin-api';
import type { SignInPageProps } from '@backstage/plugin-app-react';

/**
 * Sign-in providers presented on the sign-in page.
 *
 * GitHub is offered as a selectable OAuth option (wired to `githubAuthApiRef`),
 * and guest is retained so local development keeps working without credentials.
 */
const providers: IdentityProviders = [
  'guest',
  {
    id: 'github-auth-provider',
    title: 'GitHub',
    message: 'Sign in using GitHub',
    apiRef: githubAuthApiRef,
  },
];

/**
 * The sign-in page component rendered by the app's sign-in extension. Presents
 * GitHub and guest as selectable providers before authentication.
 */
export function AppSignInPage(props: SignInPageProps) {
  return <SignInPage {...props} providers={providers} />;
}
