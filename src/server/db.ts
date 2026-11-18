import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * ONE client (one connection pool) per process, in production too (F1.8). Next may evaluate this module more than once in
 * one process (the route bundles, the instrumentation hook); each evaluation without the pin opened its own pool.
 * The pool size is the `connection_limit` of DATABASE_URL (documented in .env.example and the README).
 */
export const db = globalThis.prisma ?? new PrismaClient({ log: ["error"] });

globalThis.prisma = db;

export type DbTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export type DbClient = PrismaClient | DbTx;
