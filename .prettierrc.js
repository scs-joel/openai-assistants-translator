/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  singleQuote: true,
  jsxSingleQuote: true,
  endOfLine: 'auto',
  tailwindStylesheet: './src/styles/index.css',
  tailwindFunctions: ['cn'],
  plugins: ['prettier-plugin-tailwindcss'],
};
module.exports = config;
