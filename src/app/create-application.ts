import { AuthService } from '../auth/application/auth-service';
import { HttpAuthGateway } from '../infrastructure/http/http-auth-gateway';
import { toAppError, type AppError } from '../shared/errors';
import { readConfig } from './config';

export interface Application {
  readonly auth: AuthService | null;
  readonly configurationError: AppError | null;
  dispose(): void;
}

export function createApplication(environment: unknown): Application {
  try {
    const config = readConfig(environment);
    const capabilities: { readonly locks?: LockManager } = navigator;
    const gateway = new HttpAuthGateway(
      config.apiBaseUrl,
      {
        getUrl: () => new URL(window.location.href),
        replaceUrl: (path) => window.history.replaceState(null, '', path),
      },
      window.fetch.bind(window),
      capabilities.locks ?? null,
    );
    const auth = new AuthService(gateway);
    return { auth, configurationError: null, dispose: () => auth.dispose() };
  } catch (error) {
    return {
      auth: null,
      configurationError: toAppError(error),
      dispose: () => undefined,
    };
  }
}
