// Jest config lives in config/ so <rootDir> would otherwise resolve here.
// Explicitly set rootDir to repository root so tests path '<rootDir>/tests/jest' is valid.
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
