import type { PrismaService } from '@teable/db-main-prisma';
import type { NextFunction, Request, Response } from 'express';
import type { SessionHandleService } from '../auth/session/session-handle.service';
import { GaladrimUiGateMiddleware } from './galadrim-ui-gate.middleware';

const outlineUrl = 'https://outline.example.com';
const member = { isAdmin: false, email: 'pm@galadrim.fr' };

const setup = (user: { isAdmin: boolean | null; email: string } | null, userId = 'usrA') => {
  const sessionHandleService = {
    getSessionIdFromRequest: vi.fn(async (req: Request) => {
      Object.assign(req, { session: userId ? { passport: { user: { id: userId } } } : {} });
      return 'sid';
    }),
  } as unknown as SessionHandleService;
  const findUnique = vi.fn(async () => user);
  const prismaService = { user: { findUnique } } as unknown as PrismaService;
  return {
    middleware: new GaladrimUiGateMiddleware(sessionHandleService, prismaService),
    findUnique,
  };
};

const run = async (
  middleware: GaladrimUiGateMiddleware,
  path: string,
  cookie = 'auth_session=abc'
) => {
  const req = { method: 'GET', path, headers: { cookie } } as unknown as Request;
  const redirect = vi.fn();
  const next = vi.fn() as NextFunction;
  await middleware.use(req, { redirect } as unknown as Response, next);
  return { redirect, next };
};

describe('GaladrimUiGateMiddleware', () => {
  beforeEach(() => {
    vi.stubEnv('GALADRIM_OUTLINE_URL', outlineUrl);
    vi.stubEnv('GALADRIM_TEABLE_ADMINS', 'Arnaud@Galadrim.fr, other@galadrim.fr');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends people who are not admins to Outline from Teable pages', async () => {
    const { middleware } = setup(member);
    const { redirect, next } = await run(middleware, '/base/bse1/tbl1');
    expect(redirect).toHaveBeenCalledWith(302, outlineUrl);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['an instance admin', { isAdmin: true, email: 'admin@galadrim.fr' }],
    ['a listed e-mail', { isAdmin: false, email: 'arnaud@galadrim.fr' }],
  ])('lets %s in', async (_, user) => {
    const { middleware } = setup(user);
    const { redirect, next } = await run(middleware, '/space/spc1');
    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it.each([
    '/auth/login',
    '/share/shr1/view',
    '/_next/static/x.js',
    '/invite/abc',
    '/api/table/tbl1/record',
  ])('leaves %s open', async (path) => {
    const { middleware, findUnique } = setup(member);
    const { redirect, next } = await run(middleware, path);
    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('lets visitors without a session reach the sign-in', async () => {
    const { middleware } = setup(member);
    const { redirect, next } = await run(middleware, '/home', '');
    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('does nothing while GALADRIM_OUTLINE_URL is unset', async () => {
    vi.stubEnv('GALADRIM_OUTLINE_URL', '');
    const { middleware } = setup(member);
    const { redirect, next } = await run(middleware, '/base/bse1');
    expect(redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
