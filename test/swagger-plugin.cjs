// Runs the @nestjs/swagger compiler plugin inside ts-jest, like `nest build` does with the options of
// nest-cli.json, so the OpenAPI document of the tests matches the real one (ADR-0096).
const plugin = require('@nestjs/swagger/plugin');

module.exports.name = 'nestjs-swagger-plugin';
module.exports.version = 1;
module.exports.factory = (compiler) =>
  plugin.before(
    { classValidatorShim: true, introspectComments: true },
    compiler.program,
  );
