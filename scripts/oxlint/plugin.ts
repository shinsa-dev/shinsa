import { cognitiveComplexity } from './rules/cognitive-complexity.ts';
import { noAccumulatingSpread } from './rules/no-accumulating-spread.ts';
import { noArrayIndexKey } from './rules/no-array-index-key.ts';
import { noAssignInExpressions } from './rules/no-assign-in-expressions.ts';
import { noAwaitInTernary } from './rules/no-await-in-ternary.ts';
import { noConfusingVoidType } from './rules/no-confusing-void-type.ts';
import { noDynamicNamespaceImportAccess } from './rules/no-dynamic-namespace-import-access.ts';
import { noEvolvingTypes } from './rules/no-evolving-types.ts';
import { noForEach } from './rules/no-for-each.ts';
import { noInvalidBuiltinInstantiation } from './rules/no-invalid-builtin-instantiation.ts';
import { noRedeclare } from './rules/no-redeclare.ts';
import { noRedundantUseStrict } from './rules/no-redundant-use-strict.ts';
import { noStringCaseMismatch } from './rules/no-string-case-mismatch.ts';
import { noSuspiciousSemicolonInJsx } from './rules/no-suspicious-semicolon-in-jsx.ts';
import { noThisInStatic } from './rules/no-this-in-static.ts';
import { noUselessContinue } from './rules/no-useless-continue.ts';
import { noUselessElse } from './rules/no-useless-else.ts';
import { noUselessStringRaw } from './rules/no-useless-string-raw.ts';
import { noUselessUndefinedInitialization } from './rules/no-useless-undefined-initialization.ts';
import { noVoidTypeReturn } from './rules/no-void-type-return.ts';
import { useArrowFunction } from './rules/use-arrow-function.ts';
import { useAwait } from './rules/use-await.ts';
import { useOptionalChain } from './rules/use-optional-chain.ts';
import { useSemanticElements } from './rules/use-semantic-elements.ts';
import { useSimpleNumberKeys } from './rules/use-simple-number-keys.ts';
import { useTemplate } from './rules/use-template.ts';

export const SHINSA_RULES = {
  'cognitive-complexity': cognitiveComplexity,
  'no-accumulating-spread': noAccumulatingSpread,
  'no-array-index-key': noArrayIndexKey,
  'no-assign-in-expressions': noAssignInExpressions,
  'no-await-in-ternary': noAwaitInTernary,
  'no-confusing-void-type': noConfusingVoidType,
  'no-dynamic-namespace-import-access': noDynamicNamespaceImportAccess,
  'no-evolving-types': noEvolvingTypes,
  'no-for-each': noForEach,
  'no-invalid-builtin-instantiation': noInvalidBuiltinInstantiation,
  'no-redeclare': noRedeclare,
  'no-redundant-use-strict': noRedundantUseStrict,
  'no-string-case-mismatch': noStringCaseMismatch,
  'no-suspicious-semicolon-in-jsx': noSuspiciousSemicolonInJsx,
  'no-this-in-static': noThisInStatic,
  'no-useless-continue': noUselessContinue,
  'no-useless-else': noUselessElse,
  'no-useless-string-raw': noUselessStringRaw,
  'no-useless-undefined-initialization': noUselessUndefinedInitialization,
  'no-void-type-return': noVoidTypeReturn,
  'use-arrow-function': useArrowFunction,
  'use-await': useAwait,
  'use-optional-chain': useOptionalChain,
  'use-semantic-elements': useSemanticElements,
  'use-simple-number-keys': useSimpleNumberKeys,
  'use-template': useTemplate,
};

export default { meta: { name: 'shinsa' }, rules: SHINSA_RULES };
