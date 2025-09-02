// Jest config lives in config/, so default <rootDir> would incorrectly resolve here.
// Force rootDir to repository root so '<rootDir>/tests/jest' resolves properly.
// (Earlier CI failure showed it was searching for config/tests/jest which does not exist.)
const path = require('path');
module.exports = {
  rootDir: path.join(__dirname, '..'),
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/jest'],
  transform: {}, // pure JS compiled to dist; we run build before jest
  verbose: false,
  collectCoverage: false,
  moduleFileExtensions: ['js','json'],
};
