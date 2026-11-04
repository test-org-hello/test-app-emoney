import { z } from 'zod';
import type { TransactionCursor } from './cursor.types.js';
import { badRequest } from './errors.js';

const cursorSchema = z.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() });

/** Opaque to clients: base64url of the JSON position, so the format can change freely. */
export function encodeCursor(c: TransactionCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string): TransactionCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw badRequest('Invalid cursor');
  }
}
