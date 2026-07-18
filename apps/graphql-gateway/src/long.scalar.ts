import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from 'graphql';

export const longScalar = new GraphQLScalarType({
  name: 'Long',
  description: 'Signed integer transported as a JSON number within JavaScript safe-integer range.',
  serialize: parseSafeInteger,
  parseValue: parseSafeInteger,
  parseLiteral(node: ValueNode) {
    if (node.kind !== Kind.INT) {
      throw new GraphQLError('Long can only represent integer values.');
    }
    return parseSafeInteger(node.value);
  },
});

function parseSafeInteger(value: unknown): number {
  const parsed =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number' || typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new GraphQLError('Long can only represent safe integer values.');
  }
  return parsed;
}
