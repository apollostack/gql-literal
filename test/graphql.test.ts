/* tslint:disable:no-empty */
/* tslint:disable:no-eval */
import gql, { enableExperimentalFragmentconstiables, disableExperimentalFragmentconstiables } from '../src';
import loader from '../loader';

describe('gql', () => {
  it('parses queries', () => {
    expect(gql`{ testQuery }`.kind).toEqual('Document');
  });

  it('parses queries when called as a function', () => {
    expect((gql('{ testQuery }').kind)).toEqual('Document');
  });

  it('parses queries with weird substitutions', () => {
    const obj = {};
    expect(gql`{ field(input: "${(obj as any).missing}") }`.kind).toEqual('Document');
    expect(gql`{ field(input: "${null}") }`.kind).toEqual('Document');
    expect(gql`{ field(input: "${0}") }`.kind).toEqual('Document');
  });

  it('allows interpolation of documents generated by the webpack loader', () => {
    const sameFragment = "fragment SomeFragmentName on SomeType { someField }";

    const jsSource = loader.call(
      /* tslint:disable-next-line */
      { cacheable() {} },
      "fragment SomeFragmentName on SomeType { someField }"
    );
    const module = { exports: undefined };
    eval(jsSource);

    const document = gql`query { ...SomeFragmentName } ${module.exports}`;
    expect(document.kind).toEqual('Document');
    expect(document.definitions.length).toEqual(2);
    expect(document.definitions[0].kind).toEqual('OperationDefinition');
    expect(document.definitions[1].kind).toEqual('FragmentDefinition');
  });

  it('parses queries through webpack loader', () => {
    const jsSource = loader.call({ cacheable() {} }, '{ testQuery }');
    const module = { exports: undefined };
    eval(jsSource);
    expect((module as any).exports.kind).toEqual('Document');
  });

  it('parses single query through webpack loader', () => {
    const jsSource = loader.call({ cacheable() {} }, `
      query Q1 { testQuery }
    `);
    const module = { exports: undefined };
    eval(jsSource);
    expect((module as any).exports.kind).toEqual('Document');
    expect((module as any).exports).toHaveProperty('Q1');
    expect((module as any).exports.Q1.kind).toEqual('Document');
    expect((module as any).exports.Q1.definitions.length).toEqual(1);
  });

  it('parses single query and exports as default', () => {
    const jsSource = loader.call({ cacheable() {} }, `
      query Q1 { testQuery }
    `);
    const module = { exports: undefined };
    eval(jsSource);
    // TODO: deep equal: expect(module.exports.definitions).deepEqual(module.exports.Q1.definitions);
  });

  it('parses multiple queries through webpack loader', () => {
    const jsSource = loader.call({ cacheable() {} }, `
      query Q1 { testQuery }
      query Q2 { testQuery2 }
    `);
    const module = { exports: undefined };
    eval(jsSource);

    expect(module.exports).toHaveProperty('Q1');
    expect(module.exports).toHaveProperty('Q2');
    expect((module as any).exports.Q1.kind).toEqual('Document');
    expect((module as any).exports.Q2.kind).toEqual('Document');
    expect((module as any).exports.Q1.definitions.length).toEqual(1);
    expect((module as any).exports.Q2.definitions.length).toEqual(1);
  });

  it('parses fragments with variable definitions', () => {
    enableExperimentalFragmentconstiables();
    const parsed = gql`fragment A ($arg: String!) on Type { testQuery }`;
    expect(parsed.kind).toEqual('Document');
    expect(parsed.definitions[0]).toHaveProperty('variableDefinitions');
    disableExperimentalFragmentconstiables()
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

    // TODO
    // assert.notExists(module.exports.Q2.Q1);
    // assert.notExists(module.exports.Q3.Q1);
    // assert.notExists(module.exports.Q3.Q2);
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

    expect(Q1.length, 2);
    expect(Q1[0].name.value, 'Q1');
    expect(Q1[1].name.value, 'F1');

    expect(Q2.length, 2);
    expect(Q2[0].name.value, 'Q2');
    expect(Q2[1].name.value, 'F2');

    expect(Q3.length, 3);
    expect(Q3[0].name.value, 'Q3');
    expect(Q3[1].name.value, 'F1');
    expect(Q3[2].name.value, 'F2');

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

    expect(Q1.length, 4);
    expect(Q1[0].name.value, 'Q1');
    expect(Q1[1].name.value, 'F33');
    expect(Q1[2].name.value, 'F22');
    expect(Q1[3].name.value, 'F11');

    expect(Q2.length, 1);
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
      expect(path, './fragment_definition.graphql');
      return gql`
        fragment authorDetails on Author {
          firstName
          lastName
        }`;
    };
    eval(jsSource);
    expect(module.exports.kind, 'Document');
    const definitions = module.exports.definitions;
    expect(definitions.length, 2);
    expect(definitions[0].kind, 'OperationDefinition');
    expect(definitions[1].kind, 'FragmentDefinition');
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
      expect(path, './fragment_definition.graphql');
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

    expect(Q1.length, 3);
    expect(Q1[0].name.value, 'Q1');
    expect(Q1[1].name.value, 'F111');
    expect(Q1[2].name.value, 'F222');

    expect(Q2.length, 1);
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
      expect(module.exports.kind, 'Document');
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
      expect(warnings.length, 1);
    });

    it('does not warn if you use the same fragment name for the same fragment', () => {
      const frag1 = gql`fragment TestDifferent on Bar { fieldOne }`;
      const frag2 = gql`fragment TestDifferent on Bar { fieldOne }`;

      assert.isTrue(frag1 === frag2);
      expect(warnings.length, 0);
    });

    it('does not warn if you use the same embedded fragment in two different queries', () => {
      const frag1 = gql`fragment TestEmbedded on Bar { field }`;
      const query1 = gql`{ bar { fieldOne ...TestEmbedded } } ${frag1}`;
      const query2 = gql`{ bar { fieldTwo ...TestEmbedded } } ${frag1}`;

      assert.isFalse(query1 === query2);
      expect(warnings.length, 0);
    });

    it('does not warn if you use the same fragment name for embedded and non-embedded fragments', () => {
      const frag1 = gql`fragment TestEmbeddedTwo on Bar { field }`;
      const query1 = gql`{ bar { ...TestEmbedded } } ${frag1}`;
      const query2 = gql`{ bar { ...TestEmbedded } } fragment TestEmbeddedTwo on Bar { field }`;

      expect(warnings.length, 0);
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

      expect(query1.definitions.length, 2);
      expect(query1.definitions[1].kind, 'FragmentDefinition');
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

      expect(result.kind, 'Document');
      expect(result.definitions.length, 4, 'after deduplication, only 4 fragments should remain');
      expect(result.definitions[0].kind, 'OperationDefinition');

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
