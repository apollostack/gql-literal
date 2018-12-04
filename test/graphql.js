const gqlRequire = require('../src');
const gqlDefault = require('../src').default;
const loader = require('../loader');
const assert = require('chai').assert;

[gqlRequire, gqlDefault].forEach((gql, i) => {
  describe(`gql ${i}`, () => {
    it('parses queries', () => {
      assert.equal(gql`{ testQuery }`.kind, 'Document');
    });

    it('parses queries when called as a function', () => {
      assert.equal(gql('{ testQuery }').kind, 'Document');
    });

    it('parses queries with weird substitutions', () => {
      const obj = {};
      assert.equal(gql`{ field(input: "${obj.missing}") }`.kind, 'Document');
      assert.equal(gql`{ field(input: "${null}") }`.kind, 'Document');
      assert.equal(gql`{ field(input: "${0}") }`.kind, 'Document');
    });

    it('allows interpolation of documents generated by the webpack loader', () => {
      const sameFragment = "fragment SomeFragmentName on SomeType { someField }";

      const jsSource = loader.call(
        { cacheable() {} },
        "fragment SomeFragmentName on SomeType { someField }"
      );
      const module = { exports: undefined };
      eval(jsSource);

      const document = gql`query { ...SomeFragmentName } ${module.exports}`;
      assert.equal(document.kind, 'Document');
      assert.equal(document.definitions.length, 2);
      assert.equal(document.definitions[0].kind, 'OperationDefinition');
      assert.equal(document.definitions[1].kind, 'FragmentDefinition');
    });

    it('parses queries through webpack loader', () => {
      const jsSource = loader.call({ cacheable() {} }, '{ testQuery }');
      const module = { exports: undefined };
      eval(jsSource);
      assert.equal(module.exports.kind, 'Document');
    });

    it('parses single query through webpack loader', () => {
      const jsSource = loader.call({ cacheable() {} }, `
        query Q1 { testQuery }
      `);
      const module = { exports: undefined };
      eval(jsSource);

      assert.equal(module.exports.kind, 'Document');
      assert.exists(module.exports.Q1);
      assert.equal(module.exports.Q1.kind, 'Document');
      assert.equal(module.exports.Q1.definitions.length, 1);
    });

    it('parses single query and exports as default', () => {
      const jsSource = loader.call({ cacheable() {} }, `
        query Q1 { testQuery }
      `);
      const module = { exports: undefined };
      eval(jsSource);

      assert.deepEqual(module.exports.definitions, module.exports.Q1.definitions);
    });

    it('parses multiple queries through webpack loader', () => {
      const jsSource = loader.call({ cacheable() {} }, `
        query Q1 { testQuery }
        query Q2 { testQuery2 }
      `);
      const module = { exports: undefined };
      eval(jsSource);

      assert.exists(module.exports.Q1);
      assert.exists(module.exports.Q2);
      assert.equal(module.exports.Q1.kind, 'Document');
      assert.equal(module.exports.Q2.kind, 'Document');
      assert.equal(module.exports.Q1.definitions.length, 1);
      assert.equal(module.exports.Q2.definitions.length, 1);
    });

    it('parses fragments with variable definitions', () => {
      gql.enableExperimentalFragmentVariables();

      const parsed = gql`fragment A ($arg: String!) on Type { testQuery }`;
      assert.equal(parsed.kind, 'Document');
      assert.exists(parsed.definitions[0].variableDefinitions);

      gql.disableExperimentalFragmentVariables()
    });
    
    // see https://github.com/apollographql/graphql-tag/issues/168
    it('does not nest queries needlessly in named exports', () => {
      const jsSource = loader.call({ cacheable() {} }, `
        query Q1 { testQuery }
        query Q2 { testQuery2 }
        query Q3 { test Query3 }
      `);
      const module = { exports: undefined };
      eval(jsSource);

      assert.notExists(module.exports.Q2.Q1);
      assert.notExists(module.exports.Q3.Q1);
      assert.notExists(module.exports.Q3.Q2);
    });

    it('tracks fragment dependencies from multiple queries through webpack loader', () => {
      const jsSource = loader.call({ cacheable() {} }, `
        fragment F1 on F { testQuery }
        fragment F2 on F { testQuery2 }
        fragment F3 on F { testQuery3 }
        query Q1 { ...F1 }
        query Q2 { ...F2 }
        query Q3 {
          ...F1
          ...F2
        }
      `);
      const module = { exports: undefined };
      eval(jsSource);

      assert.exists(module.exports.Q1);
      assert.exists(module.exports.Q2);
      assert.exists(module.exports.Q3);
      const Q1 = module.exports.Q1.definitions;
      const Q2 = module.exports.Q2.definitions;
      const Q3 = module.exports.Q3.definitions;

      assert.equal(Q1.length, 2);
      assert.equal(Q1[0].name.value, 'Q1');
      assert.equal(Q1[1].name.value, 'F1');

      assert.equal(Q2.length, 2);
      assert.equal(Q2[0].name.value, 'Q2');
      assert.equal(Q2[1].name.value, 'F2');

      assert.equal(Q3.length, 3);
      assert.equal(Q3[0].name.value, 'Q3');
      assert.equal(Q3[1].name.value, 'F1');
      assert.equal(Q3[2].name.value, 'F2');

    });

    it('tracks fragment dependencies across nested fragments', () => {
      const jsSource = loader.call({ cacheable() {} }, `
        fragment F11 on F { testQuery }
        fragment F22 on F {
          ...F11
          testQuery2
        }
        fragment F33 on F {
          ...F22
          testQuery3
        }

        query Q1 {
          ...F33
        }

        query Q2 {
          id
        }
      `);

      const module = { exports: undefined };
      eval(jsSource);

      assert.exists(module.exports.Q1);
      assert.exists(module.exports.Q2);

      const Q1 = module.exports.Q1.definitions;
      const Q2 = module.exports.Q2.definitions;

      assert.equal(Q1.length, 4);
      assert.equal(Q1[0].name.value, 'Q1');
      assert.equal(Q1[1].name.value, 'F33');
      assert.equal(Q1[2].name.value, 'F22');
      assert.equal(Q1[3].name.value, 'F11');

      assert.equal(Q2.length, 1);
    });

    it('correctly imports other files through the webpack loader', () => {
      const query = `#import "./fragment_definition.graphql"
        query {
          author {
            ...authorDetails
          }
        }`;
      const jsSource = loader.call({ cacheable() {} }, query);
      const oldRequire = require;
      const module = { exports: undefined };
      const require = (path) => {
        assert.equal(path, './fragment_definition.graphql');
        return gql`
          fragment authorDetails on Author {
            firstName
            lastName
          }`;
      };
      eval(jsSource);
      assert.equal(module.exports.kind, 'Document');
      const definitions = module.exports.definitions;
      assert.equal(definitions.length, 2);
      assert.equal(definitions[0].kind, 'OperationDefinition');
      assert.equal(definitions[1].kind, 'FragmentDefinition');
    });

    it('correctly interpolates imports of other files through the webpack loader', () => {
      const query = `#import "./fragment_definition.graphql"
          fragment BooksAuthor on Book {
            author {
              ...authorDetails
            }
          }
        `;
      const jsSource = loader.call({ cacheable() {} }, query);

      const oldRequire = require;
      const module = { exports: undefined };
      const require = (path) => {
        assert.equal(path, './fragment_definition.graphql');
        return gql`
          fragment authorDetails on Author {
            firstName
            lastName
          }`;
      };

      eval(jsSource);

      const document = gql`query { ...BooksAuthor } ${module.exports}`;
      assert.equal(document.kind, 'Document');
      assert.equal(document.definitions.length, 3);
      assert.equal(document.definitions[0].kind, 'OperationDefinition');
      assert.equal(document.definitions[1].kind, 'FragmentDefinition');
      assert.equal(document.definitions[2].kind, 'FragmentDefinition');
    });

    it('tracks fragment dependencies across fragments loaded via the webpack loader', () => {
      const query = `#import "./fragment_definition.graphql"
        fragment F111 on F {
          ...F222
        }

        query Q1 {
          ...F111
        }

        query Q2 {
          a
        }
        `;
      const jsSource = loader.call({ cacheable() {} }, query);
      const oldRequire = require;
      const module = { exports: undefined };
      const require = (path) => {
        assert.equal(path, './fragment_definition.graphql');
        return gql`
          fragment F222 on F {
            f1
            f2
          }`;
      };
      eval(jsSource);

      assert.exists(module.exports.Q1);
      assert.exists(module.exports.Q2);

      const Q1 = module.exports.Q1.definitions;
      const Q2 = module.exports.Q2.definitions;

      assert.equal(Q1.length, 3);
      assert.equal(Q1[0].name.value, 'Q1');
      assert.equal(Q1[1].name.value, 'F111');
      assert.equal(Q1[2].name.value, 'F222');

      assert.equal(Q2.length, 1);
    });

    it('does not complain when presented with normal comments', (done) => {
      assert.doesNotThrow(() => {
        const query = `#normal comment
          query {
            author {
              ...authorDetails
            }
          }`;
        const jsSource = loader.call({ cacheable() {} }, query);
        const module = { exports: undefined };
        eval(jsSource);
        assert.equal(module.exports.kind, 'Document');
        done();
      });
    });

    it('returns the same object for the same query', () => {
      assert.isTrue(gql`{ sameQuery }` === gql`{ sameQuery }`);
    });

    it('returns the same object for the same query, even with whitespace differences', () => {
      assert.isTrue(gql`{ sameQuery }` === gql`  { sameQuery,   }`);
    });

    const fragmentAst = gql`
    fragment UserFragment on User {
      firstName
      lastName
    }
  `;

    it('returns the same object for the same fragment', () => {
      assert.isTrue(gql`fragment same on Same { sameQuery }` ===
        gql`fragment same on Same { sameQuery }`);
    });

    it('returns the same object for the same document with substitution', () => {
      // We know that calling `gql` on a fragment string will always return
      // the same document, so we can reuse `fragmentAst`
      assert.isTrue(gql`{ ...UserFragment } ${fragmentAst}` ===
        gql`{ ...UserFragment } ${fragmentAst}`);
    });

    it('can reference a fragment that references as fragment', () => {
      const secondFragmentAst = gql`
        fragment SecondUserFragment on User {
          ...UserFragment
        }
        ${fragmentAst}
      `;

      const ast = gql`
        {
          user(id: 5) {
            ...SecondUserFragment
          }
        }
        ${secondFragmentAst}
      `;

      assert.deepEqual(ast, gql`
        {
          user(id: 5) {
            ...SecondUserFragment
          }
        }
        fragment SecondUserFragment on User {
          ...UserFragment
        }
        fragment UserFragment on User {
          firstName
          lastName
        }
      `);
    });

    describe('fragment warnings', () => {
      let warnings = [];
      const oldConsoleWarn = console.warn;
      beforeEach(() => {
        gqlRequire.resetCaches();
        warnings = [];
        console.warn = (w) => warnings.push(w);
      });
      afterEach(() => {
        console.warn = oldConsoleWarn;
      });

      it('warns if you use the same fragment name for different fragments', () => {
        const frag1 = gql`fragment TestSame on Bar { fieldOne }`;
        const frag2 = gql`fragment TestSame on Bar { fieldTwo }`;

        assert.isFalse(frag1 === frag2);
        assert.equal(warnings.length, 1);
      });

      it('does not warn if you use the same fragment name for the same fragment', () => {
        const frag1 = gql`fragment TestDifferent on Bar { fieldOne }`;
        const frag2 = gql`fragment TestDifferent on Bar { fieldOne }`;

        assert.isTrue(frag1 === frag2);
        assert.equal(warnings.length, 0);
      });

      it('does not warn if you use the same embedded fragment in two different queries', () => {
        const frag1 = gql`fragment TestEmbedded on Bar { field }`;
        const query1 = gql`{ bar { fieldOne ...TestEmbedded } } ${frag1}`;
        const query2 = gql`{ bar { fieldTwo ...TestEmbedded } } ${frag1}`;

        assert.isFalse(query1 === query2);
        assert.equal(warnings.length, 0);
      });

      it('does not warn if you use the same fragment name for embedded and non-embedded fragments', () => {
        const frag1 = gql`fragment TestEmbeddedTwo on Bar { field }`;
        const query1 = gql`{ bar { ...TestEmbedded } } ${frag1}`;
        const query2 = gql`{ bar { ...TestEmbedded } } fragment TestEmbeddedTwo on Bar { field }`;

        assert.equal(warnings.length, 0);
      });
    });

    describe('unique fragments', () => {
      beforeEach(() => {
        gqlRequire.resetCaches();
      });

      it('strips duplicate fragments from the document', () => {
        const frag1 = gql`fragment TestDuplicate on Bar { field }`;
        const query1 = gql`{ bar { fieldOne ...TestDuplicate } } ${frag1} ${frag1}`;
        const query2 = gql`{ bar { fieldOne ...TestDuplicate } } ${frag1}`;

        assert.equal(query1.definitions.length, 2);
        assert.equal(query1.definitions[1].kind, 'FragmentDefinition');
        // We don't test strict equality between the two queries because the source.body parsed from the
        // document is not the same, but the set of definitions should be.
        assert.deepEqual(query1.definitions, query2.definitions);
      });

      it('ignores duplicate fragments from second-level imports when using the webpack loader', () => {
        // take a require function and a query string, use the webpack loader to process it
        const load = (require, query) => {
          const jsSource = loader.call({ cacheable() {} }, query);
          const module = { exports: undefined };
          eval(jsSource);
          return module.exports;
        }

        const test_require = (path) => {
          switch (path) {
          case './friends.graphql':
            return load(test_require, [
              '#import "./person.graphql"',
              'fragment friends on Hero { friends { ...person } }',
            ].join('\n'));
          case './enemies.graphql':
            return load(test_require, [
              '#import "./person.graphql"',
              'fragment enemies on Hero { enemies { ...person } }',
            ].join('\n'));
          case './person.graphql':
            return load(test_require, 'fragment person on Person { name }\n');
          default:
            return null;
          };
        };

        const result = load(test_require, [
          '#import "./friends.graphql"',
          '#import "./enemies.graphql"',
          'query { hero { ...friends ...enemies } }',
        ].join('\n'));

        assert.equal(result.kind, 'Document');
        assert.equal(result.definitions.length, 4, 'after deduplication, only 4 fragments should remain');
        assert.equal(result.definitions[0].kind, 'OperationDefinition');

        // the rest of the definitions should be fragments and contain one of
        // each: "friends", "enemies", "person". Order does not matter
        const fragments = result.definitions.slice(1)
        assert(fragments.every(fragment => fragment.kind === 'FragmentDefinition'))
        assert(fragments.some(fragment => fragment.name.value === 'friends'))
        assert(fragments.some(fragment => fragment.name.value === 'enemies'))
        assert(fragments.some(fragment => fragment.name.value === 'person'))
      });
    });

    // How to make this work?
    // it.only('can reference a fragment passed as a document via shorthand', () => {
    //   const ast = gql`
    //     {
    //       user(id: 5) {
    //         ...${userFragmentDocument}
    //       }
    //     }
    //   `;
    //
    //   assert.deepEqual(ast, gql`
    //     {
    //       user(id: 5) {
    //         ...UserFragment
    //       }
    //     }
    //     fragment UserFragment on User {
    //       firstName
    //       lastName
    //     }
    //   `);
    // });

  });
});
