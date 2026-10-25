const { createDbHelpers } = require('../shared/db-helpers.js')
const fileUtils = require('./file-utils')

module.exports = createDbHelpers(fileUtils, buffer => Buffer.from(buffer, 'base64'))
