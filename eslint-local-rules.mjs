// eslint-local-rules.mjs
// ESM version of local ESLint rule definitions

export default {
  'no-direct-indexeddb': {
    meta: {
      type: 'problem',
      docs: {
        description: 'Enforce using security wrappers instead of direct IndexedDB access',
        category: 'Security',
        recommended: true
      },
      messages: {
        directGetAll:
          'SECURITY: Use getUserTrips(userId) instead of db.getAll("trips"). Never access IndexedDB directly. See queries.ts',
        directObjectStore:
          'SECURITY: Use security wrappers (getUserTrips, saveUserTrip, etc.) instead of tx.objectStore(). See queries.ts',
        directPut:
          'SECURITY: Use saveUserTrip(trip, userId) instead of store.put(). Never bypass security wrappers. See queries.ts',
        directDelete:
          'SECURITY: Use deleteUserTrip(id, userId) instead of store.delete(). Never bypass security wrappers. See queries.ts',
        directGet:
          'SECURITY: Use getUserTrip(id, userId) instead of store.get(). Never bypass security wrappers. See queries.ts'
      },
      schema: []
    },

    create(context) {
      const filename = context.getFilename();
      const isAllowedFile =
        filename.includes('indexedDB.ts') ||
        filename.includes('queries.ts') ||
        filename.includes('.test.') ||
        filename.includes('.spec.');

      if (isAllowedFile) {
        return {};
      }

      return {
        CallExpression(node) {
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'getAll' &&
            node.arguments.length > 0 &&
            node.arguments[0].type === 'Literal'
          ) {
            const tableName = node.arguments[0].value;
            if (['trips', 'expenses', 'mileage', 'trash'].includes(tableName)) {
              context.report({ node, messageId: 'directGetAll' });
            }
          }

          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'objectStore' &&
            node.arguments.length > 0 &&
            node.arguments[0].type === 'Literal'
          ) {
            const tableName = node.arguments[0].value;
            if (['trips', 'expenses', 'mileage', 'trash'].includes(tableName)) {
              context.report({ node, messageId: 'directObjectStore' });
            }
          }

          if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'put') {
            const code = context.getSourceCode().getText(node.callee.object);
            if (
              code.includes('objectStore') &&
              (code.includes('trips') || code.includes('expenses') || code.includes('mileage'))
            ) {
              context.report({ node, messageId: 'directPut' });
            }
          }

          if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'delete') {
            const code = context.getSourceCode().getText(node.callee.object);
            if (
              code.includes('objectStore') &&
              (code.includes('trips') || code.includes('expenses') || code.includes('mileage'))
            ) {
              context.report({ node, messageId: 'directDelete' });
            }
          }

          if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'get') {
            const code = context.getSourceCode().getText(node.callee.object);
            if (
              code.includes('objectStore') &&
              (code.includes('trips') || code.includes('expenses') || code.includes('mileage'))
            ) {
              context.report({ node, messageId: 'directGet' });
            }
          }
        }
      };
    }
  }
};
