// For backwards compatibility, make sure require("graphql-tag") returns
// the gql function, rather than an exports object.
const gql = require('./lib/graphql-tag.umd.js').gql
module.exports = gql.gql = gql
