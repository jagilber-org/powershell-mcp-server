// CommonJS compatibility wrapper for Jest tests (which run without ESM support)
import { classifyCommandSafety } from '../security/classification.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
module.exports = { classifyCommandSafety };