import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
export function hashSecret(secret){const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(secret,salt,32).toString('hex')}`;}
export function verifySecret(secret,stored){if(typeof secret!=='string'||secret.length>256||!stored)return false;const [salt,hex]=stored.split(':');if(!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{64}$/.test(hex||''))return false;return timingSafeEqual(scryptSync(secret,salt,32),Buffer.from(hex,'hex'));}
