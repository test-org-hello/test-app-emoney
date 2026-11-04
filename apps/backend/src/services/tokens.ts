import type { Token } from '@circle-wallet/shared';
import type { CircleClient } from '../circle/client.js';
import type { Db } from '../lib/db.js';

/** Token metadata (symbol, decimals) cached in memory and in the `tokens` table. */
export class TokenService {
  private readonly cache = new Map<string, Promise<Token>>();

  constructor(
    private readonly db: Db,
    private readonly circle: CircleClient,
  ) {}

  ensure(tokenId: string): Promise<Token> {
    let p = this.cache.get(tokenId);
    if (!p) {
      p = this.load(tokenId);
      this.cache.set(tokenId, p);
      p.catch(() => this.cache.delete(tokenId));
    }
    return p;
  }

  private async load(tokenId: string): Promise<Token> {
    const existing = await this.db.getToken(tokenId);
    if (existing) return existing;

    const t = await this.circle.getToken(tokenId);
    const token: Token = {
      id: t.id,
      symbol: t.symbol ?? (t.isNative ? 'NATIVE' : 'UNKNOWN'),
      name: t.name ?? null,
      decimals: t.decimals ?? 18,
      tokenAddress: t.tokenAddress || null,
      blockchain: t.blockchain,
    };
    await this.db.upsertToken(token);
    return token;
  }
}
