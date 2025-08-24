import crypto from 'crypto';

export const HASH_ALGO = 'sha256';
export const HASH_ALGO_VERSION = 'v1';
export function hashString(str){ return crypto.createHash(HASH_ALGO).update(str,'utf8').digest('hex'); }
export function hashBuffer(buf){ return crypto.createHash(HASH_ALGO).update(buf).digest('hex'); }
export function algorithmTag(){ return `${HASH_ALGO}:${HASH_ALGO_VERSION}`; }
