import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { userRepository } from "../repositories/user.repository";
import type { AuthUser, JwtPayload } from "../types/auth";
import { hashPassword, verifyDummyPassword, verifyPassword } from "../utils/crypto";
import { AppError, unauthorized } from "../utils/errors";

function toAuthUser(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email };
}

export const authService = {
  async register(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const passwordHash = await hashPassword(password);
    const user = await userRepository.create({ email, passwordHash });
    if (!user) throw new AppError("EMAIL_ALREADY_EXISTS", "An account with this email already exists.", 409);
    return { user: toAuthUser(user), token: this.signToken(user) };
  },

  async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      await verifyDummyPassword(password);
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
    }
    return { user: toAuthUser(user), token: this.signToken(user) };
  },

  async getCurrentUser(userId: string): Promise<AuthUser> {
    const user = await userRepository.findById(userId);
    if (!user) throw unauthorized();
    return toAuthUser(user);
  },

  signToken(user: { id: string; email: string }): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return jwt.sign(payload, env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });
  },

  verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
      if (typeof decoded === "string" || typeof decoded.sub !== "string") throw new Error("bad payload");
      return { sub: decoded.sub, email: String(decoded.email ?? "") };
    } catch {
      throw unauthorized("Invalid or expired session.");
    }
  },
};
