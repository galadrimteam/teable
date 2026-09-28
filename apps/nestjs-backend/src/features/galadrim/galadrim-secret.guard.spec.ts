import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { GaladrimSecretGuard } from './galadrim-secret.guard';
import { GALADRIM_SECRET_HEADER } from './galadrim.config';

const contextWith = (headers: Record<string, string | string[]>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

describe('GaladrimSecretGuard', () => {
  const guard = new GaladrimSecretGuard();

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lets the right secret through', () => {
    vi.stubEnv('GALADRIM_SECRET', 's3cret');
    expect(guard.canActivate(contextWith({ [GALADRIM_SECRET_HEADER]: 's3cret' }))).toBe(true);
  });

  it.each([
    ['no header', {}],
    ['a wrong secret', { [GALADRIM_SECRET_HEADER]: 'nope' }],
    ['a longer secret', { [GALADRIM_SECRET_HEADER]: 's3cret-and-more' }],
    ['a repeated header', { [GALADRIM_SECRET_HEADER]: ['s3cret', 's3cret'] }],
  ])('refuses %s', (_, headers) => {
    vi.stubEnv('GALADRIM_SECRET', 's3cret');
    expect(() => guard.canActivate(contextWith(headers))).toThrow(UnauthorizedException);
  });

  it('refuses everything while GALADRIM_SECRET is unset', () => {
    vi.stubEnv('GALADRIM_SECRET', '');
    expect(() => guard.canActivate(contextWith({ [GALADRIM_SECRET_HEADER]: '' }))).toThrow(
      UnauthorizedException
    );
  });
});
