import type { RequestHandler, Response } from "express";
import { env } from "../config/env";
import { authService } from "../services/auth.service";
import { authCookieOptions } from "../utils/cookies";
import { durationToMs } from "../utils/crypto";
import { sendJson } from "../utils/response";

const cookieOptions = () => authCookieOptions(env.COOKIE_SAMESITE, env.isProduction);

function setAuthCookie(res: Response, token: string): void {
  res.cookie(env.AUTH_COOKIE_NAME, token, { ...cookieOptions(), maxAge: durationToMs(env.JWT_EXPIRES_IN) });
}

export const authController = {
  register: (async (req, res) => {
    const { user, token } = await authService.register(req.body.email, req.body.password);
    setAuthCookie(res, token);
    sendJson(res, user, 201);
  }) as RequestHandler,

  login: (async (req, res) => {
    const { user, token } = await authService.login(req.body.email, req.body.password);
    setAuthCookie(res, token);
    sendJson(res, user);
  }) as RequestHandler,

  logout: ((_req, res) => {
    res.clearCookie(env.AUTH_COOKIE_NAME, cookieOptions());
    res.status(204).end();
  }) as RequestHandler,

  me: (async (req, res) => {
    sendJson(res, await authService.getCurrentUser(req.user!.id));
  }) as RequestHandler,
};
