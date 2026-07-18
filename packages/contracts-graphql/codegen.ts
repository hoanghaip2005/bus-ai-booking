import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: './schema.graphql',
  generates: {
    './src/generated.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        avoidOptionals: true,
        enumsAsTypes: true,
        scalars: { Long: 'number' },
        useTypeImports: true,
      },
    },
  },
};

export default config;
