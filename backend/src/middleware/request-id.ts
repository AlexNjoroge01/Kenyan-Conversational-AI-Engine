import type { RequestHandler } from "express";
import { REQUEST_ID_HEADER } from "../config/constants";
import { generateRequestId } from "../utils/crypto";

/** Assigns every request a unique ID and returns it in X-Request-ID. Client-supplied IDs are ignored. */
export const requestId: RequestHandler = (req, res, next) => {
  req.id = generateRequestId();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
};
