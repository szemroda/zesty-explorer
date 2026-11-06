import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Flags `title`, as an attribute or in a spread, on an element whose `title` prop React declares,
// so it reaches the DOM. A native title shows late, unstyled, and never on touch or focus.
const noNativeTitle = {
  meta: {
    type: 'problem',
    messages: {
      native: 'Use TooltipTrigger from ui/tooltip instead of the native title attribute.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    const checker = services.program.getTypeChecker();
    // Every declaration: `ComponentProps<'div'> & { title: ReactNode }` declares its own title.
    const fromReact = (symbol) =>
      symbol?.declarations?.every((declaration) =>
        declaration.getSourceFile().fileName.includes('/@types/react/'),
      ) ?? false;
    const typeOf = (node) => checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
    const acceptsNativeTitle = (opening) =>
      fromReact(
        checker
          .getContextualType(services.esTreeNodeToTSNodeMap.get(opening).attributes)
          ?.getProperty('title'),
      );
    return {
      JSXAttribute(node) {
        if (node.name.name === 'title' && acceptsNativeTitle(node.parent)) {
          context.report({ node, messageId: 'native' });
        }
      },
      JSXSpreadAttribute(node) {
        // Each branch of `cond && { title }` counts. Forwarded props carry React's own optional
        // title, so only a title written in this file is reported.
        const type = typeOf(node.argument);
        const writesTitle = (type.isUnion() ? type.types : [type]).some((branch) => {
          const title = branch.getProperty('title');
          return title && !fromReact(title);
        });
        if (writesTitle && acceptsNativeTitle(node.parent)) {
          context.report({ node, messageId: 'native' });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['dist', 'build', 'playwright-report', 'test-results', 'docs'] },
  eslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2024,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      local: { rules: { 'no-native-title': noNativeTitle } },
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...reactRefresh.configs.vite.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'local/no-native-title': 'error',
    },
  },
  // Security invariants for runtime code: see docs/adr/0007 and docs/adr/0011.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Keep the session token tab-scoped in sessionStorage.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: 'Keep the session token tab-scoped in sessionStorage.',
        },
        {
          object: 'globalThis',
          property: 'localStorage',
          message: 'Keep the session token tab-scoped in sessionStorage.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Content markup must stay inert.',
        },
        {
          selector: "Property[key.name='method'][value.value=/^(POST|PUT|PATCH|DELETE)$/i]",
          message: 'Zesty Explorer sends only GET requests.',
        },
      ],
    },
  },
);
