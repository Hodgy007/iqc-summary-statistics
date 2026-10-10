module.exports = {
  testEnvironment: 'node',
  globalSetup: './tests/global-setup.js',
  transform: {
    '\\.js$': 'babel-jest',
  },
  transformIgnorePatterns: [],
};
