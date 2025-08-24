module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/jest'],
  transform: {}, // pure JS compiled to dist; we run build before jest
  verbose: false,
  collectCoverage: false,
  moduleFileExtensions: ['js','json'],
};
