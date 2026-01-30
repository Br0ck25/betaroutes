// eslint-local-rules.js
//
// Custom ESLint rules for project-specific security patterns
// Per SECURITY.md: "ALL IndexedDB access MUST use security wrappers from $lib/db/queries.ts"

module.exports = {
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
      // Track if we're in a file that's allowed to use raw IndexedDB
      const filename = context.getFilename();
      const isAllowedFile =
        filename.includes('indexedDB.ts') || // The DB setup file itself
        filename.includes('queries.ts') || // The security wrapper file itself
        filename.includes('.test.') || // Test files
        filename.includes('.spec.'); // Test files

      // If in allowed file, don't check
      if (isAllowedFile) {
        return {};
      }

      return {
        // Catch: db.getAll('trips') or db.getAll('expenses') or db.getAll('mileage')
        CallExpression(node) {
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'getAll' &&
            node.arguments.length > 0 &&
            node.arguments[0].type === 'Literal'
          ) {
            const tableName = node.arguments[0].value;
            if (['trips', 'expenses', 'mileage', 'trash'].includes(tableName)) {
              context.report({
                node,
                messageId: 'directGetAll'
              });
            }
          }

          // Catch: tx.objectStore('trips') or store.objectStore('trips')
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'objectStore' &&
            node.arguments.length > 0 &&
            node.arguments[0].type === 'Literal'
          ) {
            const tableName = node.arguments[0].value;
            if (['trips', 'expenses', 'mileage', 'trash'].includes(tableName)) {
              context.report({
                node,
                messageId: 'directObjectStore'
              });
            }
          }

          // Catch: store.put(trip) on trips/expenses/mileage stores
          if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'put') {
            // Check if the object is from trips/expenses/mileage objectStore
            // This is approximate - we're looking for patterns like:
            // tx.objectStore('trips').put(...)
            // We already caught the objectStore part above, but this catches
            // any .put() that might slip through
            const code = context.getSourceCode().getText(node.callee.object);
            if (
              code.includes('objectStore') &&
              (code.includes('trips') || code.includes('expenses') || code.includes('mileage'))
            ) {
              context.report({
                node,
                messageId: 'directPut'
              });
            }
          }

          // Catch: store.delete(id)
          if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'delete') {
            const code = context.getSourceCode().getText(node.callee.object);
            if (
              code.includes('objectStore') &&
              (code.includes('trips') || code.includes('expenses') || code.includes('mileage'))
            ) {
              context.report({
                node,
                messageId: 'directDelete'
              });
            }
          }

          // Catch: store.get(id)
          if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'get') {
            const code = context.getSourceCode().getText(node.callee.object);
            if (
              code.includes('objectStore') &&
              (code.includes('trips') || code.includes('expenses') || code.includes('mileage'))
            ) {
              context.report({
                node,
                messageId: 'directGet'
              });
            }
          }
        }
      };
    }
  }
};
