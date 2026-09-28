// Module and layer boundaries (ADR-0003, ADR-0005, ADR-0088, ADR-0103), checked by `npm run lint:boundaries`.
// Paths are relative to the folder being checked. Test files are exempt: integration tests combine layers
// on purpose. test/boundaries/ has one deliberate violation per rule, to prove each rule catches it.

/** Test files, never subject to the rules. */
const TESTS = '\\.(spec|int-spec|e2e-spec)\\.ts$';
/** NestJS and Prisma, wherever node_modules is. */
const NESTJS = '(^|/)node_modules/@nestjs/';
const NESTJS_COMMON = '(^|/)node_modules/@nestjs/common/';
const PRISMA = [
  '(^|/)node_modules/@prisma/',
  '(^|/)node_modules/prisma/',
  '^src/platform/persistence/prisma/generated/',
];
const CLS = ['(^|/)node_modules/nestjs-cls/', '(^|/)node_modules/@nestjs-cls/'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-depends-only-on-shared-kernel',
      comment:
        'Domain depends only on its own domain folder, the shared kernel and Node built-ins: never NestJS, ' +
        'Prisma, other npm packages, the platform or other layers (ADR-0003, ADR-0088).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/domain/', pathNot: TESTS },
      to: {
        pathNot: ['^src/modules/$1/domain/', '^src/shared-kernel/'],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'application-depends-on-domain-and-shared-kernel',
      comment:
        'Application depends on its own domain and application, the shared kernel and @nestjs/common ' +
        '(for @Injectable): never Prisma, the platform, infrastructure or presentation (ADR-0088).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/application/', pathNot: TESTS },
      to: {
        pathNot: [
          '^src/modules/$1/(domain|application)/',
          '^src/shared-kernel/',
          NESTJS_COMMON,
        ],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'infrastructure-not-presentation',
      comment: 'Infrastructure never depends on presentation (ADR-0088).',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/infrastructure/', pathNot: TESTS },
      to: { path: '^src/modules/[^/]+/presentation/' },
    },
    {
      name: 'presentation-not-domain-or-infrastructure',
      comment:
        'Presentation reaches the domain only through application, and never infrastructure (ADR-0088).',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/presentation/', pathNot: TESTS },
      to: { path: '^src/modules/[^/]+/(domain|infrastructure)/' },
    },
    {
      name: 'modules-only-through-public-api',
      comment:
        'A module imports another only through its index.ts, which exports the Nest module, the facade ' +
        'and public types (ADR-0005, ADR-0088).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/', pathNot: TESTS },
      to: {
        path: '^src/modules/(?!$1/)[^/]+/',
        pathNot: '^src/modules/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'prisma-only-in-infrastructure',
      comment:
        'Prisma and its generated client are used only by technical code: the platform and the ' +
        'infrastructure layers of the modules (ADR-0003, ADR-0103).',
      severity: 'error',
      from: {
        pathNot: [
          '^src/platform/',
          '^src/modules/[^/]+/infrastructure/',
          TESTS,
        ],
      },
      to: { path: PRISMA },
    },
    {
      name: 'shared-kernel-stays-pure',
      comment:
        'The shared kernel is plain TypeScript: no NestJS, Prisma, nestjs-cls, platform or modules ' +
        '(ADR-0088, ADR-0094).',
      severity: 'error',
      from: { path: '^src/shared-kernel/', pathNot: TESTS },
      to: { path: ['^src/(?!shared-kernel/)', NESTJS, ...PRISMA, ...CLS] },
    },
    {
      name: 'platform-not-modules',
      comment:
        'The platform is technical and has no business rules: it never depends on the modules (ADR-0088).',
      severity: 'error',
      from: { path: '^src/platform/', pathNot: TESTS },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      comment:
        'Circular dependencies make modules impossible to separate or test on their own.',
      severity: 'error',
      from: { pathNot: TESTS },
      to: { circular: true },
    },
  ],
  options: {
    // The generated Prisma client appears as a node, but its own imports are not followed.
    doNotFollow: {
      path: ['node_modules', '^src/platform/persistence/prisma/generated/'],
    },
    tsConfig: { fileName: 'tsconfig.json' },
    // Type-only imports are dependencies too.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
