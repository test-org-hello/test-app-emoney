import type { Config } from '../config.types.js';

export type UserServiceConfig = Pick<Config, 'CIRCLE_BLOCKCHAIN' | 'CIRCLE_ACCOUNT_TYPE' | 'CIRCLE_WALLET_SET_ID'>;
