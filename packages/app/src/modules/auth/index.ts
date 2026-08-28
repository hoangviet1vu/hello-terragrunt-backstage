import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { SignInPageBlueprint } from '@backstage/plugin-app-react';

const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => {
      const { AppSignInPage } = await import('./SignInPage');
      return AppSignInPage;
    },
  },
});

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [signInPage],
});
